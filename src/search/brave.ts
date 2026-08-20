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
import { parseBravePayload } from "./validation.js";

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_QUERY_CHARS = 400;
const MAX_QUERY_WORDS = 50;

export interface BraveDependencies {
  fetch: typeof globalThis.fetch;
  now(): number;
}

const DEFAULT_DEPENDENCIES: BraveDependencies = {
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
      backend: "brave",
      durationMs,
      cache: { status: "miss" },
    },
  };
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
      return "Brave Search endpoint refused the connection";
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "Brave Search hostname could not be resolved";
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return "Brave Search endpoint was unreachable";
    case "ECONNRESET":
      return "Brave Search connection was reset";
    default:
      return "Brave Search request failed";
  }
}

function retryAfterMs(
  response: Response,
  now: () => number,
): number | undefined {
  const reset = response.headers
    .get("x-ratelimit-reset")
    ?.split(",", 1)[0]
    ?.trim();
  if (reset) {
    const seconds = Number(reset);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.ceil(seconds * 1_000);
    }
  }

  const value = response.headers.get("retry-after")?.trim();
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1_000);
  }
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now());
}

function queryError(request: SearchRequest): OperationalError | undefined {
  const characters = [...request.query].length;
  if (characters > MAX_QUERY_CHARS) {
    return operationalError(
      "invalid_request",
      "Brave Search query exceeds the backend maximum of 400 characters",
      false,
    );
  }
  const words = request.query.trim().split(/\s+/u).filter(Boolean).length;
  if (words > MAX_QUERY_WORDS) {
    return operationalError(
      "invalid_request",
      "Brave Search query exceeds the backend maximum of 50 words",
      false,
    );
  }
  return undefined;
}

function count(request: SearchRequest): number {
  const requested = Number.isFinite(request.limit)
    ? Math.floor(request.limit ?? 5)
    : 5;
  return Math.min(20, Math.max(1, requested));
}

function freshness(value: SearchRequest["timeRange"]): string | undefined {
  switch (value) {
    case "day":
      return "pd";
    case "week":
      return "pw";
    case "month":
      return "pm";
    case "year":
      return "py";
    default:
      return undefined;
  }
}

function endpoint(request: SearchRequest): URL {
  const url = new URL(BRAVE_ENDPOINT);
  url.searchParams.set("q", request.query);
  url.searchParams.set("count", String(count(request)));
  url.searchParams.set(
    "safesearch",
    request.safeSearch === "off" ? "off" : "moderate",
  );
  const range = freshness(request.timeRange);
  if (range) url.searchParams.set("freshness", range);
  const region = request.region?.match(/^([a-z]{2})-([a-z]{2})$/i);
  if (region) {
    url.searchParams.set("country", region[1].toUpperCase());
    url.searchParams.set("search_lang", region[2].toLowerCase());
  }
  url.searchParams.set("result_filter", "web");
  url.searchParams.set("text_decorations", "false");
  url.searchParams.set("spellcheck", "false");
  return url;
}

export class BraveBackend implements SearchBackend {
  readonly name = "brave" as const;

  constructor(
    private readonly apiKey: string | undefined,
    private readonly dependencies: BraveDependencies = DEFAULT_DEPENDENCIES,
  ) {}

  async search(
    request: SearchRequest,
    context: SearchBackendContext,
  ): Promise<OutcomeEnvelope<SearchOutcomeData>> {
    const startedAt = this.dependencies.now();
    const missingKey = !this.apiKey?.trim();
    if (missingKey) {
      return backendError(
        request,
        operationalError(
          "backend_unavailable",
          "Brave Search backend requires PI_WEB_SEARCH_BRAVE_API_KEY",
          false,
        ),
        elapsed(startedAt, this.dependencies.now),
      );
    }

    const invalidQuery = queryError(request);
    if (invalidQuery) {
      return backendError(
        request,
        invalidQuery,
        elapsed(startedAt, this.dependencies.now),
      );
    }

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
    let response: Response;
    try {
      response = await this.dependencies.fetch(endpoint(request), {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": this.apiKey as string,
        },
        signal,
      });
    } catch (error) {
      if (parentSignal?.aborted) throw parentSignal.reason ?? error;
      if (signal.aborted) {
        return backendError(
          request,
          operationalError("timeout", "Brave Search request timed out", true),
          duration(),
        );
      }
      return backendError(
        request,
        operationalError("fetch_failed", fetchFailureMessage(error), true),
        duration(),
      );
    }

    if (response.status === 401) {
      return backendError(
        request,
        operationalError(
          "backend_unavailable",
          "Brave Search API rejected the subscription token",
          false,
        ),
        duration(),
      );
    }
    if (response.status === 403) {
      return backendError(
        request,
        operationalError(
          "blocked",
          "Brave Search API denied the request",
          false,
        ),
        duration(),
      );
    }
    if (response.status === 404) {
      return backendError(
        request,
        operationalError(
          "backend_failed",
          "Brave Search endpoint returned HTTP 404",
          false,
        ),
        duration(),
      );
    }
    if (response.status === 422) {
      return backendError(
        request,
        operationalError(
          "invalid_request",
          "Brave Search API rejected the request parameters",
          false,
        ),
        duration(),
      );
    }
    if (response.status === 429) {
      return backendError(
        request,
        operationalError(
          "rate_limited",
          "Brave Search API returned HTTP 429",
          true,
          retryAfterMs(response, this.dependencies.now),
        ),
        duration(),
      );
    }
    if (!response.ok) {
      return backendError(
        request,
        operationalError(
          "backend_failed",
          `Brave Search API returned HTTP ${response.status}`,
          response.status >= 500,
        ),
        duration(),
      );
    }

    const contentType =
      response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("json")) {
      return backendError(
        request,
        operationalError(
          "parse_failed",
          "Brave Search response was not JSON",
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
          "Brave Search response exceeded 2 MiB",
          false,
        ),
        duration(),
      );
    }

    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      if (parentSignal?.aborted) throw parentSignal.reason ?? error;
      if (signal.aborted) {
        return backendError(
          request,
          operationalError("timeout", "Brave Search response timed out", true),
          duration(),
        );
      }
      return backendError(
        request,
        operationalError(
          "fetch_failed",
          "Unable to read Brave Search response",
          true,
        ),
        duration(),
      );
    }
    if (byteLength(text) > MAX_RESPONSE_BYTES) {
      return backendError(
        request,
        operationalError(
          "parse_failed",
          "Brave Search response exceeded 2 MiB",
          false,
        ),
        duration(),
      );
    }

    let native: unknown;
    try {
      native = JSON.parse(text);
    } catch {
      return backendError(
        request,
        operationalError(
          "parse_failed",
          "Brave Search returned malformed JSON",
          false,
        ),
        duration(),
      );
    }
    const parsed = parseBravePayload(native);
    if (!parsed.ok) return backendError(request, parsed.error, duration());

    const status = parsed.value.results.length === 0 ? "no_results" : "ok";
    return {
      operation: "search_web",
      status,
      summary:
        status === "ok"
          ? `Brave Search returned ${parsed.value.results.length} result${parsed.value.results.length === 1 ? "" : "s"}`
          : "Brave Search returned no results",
      data: { query: request.query, results: parsed.value.results },
      provenance: {
        backend: "brave",
        durationMs: duration(),
        cache: { status: "miss" },
      },
    };
  }
}
