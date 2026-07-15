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
    maxEntries: 200,
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
  const compact = JSON.stringify(details);
  const pretty = JSON.stringify(details, null, 2);
  let text = byteLength(pretty) <= maxContentBytes ? pretty : compact;
  if (byteLength(text) > maxContentBytes) {
    text = truncateUtf8(text, maxContentBytes).value;
  }
  if (!text.trim())
    text = '{"status":"error","summary":"Empty formatted outcome"}';

  return {
    content: [{ type: "text", text }],
    details,
  };
}
