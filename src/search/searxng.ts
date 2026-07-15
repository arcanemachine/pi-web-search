import { createAbortScope } from "../abort.js";
import { byteLength } from "../bounds.js";
import {
  operationalError,
  type Diagnostic,
  type OperationalError,
  type OutcomeEnvelope,
  type SearchOutcomeData,
  type SearchRequest,
} from "../contracts.js";
import type { SearchBackend, SearchBackendContext } from "./backend.js";
import { parseSearxngPayload } from "./validation.js";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export interface SearxngDependencies {
  fetch: typeof globalThis.fetch;
  now(): number;
}

const DEFAULT_DEPENDENCIES: SearxngDependencies = {
  fetch: globalThis.fetch,
  now: Date.now,
};

function elapsed(start: number, now: () => number): number {
  return Math.max(0, now() - start);
}

function retryAfterMs(
  response: Response,
  now: () => number,
): number | undefined {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0)
    return Math.ceil(seconds * 1_000);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now());
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
      backend: "searxng",
      durationMs,
      cache: { status: "miss" },
    },
  };
}

function diagnosticsError(diagnostics: Diagnostic[]): OperationalError {
  const evidence = diagnostics
    .map((item) => item.message)
    .join("\n")
    .toLowerCase();
  if (/rate[ -]?limit|too many requests|\b429\b/.test(evidence)) {
    return operationalError(
      "rate_limited",
      "SearXNG reported rate-limit evidence from its engines",
      true,
    );
  }
  if (/captcha|anomal|forbidden|\b403\b|blocked/.test(evidence)) {
    return operationalError(
      "blocked",
      "SearXNG reported blocking evidence from its engines",
      true,
    );
  }
  if (/timed? out|timeout/.test(evidence)) {
    return operationalError(
      "timeout",
      "SearXNG reported engine timeout evidence",
      true,
    );
  }
  return operationalError(
    "backend_failed",
    "SearXNG returned no results and reported engine failures",
    true,
  );
}

function endpoint(baseUrl: string, request: SearchRequest): URL {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/search`;
  url.searchParams.set("q", request.query);
  url.searchParams.set("format", "json");
  url.searchParams.set("categories", "general");
  if (request.region) url.searchParams.set("language", request.region);
  if (request.timeRange) url.searchParams.set("time_range", request.timeRange);
  url.searchParams.set("safesearch", request.safeSearch === "off" ? "0" : "1");
  return url;
}

export class SearxngBackend implements SearchBackend {
  readonly name = "searxng" as const;

  constructor(
    private readonly baseUrl: string,
    private readonly dependencies: SearxngDependencies = DEFAULT_DEPENDENCIES,
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
    let response: Response;
    try {
      response = await this.dependencies.fetch(
        endpoint(this.baseUrl, request),
        {
          headers: { Accept: "application/json" },
          signal,
        },
      );
    } catch (error) {
      if (parentSignal?.aborted) throw parentSignal.reason ?? error;
      if (signal.aborted) {
        return backendError(
          request,
          operationalError("timeout", "SearXNG request timed out", true),
          duration(),
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      return backendError(
        request,
        operationalError(
          "fetch_failed",
          `SearXNG request failed: ${message}`,
          true,
        ),
        duration(),
      );
    }

    if (response.status === 429) {
      const retry = retryAfterMs(response, this.dependencies.now);
      return backendError(
        request,
        operationalError(
          "rate_limited",
          "SearXNG returned HTTP 429",
          true,
          retry,
        ),
        duration(),
      );
    }
    if (response.status === 403) {
      return backendError(
        request,
        operationalError("blocked", "SearXNG returned HTTP 403", true),
        duration(),
      );
    }
    if (!response.ok) {
      return backendError(
        request,
        operationalError(
          "backend_failed",
          `SearXNG returned HTTP ${response.status} ${response.statusText}`,
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
          "SearXNG response was not JSON",
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
          "SearXNG response exceeded 2 MiB",
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
          operationalError("timeout", "SearXNG response timed out", true),
          duration(),
        );
      }
      return backendError(
        request,
        operationalError(
          "fetch_failed",
          "Unable to read SearXNG response",
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
          "SearXNG response exceeded 2 MiB",
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
          "SearXNG returned malformed JSON",
          false,
        ),
        duration(),
      );
    }
    const parsed = parseSearxngPayload(native);
    if (!parsed.ok) return backendError(request, parsed.error, duration());

    const { results, diagnostics } = parsed.value;
    if (results.length === 0 && diagnostics.length > 0) {
      return backendError(request, diagnosticsError(diagnostics), duration());
    }
    const status = results.length === 0 ? "no_results" : "ok";
    return {
      operation: "search_web",
      status,
      summary:
        status === "ok"
          ? `SearXNG returned ${results.length} result${results.length === 1 ? "" : "s"}`
          : "SearXNG returned no results",
      data: { query: request.query, results },
      ...(diagnostics.length === 0 ? {} : { warnings: diagnostics }),
      provenance: {
        backend: "searxng",
        durationMs: duration(),
        cache: { status: "miss" },
      },
    };
  }
}
