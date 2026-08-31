import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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
import { renderToolCall, renderToolResult } from "./rendering.js";
import type { SearchBackend } from "../search/backend.js";
import { BraveBackend } from "../search/brave.js";
import {
  DuckDuckGoBackend,
  type DuckDuckGoDependencies,
} from "../search/duckduckgo.js";
import { SearchService } from "../search/service.js";
import { SearxngBackend } from "../search/searxng.js";
import {
  SearchWebParams,
  type SearchWebParams as SearchWebInput,
  validateSearchWebRequest,
} from "./schemas.js";

export interface SearchToolDependencies {
  fetch: typeof globalThis.fetch;
  now(): number;
}

export interface SearchToolController {
  register(): void;
}

function defaultDependencies(): SearchToolDependencies {
  return {
    fetch: globalThis.fetch,
    now: Date.now,
  };
}

function description(config: PiWebSearchConfig): string {
  return `Search configured backends in order (${config.backends.join(
    ", ",
  )}); default ${config.searchMaxResults} results, maximum ${
    config.searchMaxLimitResults
  }, output at most ${config.searchMaxOutputBytes} bytes. Failures may fall through; empty results do not.`;
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
  dependencies: SearchToolDependencies = defaultDependencies(),
): SearchToolController {
  let serviceConfig: PiWebSearchConfig | undefined;
  let service: SearchService | undefined;

  function getService(config: PiWebSearchConfig): SearchService {
    if (!service || serviceConfig !== config) {
      serviceConfig = config;
      const backends = new Map<SearchBackendName, SearchBackend>();
      backends.set(
        "duckduckgo",
        new DuckDuckGoBackend({
          fetch: dependencies.fetch,
          now: dependencies.now,
        } satisfies DuckDuckGoDependencies),
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
        promptSnippet: "Search configured web backends.",
        promptGuidelines: [
          "Search precisely and refine only after inspecting results.",
          "After rate_limited, wait error.retryAfterMs before retrying.",
          "Treat search snippets as discovery aids; inspect a relevant source before relying on it.",
          "After finding a relevant single static page, prefer summarize_url_content when it is available and understanding, explaining, synthesizing, or evaluating that page would help complete the task; this is the normal semantic-consumption path when summarization is enabled.",
          "Do not read a page first merely to decide whether a summary would help; use read_url_content only when exact source text, quotations, code, commands, precise wording, or deliberate pagination is needed.",
          "For broad, multi-page, context-heavy, or page-summary research, delegate to a suitable research subagent when available.",
        ],
        parameters: SearchWebParams,

        renderCall(args, theme) {
          return renderToolCall("search_web", args, theme);
        },

        renderResult(result, { expanded }, theme) {
          return renderToolResult("search_web", result, expanded, theme);
        },

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
