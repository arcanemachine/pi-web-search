import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateChars } from "../bounds.js";
import {
  errorOutcome,
  InvariantError,
  type Diagnostic,
  type OutcomeEnvelope,
  type ReadOutcomeData,
} from "../contracts.js";
import { optionsHash } from "../documents/cursor.js";
import { readSnapshotPage } from "../documents/page.js";
import {
  ReadUrlContentParams,
  type ReadUrlContentParams as ReadInput,
  validateReadUrlContentRequest,
} from "./schemas.js";
import {
  boundedDocumentWarnings,
  clampWarning,
  documentProvenance,
  formatReadDocumentOutcome,
  type DocumentToolRuntime,
} from "./document-shared.js";
import { renderToolCall, renderToolResult } from "./rendering.js";

export function registerReadUrlContentTool(
  pi: ExtensionAPI,
  getRuntime: () => DocumentToolRuntime,
): void {
  const effective = getRuntime().config;
  pi.registerTool({
    name: "read_url_content",
    label: "Read URL Content",
    description: `Fetch and normalize static HTTP(S) content into bounded pages (default ${effective.readMaxChars}, maximum ${effective.readMaxLimitChars} characters).`,
    promptSnippet: "Read a page from a static URL snapshot.",
    promptGuidelines: [
      "Use read_url_content when exact source text, quotations, code, commands, precise wording, manual inspection, or deliberate pagination is needed.",
      "For understanding, explaining, synthesizing, or evaluating one known static page, prefer summarize_url_content when it is available instead of reading the page first.",
      "Use cursors to continue the exact cached snapshot when deliberate pagination is needed.",
      "If static extraction returns a client-rendered shell, use Playwright or another JavaScript-capable browser.",
      "For broad, multi-page, context-heavy, or page-summary research, delegate to a suitable research subagent when available.",
    ],
    parameters: ReadUrlContentParams,

    renderCall(args, theme) {
      return renderToolCall("read_url_content", args, theme);
    },

    renderResult(result, { expanded }, theme) {
      return renderToolResult("read_url_content", result, expanded, theme);
    },

    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const runtime = getRuntime();
      const validation = validateReadUrlContentRequest(params);
      if (validation) {
        return formatReadDocumentOutcome(
          errorOutcome("read_url_content", validation),
        );
      }
      const input = params as ReadInput;
      const parsedUrl = new URL(input.url);
      parsedUrl.hash = "";
      const url = parsedUrl.toString();
      const mode = input.mode === "full" ? "full" : "main";
      const selector = input.selector?.trim() || undefined;
      const requestedMaxChars = input.maxChars ?? runtime.config.readMaxChars;
      const maxChars = Math.min(
        requestedMaxChars,
        runtime.config.readMaxLimitChars,
      );
      const warnings: Diagnostic[] = [];
      const maxWarning = clampWarning("maxChars", requestedMaxChars, maxChars);
      if (maxWarning) warnings.push(maxWarning);
      const hash = optionsHash({
        url,
        mode,
        selector: selector ?? null,
        maxChars,
      });

      let start = 0;
      let snapshotResult;
      if (input.cursor) {
        const decoded = runtime.cursors.decode(input.cursor, "read", hash);
        if (decoded.error) {
          return formatReadDocumentOutcome(
            errorOutcome("read_url_content", decoded.error),
          );
        }
        start = decoded.value.position;
        snapshotResult = runtime.service.getSnapshotById(
          decoded.value.snapshotId,
        );
      } else {
        snapshotResult = await runtime.service.getSnapshot(
          { url, mode, ...(selector ? { selector } : {}) },
          input.forceRefresh ?? false,
          signal,
        );
      }
      if (snapshotResult.error) {
        return formatReadDocumentOutcome(
          errorOutcome("read_url_content", snapshotResult.error),
        );
      }
      const snapshot = snapshotResult.snapshot;
      if (!snapshot) {
        throw new InvariantError(
          "Document snapshot result is missing a snapshot",
        );
      }
      if (start >= snapshot.characterCount && snapshot.characterCount > 0) {
        throw new InvariantError("Read cursor position exceeds its snapshot");
      }

      let pageBudget = maxChars;
      while (pageBudget >= 1) {
        const page = readSnapshotPage(snapshot, start, pageBudget);
        const hasMore = page.end < page.total;
        const nextCursor =
          hasMore && snapshotResult.cache.storedAt
            ? runtime.cursors.encode({
                snapshotId: snapshot.id,
                operation: "read",
                position: page.end,
                optionsHash: hash,
              })
            : undefined;
        const outcome: OutcomeEnvelope<ReadOutcomeData> = {
          operation: "read_url_content",
          status: "ok",
          summary: `Returned normalized characters ${page.start}-${page.end} of ${page.total}`,
          data: {
            content: page.content,
            ...(snapshot.title
              ? { title: truncateChars(snapshot.title, 300).value }
              : {}),
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
            returnedChars: page.end - page.start,
            totalChars: page.total,
            maxBytes: 48 * 1_024,
          },
        };
        const formatted = formatReadDocumentOutcome(outcome, {
          source: page.content,
          contentType: snapshot.contentType,
          finalUrl: snapshot.finalUrl,
          start: page.start,
          end: page.end,
          total: page.total,
          truncated: snapshot.truncated || hasMore,
          ...(nextCursor ? { nextCursor } : {}),
        });
        if (formatted) return formatted;
        if (pageBudget === 1) {
          throw new InvariantError(
            "Document metadata exceeds the protocol output budget",
          );
        }
        pageBudget = Math.max(1, Math.floor(pageBudget * 0.75));
      }

      throw new InvariantError("Unable to create a bounded document page");
    },
  });
}
