import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SearchRequest } from "../src/contracts.js";
import { SearxngBackend } from "../src/search/searxng.js";

const request: SearchRequest = {
  query: "pi extension",
  limit: 5,
  safeSearch: "on",
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

describe("SearXNG backend", () => {
  it("returns results with engine diagnostics as warnings", async () => {
    let requested: URL | undefined;
    const backend = new SearxngBackend("https://search.example/base", {
      fetch: (async (input) => {
        requested = new URL(input.toString());
        return jsonResponse({
          results: [
            { title: "Docs", url: "https://example.com", content: "Reference" },
          ],
          unresponsive_engines: [["engine", "timeout"]],
        });
      }) as typeof fetch,
      now: () => 100,
    });
    const outcome = await backend.search(request, { timeoutMs: 1_000 });
    assert.equal(outcome.status, "ok");
    assert.equal(outcome.warnings?.[0].code, "engine_unresponsive");
    assert.equal(requested?.pathname, "/base/search");
    assert.equal(requested?.searchParams.get("q"), request.query);
  });

  it("distinguishes legitimate emptiness from supported failure evidence", async () => {
    const clean = new SearxngBackend("https://search.example", {
      fetch: (async () => jsonResponse({ results: [] })) as typeof fetch,
      now: Date.now,
    });
    assert.equal(
      (await clean.search(request, { timeoutMs: 1_000 })).status,
      "no_results",
    );

    const failed = new SearxngBackend("https://search.example", {
      fetch: (async () =>
        jsonResponse({
          results: [],
          unresponsive_engines: [["duckduckgo", "429 rate limit"]],
        })) as typeof fetch,
      now: Date.now,
    });
    const failure = await failed.search(request, { timeoutMs: 1_000 });
    assert.equal(failure.status, "error");
    assert.equal(failure.error?.code, "rate_limited");
  });

  it("returns structured HTTP rate-limit evidence", async () => {
    const backend = new SearxngBackend("https://search.example", {
      fetch: (async () =>
        new Response("", {
          status: 429,
          headers: { "retry-after": "3" },
        })) as typeof fetch,
      now: () => 0,
    });
    const outcome = await backend.search(request, { timeoutMs: 1_000 });
    assert.equal(outcome.error?.code, "rate_limited");
    assert.equal(outcome.error?.retryAfterMs, 3_000);
  });

  it("rejects non-JSON and malformed native responses", async () => {
    const html = new SearxngBackend("https://search.example", {
      fetch: (async () =>
        new Response("<html></html>", {
          headers: { "content-type": "text/html" },
        })) as typeof fetch,
      now: Date.now,
    });
    assert.equal(
      (await html.search(request, { timeoutMs: 1_000 })).error?.code,
      "parse_failed",
    );

    const malformed = new SearxngBackend("https://search.example", {
      fetch: (async () => jsonResponse({ results: "wrong" })) as typeof fetch,
      now: Date.now,
    });
    assert.equal(
      (await malformed.search(request, { timeoutMs: 1_000 })).error?.code,
      "parse_failed",
    );
  });

  it("enforces its timeout across fetch work", async () => {
    const backend = new SearxngBackend("https://search.example", {
      fetch: (async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          const abort = () => reject(signal?.reason ?? new Error("aborted"));
          if (signal?.aborted) abort();
          else signal?.addEventListener("abort", abort, { once: true });
        })) as typeof fetch,
      now: Date.now,
    });
    const outcome = await backend.search(request, { timeoutMs: 10 });
    assert.equal(outcome.error?.code, "timeout");
  });

  it("forwards cancellation through fetch", async () => {
    const backend = new SearxngBackend("https://search.example", {
      fetch: (async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          const abort = () => reject(signal?.reason ?? new Error("aborted"));
          if (signal?.aborted) abort();
          else signal?.addEventListener("abort", abort, { once: true });
        })) as typeof fetch,
      now: Date.now,
    });
    const controller = new AbortController();
    const execution = backend.search(request, {
      timeoutMs: 1_000,
      signal: controller.signal,
    });
    controller.abort(new Error("cancelled by test"));
    await assert.rejects(execution, /cancelled by test/);
  });
});
