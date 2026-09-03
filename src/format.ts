import {
  boundJsonObjectBytes,
  byteLength,
  truncateUtf8,
  type JsonBounds,
} from "./bounds.js";
import {
  InvariantError,
  type JsonObject,
  type OutcomeEnvelope,
} from "./contracts.js";

export interface FormatBudget {
  maxContentBytes: number;
  maxDetailsBytes: number;
  maxEntries?: number;
  maxStringBytes?: number;
  maxArrayItems?: number;
}

export interface FormattedOutcome {
  content: [{ type: "text"; text: string }];
  details: JsonObject;
}

export const DEFAULT_FORMAT_BUDGET: Readonly<FormatBudget> = Object.freeze({
  maxContentBytes: 24_576,
  maxDetailsBytes: 24_576,
  maxStringBytes: 4_096,
  maxArrayItems: 100,
});

function defaultSummary(outcome: OutcomeEnvelope): string {
  switch (outcome.status) {
    case "ok":
      return `${outcome.operation} completed successfully`;
    case "no_results":
      return "No search results found";
    case "no_match":
      return "No matching document content found";
    case "error":
      return outcome.error?.message ?? `${outcome.operation} failed`;
  }
}

function validateOutcome(outcome: OutcomeEnvelope): void {
  if (outcome.status === "error" && !outcome.error) {
    throw new InvariantError(
      "An error outcome must include an operational error",
    );
  }
  if (outcome.status !== "error" && outcome.error) {
    throw new InvariantError(
      "Only error outcomes may include an operational error",
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function inline(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/[\r\n]+/g, " ");
}

function markdownHeading(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim() || "(untitled)";
}

function warningLines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).flatMap((item) => {
    if (!isRecord(item)) return [];
    const code = inline(stringValue(item.code, "warning"));
    const message = inline(stringValue(item.message, ""));
    return [`- \`${code}\`${message ? `: ${message}` : ""}`];
  });
}

function provenanceLines(value: unknown): string[] {
  if (!isRecord(value)) return [];
  const lines: string[] = [];
  const source = stringValue(value.finalUrl || value.requestedUrl);
  if (source) lines.push(`**Source:** ${inline(source)}`);
  const backend = stringValue(value.backend);
  if (backend) lines.push(`**Backend:** \`${inline(backend)}\``);
  const cache = isRecord(value.cache) ? stringValue(value.cache.status) : "";
  if (cache) lines.push(`**Cache:** \`${inline(cache)}\``);
  const model = stringValue(value.model);
  if (model) lines.push(`**Model:** \`${inline(model)}\``);
  return lines;
}

function boundsLines(value: unknown): string[] {
  if (!isRecord(value)) return [];
  const lines: string[] = [];
  if (value.truncated === true) lines.push("**Truncated:** yes");
  const returnedItems = numberValue(value.returnedItems, -1);
  const totalItems = numberValue(value.totalItems, -1);
  if (returnedItems >= 0 && totalItems >= 0) {
    lines.push(`**Items:** ${returnedItems} of ${totalItems}`);
  }
  const returnedChars = numberValue(value.returnedChars, -1);
  const totalChars = numberValue(value.totalChars, -1);
  if (returnedChars >= 0 && totalChars >= 0) {
    lines.push(`**Characters:** ${returnedChars} of ${totalChars}`);
  }
  return lines;
}

function formatWarningsAndMetadata(details: JsonObject): string[] {
  const lines: string[] = [
    ...provenanceLines(details.provenance),
    ...boundsLines(details.bounds),
  ];
  const warnings = warningLines(details.warnings);
  if (warnings.length > 0) lines.push("**Warnings:**", ...warnings);
  return lines;
}

function formatSearch(details: JsonObject): string[] {
  const data = isRecord(details.data) ? details.data : undefined;
  const query = stringValue(data?.query);
  const results = Array.isArray(data?.results) ? data.results : [];
  const lines = [`# Search results`, `**Query:** ${inline(query)}`];
  if (results.length === 0) {
    lines.push("", "No results found.");
  } else {
    lines.push("", `Found ${results.length} result(s):`);
    results.forEach((item, index) => {
      if (!isRecord(item)) return;
      const title = markdownHeading(stringValue(item.title, "(untitled)"));
      const url = stringValue(item.url);
      const linkedTitle = title.replace(/\[/g, "\\[").replace(/\]/g, "\\]");
      const snippet = inline(stringValue(item.snippet));
      lines.push(
        `\n### ${index + 1}. ${url ? `[${linkedTitle}](<${url}>)` : linkedTitle}`,
      );
      if (snippet) lines.push(snippet);
      const engine = stringValue(item.engine);
      if (engine) lines.push(`Engine: \`${inline(engine)}\``);
    });
  }
  return lines;
}

function formatRead(details: JsonObject): string[] {
  const data = isRecord(details.data) ? details.data : undefined;
  const content = stringValue(data?.content);
  const lines = ["# URL content", content];
  return lines;
}

function formatGrep(details: JsonObject): string[] {
  const data = isRecord(details.data) ? details.data : undefined;
  const query = stringValue(data?.query);
  const matches = Array.isArray(data?.matches) ? data.matches : [];
  const total = numberValue(data?.totalMatches, matches.length);
  const offset = numberValue(data?.offset, 0);
  const returned = matches.reduce<number>((count, item) => {
    if (!isRecord(item)) return count;
    return count + Math.max(1, Math.floor(numberValue(item.matchCount, 1)));
  }, 0);
  const lines = [
    "# Literal matches",
    `**Query:** \`${inline(query)}\``,
    `**Matches:** ${returned} of ${total}`,
  ];
  if (returned > 0) {
    lines.push(
      `**Range:** matches ${offset + 1}-${offset + returned} of ${total}`,
    );
  }
  const nextOffset = numberValue(data?.nextOffset, -1);
  if (nextOffset >= 0) lines.push(`**Next offset:** ${nextOffset}`);
  if (matches.length === 0)
    lines.push("", "No matching document content found.");
  matches.forEach((item, index) => {
    if (!isRecord(item)) return;
    const line = numberValue(item.line, 0);
    const endLine = numberValue(item.endLine, line);
    const heading = stringValue(item.heading);
    const quote = stringValue(item.quote);
    lines.push(
      "",
      `### Match ${index + 1} · lines ${line}-${endLine}`,
      ...(heading ? [`**Heading:** ${inline(heading)}`] : []),
      ...quote.split("\n").map((part) => `> ${part}`),
    );
  });
  return lines;
}

function formatSummary(details: JsonObject): string[] {
  const data = isRecord(details.data) ? details.data : undefined;
  const summary = stringValue(data?.summary, stringValue(details.summary));
  const generation = isRecord(data?.generation) ? data.generation : undefined;
  const lines = ["# Summary", summary];
  if (data?.title)
    lines.push("", `**Title:** ${inline(stringValue(data.title))}`);
  if (data?.objective)
    lines.push("", `**Objective:** ${inline(stringValue(data.objective))}`);
  if (generation) {
    const provider = stringValue(generation.provider);
    const model = stringValue(generation.model);
    if (provider || model)
      lines.push(
        `**Model:** \`${inline([provider, model].filter(Boolean).join("/"))}\``,
      );
    const thinking = stringValue(generation.thinkingLevel);
    if (thinking) lines.push(`**Thinking level:** \`${inline(thinking)}\``);
  }
  return lines;
}

/** Build bounded human-readable Markdown from the already-bounded details envelope. */
export function formatOutcomeMarkdown(details: JsonObject): string {
  const operation = stringValue(details.operation, "tool");
  const status = stringValue(details.status);
  if (status === "error") {
    const error = isRecord(details.error) ? details.error : undefined;
    const message = inline(
      stringValue(
        error?.message,
        stringValue(details.summary, `${operation} failed`),
      ),
    );
    const code = inline(stringValue(error?.code, "unknown"));
    return [
      `**${operation} failed:** ${message}`,
      `Error code: \`${code}\``,
    ].join("\n\n");
  }

  let lines: string[];
  switch (operation) {
    case "search_web":
      lines = formatSearch(details);
      break;
    case "read_url_content":
      lines = formatRead(details);
      break;
    case "grep_url_content":
      lines = formatGrep(details);
      break;
    case "summarize_url_content":
      lines = formatSummary(details);
      break;
    default:
      lines = [
        `# ${markdownHeading(operation)}`,
        inline(stringValue(details.summary)),
      ];
  }
  const metadata = formatWarningsAndMetadata(details);
  if (metadata.length > 0) lines.push("", "---", ...metadata);
  return lines.join("\n").trim();
}

export function formatOutcome(
  outcome: OutcomeEnvelope,
  budget: FormatBudget = DEFAULT_FORMAT_BUDGET,
): FormattedOutcome {
  validateOutcome(outcome);
  const maxContentBytes = Math.max(256, Math.floor(budget.maxContentBytes));
  const maxDetailsBytes = Math.max(256, Math.floor(budget.maxDetailsBytes));
  const sharedBudget = Math.min(maxContentBytes, maxDetailsBytes);
  const summary = outcome.summary.trim() || defaultSummary(outcome);
  const candidate = {
    ...outcome,
    summary,
    format: { truncated: false },
  };
  const jsonBounds: JsonBounds = {
    maxDepth: 8,
    maxEntries: budget.maxEntries ?? 200,
    maxArrayItems: budget.maxArrayItems ?? 100,
    maxStringBytes: budget.maxStringBytes ?? 4_096,
  };

  let bounded = boundJsonObjectBytes(candidate, sharedBudget, jsonBounds);
  if (bounded.truncated) {
    bounded = boundJsonObjectBytes(
      { ...candidate, format: { truncated: true } },
      sharedBudget,
      jsonBounds,
    );
  }
  const details = bounded.value;
  let text = formatOutcomeMarkdown(details);
  if (byteLength(text) > maxContentBytes) {
    text = truncateUtf8(text, maxContentBytes).value;
    if (isRecord(details.format)) {
      details.format = { ...details.format, truncated: true };
    }
  }
  if (!text.trim())
    text = `${operationLabel(details)} completed without visible output`;

  return {
    content: [{ type: "text", text }],
    details,
  };
}

function operationLabel(details: JsonObject): string {
  return stringValue(details.operation, "Tool");
}
