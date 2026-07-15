import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Value } from "@sinclair/typebox/value";
import {
  GrepUrlContentParams,
  ReadUrlContentParams,
  SearchWebParams,
  validateGrepUrlContentRequest,
  validateReadUrlContentRequest,
  validateSearchWebRequest,
} from "../src/tools/schemas.js";

describe("public request schemas", () => {
  it("accepts the approved search shape", () => {
    assert.equal(
      Value.Check(SearchWebParams, {
        query: "pi extension API",
        limit: 5,
        safeSearch: "on",
        timeRange: "month",
      }),
      true,
    );
  });

  it("rejects invalid numeric bounds and extra fields", () => {
    assert.equal(Value.Check(SearchWebParams, { query: "x", limit: 0 }), false);
    assert.equal(
      Value.Check(GrepUrlContentParams, {
        url: "https://example.com",
        query: "x",
        beforeLines: -1,
      }),
      false,
    );
    assert.equal(
      Value.Check(ReadUrlContentParams, {
        url: "https://example.com",
        extra: true,
      }),
      false,
    );
  });

  it("validates search query bounds after trimming", () => {
    assert.equal(
      validateSearchWebRequest({ query: "   " })?.code,
      "invalid_request",
    );
    assert.equal(
      validateSearchWebRequest({ query: `  ${"x".repeat(500)}  ` }),
      undefined,
    );
    assert.equal(
      validateSearchWebRequest({ query: "x".repeat(501) })?.code,
      "invalid_request",
    );
    assert.equal(
      validateSearchWebRequest({ query: "x", region: "   " })?.code,
      "invalid_request",
    );
  });

  it("rejects unsupported cursor combinations", () => {
    assert.equal(
      validateReadUrlContentRequest({
        url: "https://example.com",
        cursor: "cursor",
        forceRefresh: true,
      })?.code,
      "invalid_request",
    );
    assert.equal(
      validateGrepUrlContentRequest({
        url: "https://example.com",
        query: "text",
        cursor: "cursor",
        forceRefresh: true,
      })?.code,
      "invalid_request",
    );
  });

  it("rejects unsupported URLs and embedded credentials", () => {
    assert.equal(
      validateReadUrlContentRequest({ url: "file:///tmp/a" })?.code,
      "invalid_request",
    );
    assert.equal(
      validateReadUrlContentRequest({ url: "https://user:pass@example.com" })
        ?.code,
      "invalid_request",
    );
  });
});
