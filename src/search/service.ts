import type { PiWebSearchConfig } from "../config.js";
import {
  InvariantError,
  operationalError,
  type BackendAttempt,
  type Diagnostic,
  type OutcomeEnvelope,
  type SearchBackendName,
  type SearchOutcomeData,
  type SearchRequest,
} from "../contracts.js";
import type { SearchBackend } from "./backend.js";
import { SearchCache } from "./cache.js";
import { searchCacheKey } from "./key.js";
import { SearchLimiter } from "./limiter.js";

function cacheState(
  outcome: OutcomeEnvelope<SearchOutcomeData>,
  status: "hit" | "coalesced",
  ageMs?: number,
  storedAt?: number,
): OutcomeEnvelope<SearchOutcomeData> {
  return {
    ...outcome,
    provenance: {
      ...outcome.provenance,
      cache: {
        status,
        ...(ageMs === undefined ? {} : { ageMs }),
        ...(storedAt === undefined
          ? {}
          : { storedAt: new Date(storedAt).toISOString() }),
      },
    },
  };
}

export class SearchService {
  private readonly cache: SearchCache;
  private readonly limiter: SearchLimiter;
  private readonly inFlight = new Map<
    string,
    Promise<OutcomeEnvelope<SearchOutcomeData>>
  >();

  constructor(
    private readonly config: PiWebSearchConfig,
    private readonly backends: ReadonlyMap<SearchBackendName, SearchBackend>,
    private readonly now: () => number = Date.now,
  ) {
    this.cache = new SearchCache(
      config.searchCacheTtlSeconds * 1_000,
      config.searchCacheMaxEntries,
      config.searchCacheMaxBytes,
      now,
    );
    this.limiter = new SearchLimiter(
      config.searchRateLimitPerMinute,
      config.searchRateLimitBurst,
      now,
    );
  }

  async search(
    request: SearchRequest,
    signal?: AbortSignal,
  ): Promise<OutcomeEnvelope<SearchOutcomeData>> {
    const key = searchCacheKey(request, this.config);
    if (!request.forceRefresh) {
      const cached = this.cache.get(key);
      if (cached) {
        return cacheState(cached.outcome, "hit", cached.ageMs, cached.storedAt);
      }
    }

    const pending = this.inFlight.get(key);
    if (pending) return cacheState(await pending, "coalesced");

    const decision = this.limiter.acquire();
    if (!decision.allowed) {
      const retryAfterMs =
        decision.retryAfterMs ??
        Math.ceil(60_000 / this.config.searchRateLimitPerMinute);
      const error = operationalError(
        "rate_limited",
        `Local process search token bucket exhausted (${this.config.searchRateLimitPerMinute}/minute, burst ${this.config.searchRateLimitBurst}); retry after ${retryAfterMs}ms`,
        true,
        retryAfterMs,
      );
      return {
        operation: "search_web",
        status: "error",
        summary: error.message,
        data: { query: request.query, results: [] },
        error,
        provenance: { cache: { status: "miss" } },
      };
    }

    const dispatch = this.dispatch(request, signal)
      .then((outcome) => {
        if (outcome.status === "ok" || outcome.status === "no_results") {
          this.cache.set(key, outcome);
        }
        return outcome;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, dispatch);
    return dispatch;
  }

  private async dispatch(
    request: SearchRequest,
    signal?: AbortSignal,
  ): Promise<OutcomeEnvelope<SearchOutcomeData>> {
    const attempts: BackendAttempt[] = [];
    const precedingWarnings: Diagnostic[] = [];
    let finalErrorOutcome: OutcomeEnvelope<SearchOutcomeData> | undefined;

    for (const backendName of this.config.backends) {
      const backend = this.backends.get(backendName);
      if (!backend) {
        throw new InvariantError(
          `Configured backend is not registered: ${backendName}`,
        );
      }
      const outcome = await backend.search(request, {
        signal,
        timeoutMs: this.config.searchTimeoutMs,
      });
      attempts.push({
        backend: backendName,
        status: outcome.status,
        durationMs: outcome.provenance?.durationMs ?? 0,
        ...(outcome.error ? { errorCode: outcome.error.code } : {}),
      });

      if (outcome.status === "error") {
        if (!outcome.error) {
          throw new InvariantError(
            `${backendName} returned an error without details`,
          );
        }
        finalErrorOutcome = outcome;
        precedingWarnings.push({
          code: `backend_${outcome.error?.code ?? "failed"}`,
          message: `${backendName}: ${outcome.summary}`,
          source: backendName,
        });
        continue;
      }

      return {
        ...outcome,
        warnings: [...precedingWarnings, ...(outcome.warnings ?? [])],
        provenance: {
          ...outcome.provenance,
          backend: backendName,
          attempts,
          fetchedAt: new Date(this.now()).toISOString(),
          cache: { status: "miss" },
        },
      };
    }

    const finalBackend = this.config.backends.at(-1);
    const finalAttempt = attempts.at(-1);
    if (!finalBackend || !finalAttempt) {
      throw new InvariantError(
        "Search dispatch completed without a backend attempt",
      );
    }
    const final = precedingWarnings.pop();
    const error = finalErrorOutcome?.error;
    if (!error) {
      throw new InvariantError(
        "Search dispatch ended without a final backend error",
      );
    }
    return {
      operation: "search_web",
      status: "error",
      summary: final?.message ?? error.message,
      data: { query: request.query, results: [] },
      error,
      warnings: precedingWarnings,
      provenance: {
        backend: finalBackend,
        attempts,
        fetchedAt: new Date(this.now()).toISOString(),
        cache: { status: "miss" },
      },
    };
  }
}
