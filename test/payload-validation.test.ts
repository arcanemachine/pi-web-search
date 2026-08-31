import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseBravePayload,
  parseSearxngPayload,
} from "../src/search/validation.js";

describe("backend payload validation", () => {
  it("normalizes SearXNG results and diagnostics", () => {
    const parsed = parseSearxngPayload({
      results: [
        {
          title: "Docs",
          url: "https://example.com/docs",
          content: "Reference",
        },
      ],
      unresponsive_engines: [["engine", "timeout"]],
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.value.results[0].snippet, "Reference");
      assert.equal(parsed.value.diagnostics[0].code, "engine_unresponsive");
    }
  });

  it("rejects malformed SearXNG native data", () => {
    const parsed = parseSearxngPayload({ results: "not-an-array" });
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.equal(parsed.error.code, "parse_failed");
  });

  it("normalizes Brave web results and optional descriptions", () => {
    const parsed = parseBravePayload({
      web: {
        results: [
          {
            title: "Docs",
            url: "https://example.com/docs",
            description: "Reference",
          },
          { title: "Other", url: "https://example.com/other" },
        ],
      },
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.value.results[0].engine, "brave");
      assert.equal(parsed.value.results[0].snippet, "Reference");
      assert.equal(parsed.value.results[1].snippet, "");
    }
  });

  it("accepts missing or null Brave web and rejects malformed shapes", () => {
    const missing = parseBravePayload({});
    assert.equal(missing.ok, true);
    if (missing.ok) assert.deepEqual(missing.value, { results: [] });
    const nullable = parseBravePayload({ web: null });
    assert.equal(nullable.ok, true);
    if (nullable.ok) assert.deepEqual(nullable.value, { results: [] });
    for (const value of [
      { web: "wrong" },
      { web: { results: "wrong" } },
      { web: { results: [{ title: "Missing URL" }] } },
      { web: { results: [{ title: "Bad", url: "file:///tmp/x" }] } },
      {
        web: {
          results: [{ title: "Bad", url: "https://user:pass@example.com" }],
        },
      },
    ]) {
      const parsed = parseBravePayload(value);
      assert.equal(parsed.ok, false);
      if (!parsed.ok) assert.equal(parsed.error.code, "parse_failed");
    }
  });
});
