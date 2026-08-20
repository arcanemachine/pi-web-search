import type { ExtensionAPI, ExecResult } from "@earendil-works/pi-coding-agent";
import { truncateChars } from "../bounds.js";
import type { PiWebSearchConfig } from "../config.js";
import {
  errorOutcome,
  InvariantError,
  operationalError,
  type Diagnostic,
  type OutcomeEnvelope,
  type SearchBackendName,
  type SearchOutcomeData,
  type SearchRequest,
} from "../contracts.js";
import { formatOutcome } from "../format.js";
import type { SearchBackend } from "../search/backend.js";
import { BraveBackend } from "../search/brave.js";
import { DdgrBackend, type CommandExecutor } from "../search/ddgr.js";
import { SearchService } from "../search/service.js";
import { SearxngBackend } from "../search/searxng.js";
import {
  SearchWebParams,
  type SearchWebParams as SearchWebInput,
  validateSearchWebRequest,
} from "./schemas.js";

export interface SearchToolDependencies {
  fetch: typeof globalThis.fetch;
  execute: CommandExecutor;
  now(): number;
}

export interface SearchToolController {
  register(): void;
}

function defaultDependencies(pi: ExtensionAPI): SearchToolDependencies {
  return {
    fetch: globalThis.fetch,
    execute: (command, args, options): Promise<ExecResult> =>
      pi.exec(command, args, options),
    now: Date.now,
  };
}

function description(config: PiWebSearchConfig): string {
  return `Search the configured web backends in order (${config.backends.join(
    ", ",
  )}). Defaults to ${config.searchMaxResults} results, clamps requests to ${
    config.searchMaxLimitResults
  }, and returns at most ${config.searchMaxOutputBytes} bytes. Operational failures are structured and may fall through to the next backend; legitimate no-results responses do not.`;
}

function normalizeRequest(
  input: SearchWebInput,
  config: PiWebSearchConfig,
): {
  request?: SearchRequest;
  warnings: Diagnostic[];
  error?: ReturnType<typeof operationalError>;
} {
  const query = input.query.trim();
  if ([...query].length > config.searchMaxQueryChars) {
    return {
      warnings: [],
      error: operationalError(
        "invalid_request",
        `query exceeds the configured maximum of ${config.searchMaxQueryChars} characters`,
        false,
      ),
    };
  }

  const requestedLimit = input.limit ?? config.searchMaxResults;
  const limit = Math.min(requestedLimit, config.searchMaxLimitResults);
  const warnings: Diagnostic[] = [];
  if (requestedLimit > limit) {
    warnings.push({
      code: "limit_clamped",
      message: `limit=${requestedLimit} was clamped to ${limit}`,
      source: "local",
    });
  }
  return {
    warnings,
    request: {
      query,
      limit,
      ...(input.region?.trim() ? { region: input.region.trim() } : {}),
      safeSearch: input.safeSearch === "off" ? "off" : "on",
      ...(input.timeRange === "day" ||
      input.timeRange === "week" ||
      input.timeRange === "month" ||
      input.timeRange === "year"
        ? { timeRange: input.timeRange }
        : {}),
      forceRefresh: input.forceRefresh ?? false,
    },
  };
}

function boundOutcome(
  outcome: OutcomeEnvelope<SearchOutcomeData>,
  config: PiWebSearchConfig,
  warnings: Diagnostic[],
): OutcomeEnvelope<SearchOutcomeData> {
  let truncated = false;
  const data = outcome.data
    ? {
        query: outcome.data.query,
        results: outcome.data.results
          .slice(0, config.searchMaxLimitResults)
          .map((result) => {
            const title = truncateChars(
              result.title,
              config.searchMaxTitleChars,
            );
            const url = truncateChars(result.url, config.searchMaxUrlChars);
            const snippet = truncateChars(
              result.snippet,
              config.searchMaxSnippetChars,
            );
            const engine = result.engine
              ? truncateChars(result.engine, 100)
              : undefined;
            truncated ||=
              title.truncated ||
              url.truncated ||
              snippet.truncated ||
              (engine?.truncated ?? false);
            return {
              title: title.value,
              url: url.value,
              snippet: snippet.value,
              ...(engine ? { engine: engine.value } : {}),
            };
          }),
      }
    : undefined;
  const allWarnings = [...warnings, ...(outcome.warnings ?? [])];
  const combinedWarnings = allWarnings.slice(0, 20).map((warning) => {
    const code = truncateChars(warning.code, 100);
    const message = truncateChars(warning.message, 1_000);
    truncated ||= code.truncated || message.truncated;
    return { ...warning, code: code.value, message: message.value };
  });
  truncated ||=
    combinedWarnings.length < allWarnings.length ||
    (outcome.data?.results.length ?? 0) > (data?.results.length ?? 0);
  return {
    ...outcome,
    ...(data ? { data } : {}),
    ...(combinedWarnings.length === 0
      ? { warnings: undefined }
      : { warnings: combinedWarnings }),
    bounds: {
      truncated,
      returnedItems: data?.results.length,
      totalItems: outcome.data?.results.length,
      maxBytes: config.searchMaxOutputBytes,
    },
  };
}

export function createSearchToolController(
  pi: ExtensionAPI,
  getConfig: () => PiWebSearchConfig,
  dependencies: SearchToolDependencies = defaultDependencies(pi),
): SearchToolController {
  let serviceConfig: PiWebSearchConfig | undefined;
  let service: SearchService | undefined;

  function getService(config: PiWebSearchConfig): SearchService {
    if (!service || serviceConfig !== config) {
      serviceConfig = config;
      const backends = new Map<SearchBackendName, SearchBackend>();
      backends.set(
        "ddgr",
        new DdgrBackend(dependencies.execute, dependencies.now),
      );
      backends.set(
        "searxng",
        new SearxngBackend(config.searxngUrl, {
          fetch: dependencies.fetch,
          now: dependencies.now,
        }),
      );
      backends.set(
        "brave",
        new BraveBackend(config.braveApiKey, {
          fetch: dependencies.fetch,
          now: dependencies.now,
        }),
      );
      service = new SearchService(config, backends, dependencies.now);
    }
    return service;
  }

  return {
    register() {
      const effective = getConfig();
      pi.registerTool({
        name: "search_web",
        label: "Search Web",
        description: description(effective),
        promptSnippet:
          "Search configured web backends conservatively with bounded structured results and provenance.",
        promptGuidelines: [
          "Use search_web conservatively: prefer one precise query, inspect the result, then refine only when necessary.",
          `search_web uses a process-local token bucket (${effective.searchRateLimitPerMinute} logical searches/minute, burst ${effective.searchRateLimitBurst}); after a rate_limited result, do not retry before error.retryAfterMs.`,
          "Treat search_web snippets as discovery aids; read the source before citing it.",
          "When available, prefer a subagent type suited to web research for broad, multi-page, or context-heavy investigation.",
        ],
        parameters: SearchWebParams,

        async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
          const config = getConfig();
          const validation = validateSearchWebRequest(params);
          if (validation) {
            return formatOutcome(errorOutcome("search_web", validation), {
              maxContentBytes: config.searchMaxOutputBytes,
              maxDetailsBytes: config.searchMaxOutputBytes,
            });
          }
          const normalized = normalizeRequest(params as SearchWebInput, config);
          if (normalized.error) {
            return formatOutcome(errorOutcome("search_web", normalized.error), {
              maxContentBytes: config.searchMaxOutputBytes,
              maxDetailsBytes: config.searchMaxOutputBytes,
            });
          }
          if (!normalized.request) {
            throw new InvariantError("Normalized search request is missing");
          }
          const outcome = await getService(config).search(
            normalized.request,
            signal,
          );
          return formatOutcome(
            boundOutcome(outcome, config, normalized.warnings),
            {
              maxContentBytes: config.searchMaxOutputBytes,
              maxDetailsBytes: config.searchMaxOutputBytes,
              maxArrayItems: config.searchMaxLimitResults + 25,
              maxStringBytes: Math.max(
                config.searchMaxTitleChars,
                config.searchMaxUrlChars,
                config.searchMaxSnippetChars,
              ),
            },
          );
        },
      });
    },
  };
}
