import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  errorOutcome,
  InvariantError,
  type Diagnostic,
  type GrepOutcomeData,
  type OutcomeEnvelope,
} from "../contracts.js";
import { matchSnapshot } from "../documents/match.js";
import {
  GrepUrlContentParams,
  type GrepUrlContentParams as GrepInput,
  validateGrepUrlContentRequest,
} from "./schemas.js";
import {
  boundedDocumentWarnings,
  clampWarning,
  documentProvenance,
  formatDocumentOutcome,
  wasFormatTruncated,
  type DocumentToolRuntime,
} from "./document-shared.js";
import { renderToolCall, renderToolResult } from "./rendering.js";

export function registerGrepUrlContentTool(
  pi: ExtensionAPI,
  getRuntime: () => DocumentToolRuntime,
): void {
  const effective = getRuntime().config;
  pi.registerTool({
    name: "grep_url_content",
    label: "Grep URL Content",
    description: `Find literal text in a normalized document snapshot. Results include all matches by default; pathological results are bounded to ${effective.grepMaxMatches} matches and ${effective.grepMaxChars} quote characters and expose a continuation offset.`,
    promptSnippet: "Find text in a static URL snapshot.",
    promptGuidelines: [
      "Use grep_url_content for targeted literal evidence from a known or likely static URL.",
      "For understanding or explaining one known static page, prefer summarize_url_content when it is available instead of collecting broad raw text.",
      "Results include all matches by default. If a result includes nextOffset, call grep_url_content again with the same arguments and set offset to nextOffset.",
      "For broad, multi-page, context-heavy, or page-summary research, delegate to a suitable research subagent when available.",
      "If static extraction returns a client-rendered shell, use Playwright or another JavaScript-capable browser.",
    ],
    parameters: GrepUrlContentParams,

    renderCall(args, theme) {
      return renderToolCall("grep_url_content", args, theme);
    },

    renderResult(result, { expanded }, theme) {
      return renderToolResult("grep_url_content", result, expanded, theme);
    },

    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const runtime = getRuntime();
      const validation = validateGrepUrlContentRequest(params);
      if (validation) {
        return formatDocumentOutcome(
          errorOutcome("grep_url_content", validation),
        );
      }
      const input = params as GrepInput;
      const parsedUrl = new URL(input.url);
      parsedUrl.hash = "";
      const url = parsedUrl.toString();
      const query = input.query.trim();
      if ([...query].length > runtime.config.grepMaxQueryChars) {
        return formatDocumentOutcome(
          errorOutcome("grep_url_content", {
            code: "invalid_request",
            message: `query exceeds the configured maximum of ${runtime.config.grepMaxQueryChars} characters`,
            retryable: false,
          }),
        );
      }
      const selector = input.selector?.trim() || undefined;
      const requestedBefore = input.beforeLines ?? 1;
      const requestedAfter = input.afterLines ?? 1;
      const requestedMatches =
        input.maxMatches ?? runtime.config.grepMaxMatches;
      const startOrdinal = input.offset ?? 0;
      const requestedChars = input.maxChars ?? runtime.config.grepMaxChars;
      const beforeLines = Math.min(
        requestedBefore,
        runtime.config.grepMaxContextLines,
      );
      const afterLines = Math.min(
        requestedAfter,
        runtime.config.grepMaxContextLines,
      );
      const maxMatches = Math.min(
        requestedMatches,
        runtime.config.grepMaxLimitMatches,
      );
      const maxChars = Math.min(
        requestedChars,
        runtime.config.grepMaxLimitChars,
      );
      const caseSensitive = input.caseSensitive ?? false;
      if (maxChars < [...query].length) {
        return formatDocumentOutcome(
          errorOutcome("grep_url_content", {
            code: "invalid_request",
            message:
              "maxChars must be large enough to contain the literal query",
            retryable: false,
          }),
        );
      }
      const warnings: Diagnostic[] = [];
      for (const warning of [
        clampWarning("beforeLines", requestedBefore, beforeLines),
        clampWarning("afterLines", requestedAfter, afterLines),
        clampWarning("maxMatches", requestedMatches, maxMatches),
        clampWarning("maxChars", requestedChars, maxChars),
      ]) {
        if (warning) warnings.push(warning);
      }
      const snapshotResult = await runtime.service.getSnapshot(
        { url, mode: "main", ...(selector ? { selector } : {}) },
        input.forceRefresh ?? false,
        signal,
      );
      if (snapshotResult.error) {
        return formatDocumentOutcome(
          errorOutcome("grep_url_content", snapshotResult.error),
        );
      }
      const snapshot = snapshotResult.snapshot;
      if (!snapshot) {
        throw new InvariantError(
          "Document snapshot result is missing a snapshot",
        );
      }

      let pageChars = maxChars;
      let pageMatches = maxMatches;
      while (pageChars >= 1 && pageMatches >= 1) {
        const page = matchSnapshot(
          snapshot,
          query,
          caseSensitive,
          beforeLines,
          afterLines,
          startOrdinal,
          pageMatches,
          pageChars,
        );
        if (page.totalMatches === 0 && startOrdinal === 0) {
          return formatDocumentOutcome({
            operation: "grep_url_content",
            status: "no_match",
            summary: "No literal matches found in the normalized snapshot",
            data: { query, matches: [], totalMatches: 0, offset: startOrdinal },
            warnings: boundedDocumentWarnings([
              ...warnings,
              ...snapshot.warnings,
            ]),
            provenance: documentProvenance(snapshot, snapshotResult.cache),
            bounds: {
              truncated: snapshot.truncated,
              returnedItems: 0,
              totalItems: 0,
              maxBytes: 48 * 1_024,
            },
          });
        }
        if (startOrdinal >= page.totalMatches || page.consumedMatches === 0) {
          return formatDocumentOutcome(
            errorOutcome("grep_url_content", {
              code: "invalid_request",
              message: "offset exceeds the available match count",
              retryable: false,
            }),
          );
        }

        const nextPosition = startOrdinal + page.consumedMatches;
        const hasMore = nextPosition < page.totalMatches;
        const nextOffset = hasMore ? nextPosition : undefined;
        const outcome: OutcomeEnvelope<GrepOutcomeData> = {
          operation: "grep_url_content",
          status: "ok",
          summary: `Returned ${page.consumedMatches} of ${page.totalMatches} literal matches`,
          data: {
            query,
            matches: page.matches,
            totalMatches: page.totalMatches,
            offset: startOrdinal,
            ...(nextOffset === undefined ? {} : { nextOffset }),
          },
          warnings: boundedDocumentWarnings([
            ...warnings,
            ...snapshot.warnings,
          ]),
          provenance: documentProvenance(snapshot, snapshotResult.cache),
          bounds: {
            truncated: snapshot.truncated || hasMore || page.truncated,
            returnedItems: page.consumedMatches,
            totalItems: page.totalMatches,
            maxBytes: 48 * 1_024,
          },
        };
        const formatted = formatDocumentOutcome(outcome);
        if (!wasFormatTruncated(formatted)) return formatted;
        if (pageChars > 1)
          pageChars = Math.max(1, Math.floor(pageChars * 0.75));
        if (pageMatches > 1) {
          pageMatches = Math.max(1, Math.floor(pageMatches * 0.75));
        } else if (pageChars === 1) {
          throw new InvariantError(
            "Document match metadata exceeds the protocol output budget",
          );
        }
      }

      throw new InvariantError("Unable to create bounded document matches");
    },
  });
}
