import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Value } from "@sinclair/typebox/value";
import {
  GrepUrlContentParams,
  ReadUrlContentParams,
  SearchWebParams,
  SummarizeUrlContentParams,
  validateGrepUrlContentRequest,
  validateSummarizeUrlContentRequest,
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

  it("accepts only the stable summarizer shape", () => {
    assert.equal(
      Value.Check(SummarizeUrlContentParams, {
        url: "https://example.com",
        objective: "What are the key points?",
        mode: "main",
        selector: "main",
        forceRefresh: true,
      }),
      true,
    );
    assert.equal(
      Value.Check(SummarizeUrlContentParams, {
        url: "https://example.com",
        model: "openai/gpt-5",
      }),
      false,
    );
    assert.equal(
      validateSummarizeUrlContentRequest({
        url: "https://example.com",
        objective: "   ",
      })?.code,
      "invalid_request",
    );
    assert.equal(
      validateSummarizeUrlContentRequest({
        url: "https://example.com",
        objective: "x".repeat(4_001),
      })?.code,
      "invalid_request",
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

  it("rejects blank document selectors and oversized literal queries", () => {
    assert.equal(
      validateReadUrlContentRequest({
        url: "https://example.com",
        selector: "   ",
      })?.code,
      "invalid_request",
    );
    assert.equal(
      validateReadUrlContentRequest({
        url: "https://example.com",
        selector: "[",
      })?.code,
      "invalid_request",
    );
    assert.equal(
      validateGrepUrlContentRequest({
        url: "https://example.com",
        query: "x".repeat(10_001),
      })?.code,
      "invalid_request",
    );
  });

  it("accepts grep offsets and keeps read cursor validation", () => {
    assert.equal(
      Value.Check(GrepUrlContentParams, {
        url: "https://example.com",
        query: "text",
        offset: 4,
      }),
      true,
    );
    assert.equal(
      Value.Check(GrepUrlContentParams, {
        url: "https://example.com",
        query: "text",
        cursor: "cursor",
      }),
      false,
    );
    assert.equal(
      validateReadUrlContentRequest({
        url: "https://example.com",
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
