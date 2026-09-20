import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateChars } from "../bounds.js";
import {
  errorOutcome,
  InvariantError,
  type Diagnostic,
  type OutcomeEnvelope,
  type ReadOutcomeData,
} from "../contracts.js";
import { readSnapshotPage } from "../documents/page.js";
import { normalizeDocumentOptions } from "../documents/types.js";
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
      "Continue a page by repeating the same URL, mode, and selector and setting offset to the returned nextOffset; maxChars may change between calls.",
      "Offsets count normalized Unicode characters; an offset past the end returns an empty result at the document end.",
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
      const mode = input.mode === "full" ? "full" : "main";
      const options = normalizeDocumentOptions(input.url, mode, input.selector);
      const requestedMaxChars = input.maxChars ?? runtime.config.readMaxChars;
      const maxChars = Math.min(
        requestedMaxChars,
        runtime.config.readMaxLimitChars,
      );
      const warnings: Diagnostic[] = [];
      const maxWarning = clampWarning("maxChars", requestedMaxChars, maxChars);
      if (maxWarning) warnings.push(maxWarning);

      const snapshotResult = await runtime.service.getSnapshot(
        options,
        input.forceRefresh ?? false,
        signal,
      );
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

      const requestedOffset = input.offset ?? 0;
      const start = Math.min(requestedOffset, snapshot.characterCount);
      if (start !== requestedOffset) {
        warnings.push({
          code: "offset_clamped",
          message: `offset=${requestedOffset} was clamped to ${start}`,
          source: "local",
        });
      }

      let pageBudget = maxChars;
      while (pageBudget >= 1) {
        const page = readSnapshotPage(snapshot, start, pageBudget);
        const hasMore = page.end < page.total;
        const nextOffset = hasMore ? page.end : undefined;
        const outcome: OutcomeEnvelope<ReadOutcomeData> = {
          operation: "read_url_content",
          status: "ok",
          summary: `Returned normalized characters ${page.start}-${page.end} of ${page.total}`,
          data: {
            content: page.content,
            ...(snapshot.title
              ? { title: truncateChars(snapshot.title, 300).value }
              : {}),
            offset: page.start,
            endOffset: page.end,
            totalChars: page.total,
            ...(nextOffset === undefined ? {} : { nextOffset }),
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
          ...(nextOffset === undefined ? {} : { nextOffset }),
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
