import {
  keyHint,
  truncateToVisualLines,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { truncateChars } from "../bounds.js";
import { formatOutcomeMarkdown } from "../format.js";
import type { ToolOperation } from "../contracts.js";

export interface StructuralComponent {
  render(width: number): string[];
  invalidate(): void;
}

interface TextBlock {
  type?: string;
  text?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function bounded(value: unknown, max = 180): string {
  return truncateChars(stringValue(value), max).value.replace(/[\r\n]+/g, " ");
}

function resultDetails(result: unknown): Record<string, unknown> | undefined {
  if (!isRecord(result) || !isRecord(result.details)) return undefined;
  if (
    typeof result.details.operation !== "string" ||
    typeof result.details.status !== "string"
  ) {
    return undefined;
  }
  return result.details;
}

function resultContent(result: unknown): string {
  if (!isRecord(result) || !Array.isArray(result.content)) return "";
  const block = result.content.find(
    (candidate): candidate is TextBlock =>
      isRecord(candidate) &&
      candidate.type === "text" &&
      typeof candidate.text === "string",
  );
  return block?.text ?? "";
}

function outputComponent(
  text: string,
  expanded: boolean,
  theme: Theme,
): StructuralComponent {
  const hint = (() => {
    try {
      return keyHint(
        "app.tools.expand",
        expanded ? "to collapse" : "to expand",
      );
    } catch {
      return expanded ? "to collapse" : "to expand";
    }
  })();
  const display = expanded ? text : `${text}\n${theme.fg("dim", `(${hint})`)}`;
  let cachedWidth: number | undefined;
  let cachedLines: string[] | undefined;
  return {
    render(width: number): string[] {
      if (cachedLines && cachedWidth === width) return cachedLines;
      const lineLimit = expanded ? 1_000_000 : 8;
      cachedLines = truncateToVisualLines(
        display,
        lineLimit,
        Math.max(1, width),
        0,
      ).visualLines;
      cachedWidth = width;
      return cachedLines;
    },
    invalidate(): void {
      cachedWidth = undefined;
      cachedLines = undefined;
    },
  };
}

function argumentText(value: unknown, max = 160): string {
  if (typeof value === "string") return bounded(value, max);
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return "";
}

/** Render a compact, non-JSON invocation line for the Pi tool row. */
export function renderToolCall(
  operation: ToolOperation,
  args: unknown,
  theme: Theme,
): StructuralComponent {
  const input = isRecord(args) ? args : {};
  const label = operation.replace(/_url_content|_web/g, "");
  const parts: string[] = [theme.fg("toolTitle", theme.bold(label))];
  const url = argumentText(input.url, 220);
  if (url) parts.push(theme.fg("muted", url));
  const query = argumentText(input.query, 180);
  if (query) parts.push(theme.fg("accent", `"${query}"`));
  const objective = argumentText(input.objective, 180);
  if (objective) parts.push(theme.fg("muted", `— ${objective}`));
  const mode = argumentText(input.mode, 30);
  if (mode && mode !== "main") parts.push(theme.fg("dim", `mode=${mode}`));
  const selector = argumentText(input.selector, 120);
  if (selector) parts.push(theme.fg("dim", `selector=${selector}`));
  const cursor = argumentText(input.cursor, 48);
  if (cursor) parts.push(theme.fg("dim", `cursor=${cursor}`));
  return outputComponent(parts.join(" "), true, theme);
}

function collapsedResult(
  operation: ToolOperation,
  details: Record<string, unknown> | undefined,
  content: string,
  theme: Theme,
): string {
  if (!details) {
    return (
      content.split("\n").filter(Boolean).slice(0, 5).join("\n") ||
      "No result details"
    );
  }
  const status = stringValue(details.status);
  if (status === "error") {
    const error = isRecord(details.error) ? details.error : undefined;
    return `${theme.fg("error", "✗")} ${bounded(error?.message ?? details.summary, 300)}\nError code: ${bounded(error?.code, 80)}`;
  }

  const data = isRecord(details.data) ? details.data : undefined;
  switch (operation) {
    case "search_web": {
      const results = Array.isArray(data?.results) ? data.results : [];
      const lines = [`${theme.fg("success", "✓")} ${results.length} result(s)`];
      for (const item of results.slice(0, 3)) {
        if (isRecord(item)) lines.push(`• ${bounded(item.title, 160)}`);
      }
      if (results.length > 3) lines.push(`… ${results.length - 3} more`);
      return lines.join("\n");
    }
    case "read_url_content": {
      const source = isRecord(details.provenance)
        ? stringValue(
            details.provenance.finalUrl ?? details.provenance.requestedUrl,
          )
        : "";
      const preview = bounded(data?.content, 220);
      return [
        `${theme.fg("success", "✓")} ${source || "Read URL content"}`,
        preview || bounded(details.summary, 220),
      ].join("\n");
    }
    case "grep_url_content": {
      const matches = Array.isArray(data?.matches) ? data.matches : [];
      const total =
        typeof data?.totalMatches === "number"
          ? data.totalMatches
          : matches.length;
      const first = matches[0];
      return [
        `${theme.fg("success", "✓")} ${matches.length} match(es) of ${total} for "${bounded(data?.query, 120)}"`,
        isRecord(first)
          ? `• ${bounded(first.quote, 220)}`
          : "No matching document content found.",
      ].join("\n");
    }
    case "summarize_url_content": {
      const generation = isRecord(data?.generation)
        ? data.generation
        : undefined;
      const model = generation
        ? [generation.provider, generation.model].filter(Boolean).join("/")
        : "";
      return [
        `${theme.fg("success", "✓")} ${model ? `Summary · ${bounded(model, 140)}` : "Summary"}`,
        bounded(data?.summary ?? details.summary, 260),
      ].join("\n");
    }
  }
}

/** Render a result using Pi's global expanded/collapsed state. */
export function renderToolResult(
  operation: ToolOperation,
  result: unknown,
  expanded: boolean,
  theme: Theme,
): StructuralComponent {
  const details = resultDetails(result);
  const content = resultContent(result);
  const readable = details ? formatOutcomeMarkdown(details as never) : content;
  const text = expanded
    ? content || readable
    : collapsedResult(operation, details, content || readable, theme);
  return outputComponent(text || "No visible result", expanded, theme);
}
