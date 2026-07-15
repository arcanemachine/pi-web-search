import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseDdgrPayload,
  parseSearxngPayload,
} from "../src/search/validation.js";

describe("backend payload validation", () => {
  it("normalizes validated ddgr output", () => {
    const parsed = parseDdgrPayload([
      { title: "Docs", url: "https://example.com/docs", abstract: "Reference" },
    ]);
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.value[0].snippet, "Reference");
  });

  it("rejects malformed ddgr output", () => {
    const parsed = parseDdgrPayload([{ title: "Missing URL" }]);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.equal(parsed.error.code, "parse_failed");
  });

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
});
