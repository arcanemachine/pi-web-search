import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { byteLength } from "../src/bounds.js";
import {
  InvariantError,
  OPERATIONAL_ERROR_CODES,
  operationalError,
  type OutcomeEnvelope,
} from "../src/contracts.js";
import { formatOutcome } from "../src/format.js";

const expectedOutcomes: OutcomeEnvelope[] = [
  {
    operation: "search_web",
    status: "ok",
    summary: "Found one result",
    data: {
      results: [{ title: "Pi", url: "https://example.com", snippet: "Docs" }],
    },
  },
  {
    operation: "search_web",
    status: "no_results",
    summary: "No results found",
    data: { results: [] },
  },
  {
    operation: "grep_url_content",
    status: "no_match",
    summary: "No matching text found",
    data: { matches: [] },
  },
  {
    operation: "read_url_content",
    status: "error",
    summary: "Timed out",
    error: operationalError("timeout", "Timed out", true),
  },
];

describe("outcome formatter", () => {
  it("returns non-empty content for every expected outcome", () => {
    for (const outcome of expectedOutcomes) {
      const result = formatOutcome(outcome);
      assert.ok(result.content[0].text.trim());
      assert.equal(result.details.status, outcome.status);
    }
  });

  it("renders readable Markdown for search, grep, and summary outcomes", () => {
    const search = formatOutcome({
      operation: "search_web",
      status: "ok",
      summary: "Found results",
      data: {
        query: "pi",
        results: [
          {
            title: "Pi docs",
            url: "https://example.com/docs",
            snippet: "Useful documentation",
          },
        ],
      },
    });
    assert.match(search.content[0].text, /^# Search results/);
    assert.match(search.content[0].text, /\[Pi docs\]/);
    assert.doesNotMatch(search.content[0].text, /\"results\"/);

    const grep = formatOutcome({
      operation: "grep_url_content",
      status: "ok",
      summary: "Found a match",
      data: {
        query: "target",
        matches: [
          {
            line: 3,
            endLine: 3,
            quote: "target value",
            startOffset: 0,
            endOffset: 12,
            quoteStartOffset: 0,
            quoteEndOffset: 12,
            matchCount: 1,
          },
        ],
        totalMatches: 1,
      },
    });
    assert.match(grep.content[0].text, /^# Literal matches/);
    assert.match(grep.content[0].text, /> target value/);

    const pagedGrep = formatOutcome({
      operation: "grep_url_content",
      status: "ok",
      summary: "Found more matches",
      data: {
        query: "target",
        offset: 2,
        nextOffset: 4,
        matches: [
          {
            line: 8,
            endLine: 8,
            quote: "target value",
            startOffset: 0,
            endOffset: 12,
            quoteStartOffset: 0,
            quoteEndOffset: 12,
            matchCount: 1,
          },
          {
            line: 12,
            endLine: 12,
            quote: "target value",
            startOffset: 0,
            endOffset: 12,
            quoteStartOffset: 0,
            quoteEndOffset: 12,
            matchCount: 1,
          },
        ],
        totalMatches: 6,
      },
      bounds: { truncated: true, returnedItems: 2, totalItems: 6 },
    });
    assert.match(pagedGrep.content[0].text, /\*\*Matches:\*\* 2 of 6/);
    assert.match(pagedGrep.content[0].text, /\*\*Range:\*\* matches 3-4 of 6/);
    assert.match(pagedGrep.content[0].text, /\*\*Next offset:\*\* 4/);

    const summary = formatOutcome({
      operation: "summarize_url_content",
      status: "ok",
      summary: "Generated summary",
      data: {
        summary: "The useful generated answer.",
        generation: {
          provider: "fake",
          model: "model",
          selection: "active",
          modelCalls: 1,
          documentToolCalls: 0,
        },
      },
    });
    assert.match(summary.content[0].text, /^# Summary/);
    assert.match(summary.content[0].text, /useful generated answer/);
    assert.doesNotMatch(summary.content[0].text, /\"generation\"/);
  });

  it("returns non-empty content for every operational error code", () => {
    for (const code of OPERATIONAL_ERROR_CODES) {
      const formatted = formatOutcome({
        operation: "search_web",
        status: "error",
        summary: `${code} failure`,
        error: operationalError(code, `${code} failure`, false),
      });
      assert.ok(formatted.content[0].text.trim());
      assert.equal((formatted.details.error as { code?: string }).code, code);
    }
  });

  it("bounds both model-visible content and serialized details", () => {
    const results = Array.from({ length: 200 }, (_, index) => ({
      title: `Result ${index} ${"界".repeat(2_000)}`,
      url: `https://example.com/${index}`,
      snippet: "x".repeat(8_000),
    }));
    const formatted = formatOutcome(
      {
        operation: "search_web",
        status: "ok",
        summary: "Large result set",
        data: { results },
      },
      {
        maxContentBytes: 2_048,
        maxDetailsBytes: 2_048,
        maxArrayItems: 200,
        maxStringBytes: 8_000,
      },
    );

    assert.ok(byteLength(formatted.content[0].text) <= 2_048);
    assert.ok(byteLength(JSON.stringify(formatted.details)) <= 2_048);
    assert.ok(formatted.content[0].text.trim());
  });

  it("keeps invariant failures distinct from operational error outcomes", () => {
    assert.throws(
      () =>
        formatOutcome({
          operation: "search_web",
          status: "error",
          summary: "missing structured error",
        }),
      InvariantError,
    );

    const operational = formatOutcome({
      operation: "search_web",
      status: "error",
      summary: "Backend unavailable",
      error: operationalError(
        "backend_unavailable",
        "Backend unavailable",
        true,
      ),
    });
    assert.equal(operational.details.status, "error");
    assert.equal(
      (operational.details.error as { code?: string }).code,
      "backend_unavailable",
    );
  });
});
