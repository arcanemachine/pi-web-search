import { createAbortScope } from "../abort.js";
import { byteLength } from "../bounds.js";
import {
  operationalError,
  type OperationalError,
  type OutcomeEnvelope,
  type SearchOutcomeData,
  type SearchRequest,
} from "../contracts.js";
import type { SearchBackend, SearchBackendContext } from "./backend.js";
import { parseDuckDuckGoHtml } from "./duckduckgo-parser.js";

const DUCKDUCKGO_ENDPOINT = "https://html.duckduckgo.com/html";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface DuckDuckGoDependencies {
  fetch: typeof globalThis.fetch;
  now(): number;
}

const DEFAULT_DEPENDENCIES: DuckDuckGoDependencies = {
  fetch: globalThis.fetch,
  now: Date.now,
};

function elapsed(start: number, now: () => number): number {
  return Math.max(0, now() - start);
}

function backendError(
  request: SearchRequest,
  error: OperationalError,
  durationMs: number,
): OutcomeEnvelope<SearchOutcomeData> {
  return {
    operation: "search_web",
    status: "error",
    summary: error.message,
    data: { query: request.query, results: [] },
    error,
    provenance: {
      backend: "duckduckgo",
      durationMs,
      cache: { status: "miss" },
    },
  };
}

function timeRange(value: SearchRequest["timeRange"]): string {
  switch (value) {
    case "day":
      return "d";
    case "week":
      return "w";
    case "month":
      return "m";
    case "year":
      return "y";
    default:
      return "";
  }
}

function formBody(request: SearchRequest): URLSearchParams {
  const body = new URLSearchParams();
  body.set("q", request.query);
  body.set("b", "");
  body.set("df", timeRange(request.timeRange));
  body.set("kf", "-1");
  body.set("kh", "1");
  body.set("kl", request.region?.trim() || "us-en");
  body.set("kp", request.safeSearch === "off" ? "-2" : "1");
  body.set("k1", "-1");
  return body;
}

function safeErrorCode(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    const code = (value as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  } catch {
    return undefined;
  }
}

function fetchFailureMessage(error: unknown): string {
  let code = safeErrorCode(error);
  if (code === undefined && typeof error === "object" && error !== null) {
    let cause: unknown;
    try {
      cause = (error as { cause?: unknown }).cause;
    } catch {
      cause = undefined;
    }
    code = safeErrorCode(cause);
  }

  switch (code) {
    case "ECONNREFUSED":
      return "DuckDuckGo endpoint refused the connection";
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "DuckDuckGo hostname could not be resolved";
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return "DuckDuckGo endpoint was unreachable";
    case "ECONNRESET":
      return "DuckDuckGo connection was reset";
    default:
      return "DuckDuckGo request failed";
  }
}

function retryAfterMs(
  response: Response,
  now: () => number,
): number | undefined {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return seconds >= 0 ? Math.ceil(seconds * 1_000) : undefined;
  }
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now());
}

function statusError(
  response: Response,
  now: () => number,
): OperationalError | undefined {
  if (response.status === 202) {
    return operationalError(
      "blocked",
      "DuckDuckGo returned HTTP 202 blocking evidence",
      true,
    );
  }
  if (response.status === 403) {
    return operationalError(
      "blocked",
      "DuckDuckGo returned HTTP 403 blocking evidence",
      true,
    );
  }
  if (response.status === 429) {
    return operationalError(
      "rate_limited",
      "DuckDuckGo returned HTTP 429",
      true,
      retryAfterMs(response, now),
    );
  }
  if (response.status >= 500 && response.status <= 599) {
    return operationalError(
      "backend_failed",
      `DuckDuckGo returned HTTP ${response.status}`,
      true,
    );
  }
  if (!response.ok) {
    return operationalError(
      "backend_failed",
      `DuckDuckGo returned HTTP ${response.status}`,
      false,
    );
  }
  return undefined;
}

function responseContentTypeIsHtml(response: Response): boolean {
  const contentType = response.headers.get("content-type")?.toLowerCase();
  if (!contentType) return true;
  const mediaType = contentType.split(";", 1)[0]?.trim();
  return mediaType === "text/html" || mediaType === "application/xhtml+xml";
}

export class DuckDuckGoBackend implements SearchBackend {
  readonly name = "duckduckgo" as const;

  constructor(
    private readonly dependencies: DuckDuckGoDependencies = DEFAULT_DEPENDENCIES,
  ) {}

  async search(
    request: SearchRequest,
    context: SearchBackendContext,
  ): Promise<OutcomeEnvelope<SearchOutcomeData>> {
    const startedAt = this.dependencies.now();
    const scope = createAbortScope(context.signal, context.timeoutMs);
    try {
      return await this.searchWithSignal(
        request,
        context.signal,
        scope.signal,
        startedAt,
      );
    } finally {
      scope.cleanup();
    }
  }

  private async searchWithSignal(
    request: SearchRequest,
    parentSignal: AbortSignal | undefined,
    signal: AbortSignal,
    startedAt: number,
  ): Promise<OutcomeEnvelope<SearchOutcomeData>> {
    const duration = () => elapsed(startedAt, this.dependencies.now);
    if (parentSignal?.aborted) {
      throw parentSignal.reason ?? new Error("DuckDuckGo search cancelled");
    }
    let response: Response;
    try {
      response = await this.dependencies.fetch(DUCKDUCKGO_ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Content-Type": "application/x-www-form-urlencoded",
          DNT: "1",
          "User-Agent": USER_AGENT,
        },
        body: formBody(request),
        signal,
      });
    } catch (error) {
      if (parentSignal?.aborted) throw parentSignal.reason ?? error;
      if (signal.aborted) {
        return backendError(
          request,
          operationalError("timeout", "DuckDuckGo request timed out", true),
          duration(),
        );
      }
      return backendError(
        request,
        operationalError("fetch_failed", fetchFailureMessage(error), true),
        duration(),
      );
    }

    if (parentSignal?.aborted) {
      throw parentSignal.reason ?? new Error("DuckDuckGo search cancelled");
    }
    if (signal.aborted) {
      return backendError(
        request,
        operationalError("timeout", "DuckDuckGo request timed out", true),
        duration(),
      );
    }

    const httpError = statusError(response, this.dependencies.now);
    if (httpError) return backendError(request, httpError, duration());

    if (!responseContentTypeIsHtml(response)) {
      return backendError(
        request,
        operationalError(
          "parse_failed",
          "DuckDuckGo response was not HTML",
          false,
        ),
        duration(),
      );
    }

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
      return backendError(
        request,
        operationalError(
          "parse_failed",
          "DuckDuckGo response exceeded 2 MiB",
          false,
        ),
        duration(),
      );
    }

    let html: string;
    try {
      html = await response.text();
    } catch (error) {
      if (parentSignal?.aborted) throw parentSignal.reason ?? error;
      if (signal.aborted) {
        return backendError(
          request,
          operationalError("timeout", "DuckDuckGo response timed out", true),
          duration(),
        );
      }
      return backendError(
        request,
        operationalError(
          "fetch_failed",
          "Unable to read DuckDuckGo response",
          true,
        ),
        duration(),
      );
    }

    if (parentSignal?.aborted) {
      throw parentSignal.reason ?? new Error("DuckDuckGo search cancelled");
    }
    if (signal.aborted) {
      return backendError(
        request,
        operationalError("timeout", "DuckDuckGo response timed out", true),
        duration(),
      );
    }

    if (byteLength(html) > MAX_RESPONSE_BYTES) {
      return backendError(
        request,
        operationalError(
          "parse_failed",
          "DuckDuckGo response exceeded 2 MiB",
          false,
        ),
        duration(),
      );
    }

    const parsed = parseDuckDuckGoHtml(html, request.limit ?? 5);
    if (parsed.kind === "blocked") {
      return backendError(
        request,
        operationalError(
          "blocked",
          "DuckDuckGo response contained blocking evidence",
          true,
        ),
        duration(),
      );
    }
    if (parsed.kind === "invalid") {
      return backendError(
        request,
        operationalError("parse_failed", parsed.message, false),
        duration(),
      );
    }
    const results = parsed.kind === "results" ? parsed.results : [];
    const status = results.length === 0 ? "no_results" : "ok";
    return {
      operation: "search_web",
      status,
      summary:
        status === "ok"
          ? `DuckDuckGo returned ${results.length} result${results.length === 1 ? "" : "s"}`
          : "DuckDuckGo returned no results",
      data: { query: request.query, results },
      provenance: {
        backend: "duckduckgo",
        durationMs: duration(),
        cache: { status: "miss" },
      },
    };
  }
}
