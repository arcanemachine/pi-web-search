import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  errorOutcome,
  InvariantError,
  type Diagnostic,
  type GrepOutcomeData,
  type OutcomeEnvelope,
} from "../contracts.js";
import { optionsHash } from "../documents/cursor.js";
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

export function registerGrepUrlContentTool(
  pi: ExtensionAPI,
  getRuntime: () => DocumentToolRuntime,
): void {
  const effective = getRuntime().config;
  pi.registerTool({
    name: "grep_url_content",
    label: "Grep URL Content",
    description: `Find literal text in a shared normalized document snapshot. Defaults to ${effective.grepMaxMatches} matches and ${effective.grepMaxChars} quote characters; requests are clamped to configured hard caps.`,
    promptSnippet:
      "Find bounded literal matches in a normalized static-document snapshot with exact quotes, locators, and stable pagination.",
    promptGuidelines: [
      "Use grep_url_content for targeted literal extraction from known or likely static URLs.",
      "Use the returned cursor to continue matching against the exact same snapshot.",
      "If available, prefer a suitable research subagent for broad, multi-page, or context-heavy investigation.",
      "If static extraction reports a client-rendered shell, prefer Playwright or another JavaScript-capable browser.",
    ],
    parameters: GrepUrlContentParams,

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
      const hash = optionsHash({
        url,
        query,
        beforeLines,
        afterLines,
        maxMatches,
        maxChars,
        caseSensitive,
        selector: selector ?? null,
      });

      let startOrdinal = 0;
      let snapshotResult;
      if (input.cursor) {
        const decoded = runtime.cursors.decode(input.cursor, "grep", hash);
        if (decoded.error) {
          return formatDocumentOutcome(
            errorOutcome("grep_url_content", decoded.error),
          );
        }
        startOrdinal = decoded.value.position;
        snapshotResult = runtime.service.getSnapshotById(
          decoded.value.snapshotId,
        );
      } else {
        snapshotResult = await runtime.service.getSnapshot(
          { url, mode: "main", ...(selector ? { selector } : {}) },
          input.forceRefresh ?? false,
          signal,
        );
      }
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
            data: { query, matches: [], totalMatches: 0 },
            warnings: boundedDocumentWarnings([
              ...warnings,
              ...snapshot.warnings,
            ]),
            provenance: documentProvenance(snapshot, snapshotResult.cache),
            bounds: {
              truncated: snapshot.truncated,
              returnedItems: 0,
              totalItems: 0,
              returnedChars: 0,
              totalChars: snapshot.characterCount,
              maxBytes: 48 * 1_024,
            },
          });
        }
        if (startOrdinal >= page.totalMatches || page.consumedMatches === 0) {
          throw new InvariantError(
            "Grep cursor position exceeds its snapshot matches",
          );
        }

        const nextPosition = startOrdinal + page.consumedMatches;
        const hasMore = nextPosition < page.totalMatches;
        const nextCursor =
          hasMore && snapshotResult.cache.storedAt
            ? runtime.cursors.encode({
                snapshotId: snapshot.id,
                operation: "grep",
                position: nextPosition,
                optionsHash: hash,
              })
            : undefined;
        const returnedChars = page.matches.reduce(
          (total, match) => total + [...match.quote].length,
          0,
        );
        const outcome: OutcomeEnvelope<GrepOutcomeData> = {
          operation: "grep_url_content",
          status: "ok",
          summary: `Returned ${page.consumedMatches} of ${page.totalMatches} literal matches`,
          data: {
            query,
            matches: page.matches,
            totalMatches: page.totalMatches,
            ...(input.cursor ? { cursor: input.cursor } : {}),
            ...(nextCursor ? { nextCursor } : {}),
          },
          warnings: boundedDocumentWarnings([
            ...warnings,
            ...snapshot.warnings,
          ]),
          provenance: documentProvenance(snapshot, snapshotResult.cache),
          bounds: {
            truncated: snapshot.truncated || hasMore,
            returnedItems: page.consumedMatches,
            totalItems: page.totalMatches,
            returnedChars,
            totalChars: snapshot.characterCount,
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
