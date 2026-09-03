import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { formatOutcome } from "../src/format.js";
import { renderToolCall, renderToolResult } from "../src/tools/rendering.js";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

function rendered(
  component: { render(width: number): string[] },
  width = 80,
): string {
  return component.render(width).join("\n");
}

describe("tool presentation renderers", () => {
  it("renders compact calls without argument JSON", () => {
    const call = rendered(
      renderToolCall(
        "summarize_url_content",
        {
          url: "https://example.test/article",
          objective: "Find the key decision",
          mode: "main",
        },
        theme,
      ),
    );
    assert.match(call, /summarize_url_content/);
    assert.match(call, /https:\/\/example\.test\/article/);
    assert.match(call, /Find the key decision/);
    assert.doesNotMatch(call, /\"objective\"/);
  });

  it("uses the full tool name for every rendered call", () => {
    for (const operation of [
      "search_web",
      "read_url_content",
      "grep_url_content",
      "summarize_url_content",
    ] as const) {
      assert.match(
        rendered(renderToolCall(operation, {}, theme)),
        new RegExp(operation),
      );
    }
  });

  it("switches between compact and complete search results", () => {
    const result = formatOutcome({
      operation: "search_web",
      status: "ok",
      summary: "Found results",
      data: {
        query: "pi",
        results: [
          {
            title: "First result",
            url: "https://example.test/first",
            snippet: "First snippet",
          },
          {
            title: "Second result",
            url: "https://example.test/second",
            snippet: "Second snippet",
          },
          {
            title: "Third result",
            url: "https://example.test/third",
            snippet: "Third snippet",
          },
          {
            title: "Fourth result",
            url: "https://example.test/fourth",
            snippet: "Fourth snippet",
          },
        ],
      },
    });
    const collapsed = rendered(
      renderToolResult("search_web", result, false, theme),
    );
    const expanded = rendered(
      renderToolResult("search_web", result, true, theme),
    );
    assert.match(collapsed, /4 result\(s\)/);
    assert.match(collapsed, /First result/);
    assert.match(collapsed, /1 more/);
    assert.doesNotMatch(collapsed, /Fourth snippet/);
    assert.match(expanded, /Fourth snippet/);
    assert.match(expanded, /https:\/\/example\.test\/fourth/);
    assert.ok(collapsed.length < expanded.length);
  });

  it("keeps the useful beginning of collapsed output at narrow widths", () => {
    const result = formatOutcome({
      operation: "search_web",
      status: "ok",
      summary: "Found results",
      data: {
        query: "pi",
        results: [
          {
            title: "First result",
            url: "https://example.test/first",
            snippet: "First snippet",
          },
          {
            title: "Second result",
            url: "https://example.test/second",
            snippet: "Second snippet",
          },
          {
            title: "Third result",
            url: "https://example.test/third",
            snippet: "Third snippet",
          },
          {
            title: "Fourth result",
            url: "https://example.test/fourth",
            snippet: "Fourth snippet",
          },
        ],
      },
    });
    const collapsed = rendered(
      renderToolResult("search_web", result, false, theme),
      8,
    );
    assert.match(collapsed, /4/);
    assert.match(collapsed, /First/);
  });

  it("renders read, grep, and summary previews with full expanded content", () => {
    const read = {
      content: [{ type: "text", text: "# Article\n\nFull body text" }],
      details: {
        operation: "read_url_content",
        status: "ok",
        summary: "Returned normalized content",
        data: { content: "# Article\n\nFull body text" },
        provenance: { finalUrl: "https://example.test/article" },
      },
    };
    const grep = formatOutcome({
      operation: "grep_url_content",
      status: "ok",
      summary: "Returned matches",
      data: {
        query: "target",
        matches: [
          {
            line: 10,
            endLine: 10,
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
    const summary = formatOutcome({
      operation: "summarize_url_content",
      status: "ok",
      summary: "Generated summary",
      data: {
        summary: "A complete generated answer with useful context.",
        generation: {
          provider: "fake",
          model: "model",
          selection: "active",
          modelCalls: 1,
          documentToolCalls: 0,
        },
      },
    });

    for (const [operation, result, preview, complete] of [
      ["read_url_content", read, "Full body text", "Full body text"],
      ["grep_url_content", grep, "target value", "target value"],
      [
        "summarize_url_content",
        summary,
        "complete generated answer",
        "useful context",
      ],
    ] as const) {
      const collapsed = rendered(
        renderToolResult(operation, result, false, theme),
      );
      const expanded = rendered(
        renderToolResult(operation, result, true, theme),
      );
      assert.match(collapsed, new RegExp(preview));
      assert.match(expanded, new RegExp(complete));
      assert.ok(collapsed.length <= expanded.length);
    }
  });

  it("falls back to content for malformed details", () => {
    const result = {
      content: [{ type: "text", text: "Readable fallback" }],
      details: { malformed: true },
    };
    assert.match(
      rendered(renderToolResult("search_web", result, true, theme)),
      /Readable fallback/,
    );
    assert.match(
      rendered(renderToolResult("search_web", result, false, theme)),
      /Readable fallback/,
    );
  });
});
