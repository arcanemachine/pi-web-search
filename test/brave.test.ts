import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SearchRequest } from "../src/contracts.js";
import { BraveBackend } from "../src/search/brave.js";

const request: SearchRequest = {
  query: "pi extension",
  limit: 5,
  region: "us-en",
  safeSearch: "on",
  timeRange: "month",
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

function backend(
  fetch: typeof globalThis.fetch,
  key = "fake-brave-token",
  now = () => 100,
): BraveBackend {
  return new BraveBackend(key, { fetch, now });
}

describe("Brave Search backend", () => {
  it("maps web results and sends the documented request", async () => {
    let requested: URL | undefined;
    let headers: Headers | undefined;
    const brave = backend((async (input, init) => {
      requested = new URL(input.toString());
      headers = new Headers(init?.headers);
      return jsonResponse({
        web: {
          results: [
            {
              title: "Docs",
              url: "https://example.com/docs",
              description: "Reference",
            },
          ],
        },
      });
    }) as typeof fetch);

    const outcome = await brave.search(request, { timeoutMs: 1_000 });
    assert.equal(outcome.status, "ok");
    assert.deepEqual(outcome.data?.results, [
      {
        title: "Docs",
        url: "https://example.com/docs",
        snippet: "Reference",
        engine: "brave",
      },
    ]);
    assert.equal(
      requested?.toString(),
      "https://api.search.brave.com/res/v1/web/search?q=pi+extension&count=5&safesearch=moderate&freshness=pm&country=US&search_lang=en&result_filter=web&text_decorations=false&spellcheck=false",
    );
    assert.equal(headers?.get("accept"), "application/json");
    assert.equal(headers?.get("x-subscription-token"), "fake-brave-token");
  });

  it("does not expose the API key in public outcome fields", async () => {
    const marker = "FAKE_BRAVE_SECRET_123";
    let outboundKey: string | null = null;
    const brave = backend(
      (async (_input, init) => {
        outboundKey = new Headers(init?.headers).get("x-subscription-token");
        return jsonResponse({
          web: {
            results: [
              {
                title: "Docs",
                url: "https://example.com",
                description: "Reference",
              },
            ],
          },
        });
      }) as typeof fetch,
      marker,
    );
    const outcome = await brave.search(request, { timeoutMs: 1_000 });
    assert.equal(outboundKey, marker);
    assert.doesNotMatch(JSON.stringify(outcome), new RegExp(marker));
  });

  it("reports a missing or blank key without making a request", async () => {
    let calls = 0;
    const fetch: typeof globalThis.fetch = (async () => {
      calls += 1;
      return jsonResponse({ web: { results: [] } });
    }) as typeof fetch;
    for (const key of [undefined, "", "   "]) {
      const outcome = await new BraveBackend(key, {
        fetch,
        now: () => 100,
      }).search(request, { timeoutMs: 1_000 });
      assert.equal(outcome.error?.code, "backend_unavailable");
      assert.equal(outcome.error?.retryable, false);
      assert.match(outcome.summary, /PI_WEB_SEARCH_BRAVE_API_KEY/);
    }
    assert.equal(calls, 0);
  });

  it("rejects backend-local query limits without fetching", async () => {
    let calls = 0;
    const fetch: typeof globalThis.fetch = (async () => {
      calls += 1;
      return jsonResponse({ web: { results: [] } });
    }) as typeof fetch;
    const brave = backend(fetch);
    const tooManyChars = await brave.search(
      { ...request, query: "x".repeat(401) },
      { timeoutMs: 1_000 },
    );
    const tooManyWords = await brave.search(
      { ...request, query: Array.from({ length: 51 }, () => "word").join(" ") },
      { timeoutMs: 1_000 },
    );
    assert.equal(tooManyChars.error?.code, "invalid_request");
    assert.equal(tooManyWords.error?.code, "invalid_request");
    assert.equal(calls, 0);
    assert.equal(
      (
        await brave.search(
          { ...request, query: "x".repeat(400) },
          { timeoutMs: 1_000 },
        )
      ).status,
      "no_results",
    );
    assert.equal(calls, 1);
  });

  for (const [status, code, retryable, message] of [
    [
      401,
      "backend_unavailable",
      false,
      "Brave Search API rejected the subscription token",
    ],
    [403, "blocked", false, "Brave Search API denied the request"],
    [404, "backend_failed", false, "Brave Search endpoint returned HTTP 404"],
    [
      422,
      "invalid_request",
      false,
      "Brave Search API rejected the request parameters",
    ],
    [500, "backend_failed", true, "Brave Search API returned HTTP 500"],
    [418, "backend_failed", false, "Brave Search API returned HTTP 418"],
  ] as const) {
    it(`maps HTTP ${status} safely`, async () => {
      const outcome = await backend(
        (async () => new Response("not returned", { status })) as typeof fetch,
      ).search(request, { timeoutMs: 1_000 });
      assert.equal(outcome.error?.code, code);
      assert.equal(outcome.error?.retryable, retryable);
      assert.equal(outcome.error?.message, message);
    });
  }

  it("parses Brave rate-limit reset before Retry-After", async () => {
    const outcome = await backend(
      (async () =>
        new Response("", {
          status: 429,
          headers: { "x-ratelimit-reset": "2, 999", "retry-after": "9" },
        })) as typeof fetch,
    ).search(request, { timeoutMs: 1_000 });
    assert.equal(outcome.error?.code, "rate_limited");
    assert.equal(outcome.error?.retryAfterMs, 2_000);
  });

  it("uses Retry-After seconds and date fallbacks", async () => {
    const seconds = await backend(
      (async () =>
        new Response("", {
          status: 429,
          headers: { "retry-after": "3" },
        })) as typeof fetch,
    ).search(request, { timeoutMs: 1_000 });
    assert.equal(seconds.error?.retryAfterMs, 3_000);

    const date = new Date(10_000).toUTCString();
    const dateOutcome = await backend(
      (async () =>
        new Response("", {
          status: 429,
          headers: { "retry-after": date },
        })) as typeof fetch,
      "fake",
      () => 0,
    ).search(request, { timeoutMs: 1_000 });
    assert.equal(dateOutcome.error?.retryAfterMs, 10_000);

    const invalid = await backend(
      (async () =>
        new Response("", {
          status: 429,
          headers: { "x-ratelimit-reset": "bad", "retry-after": "also-bad" },
        })) as typeof fetch,
    ).search(request, { timeoutMs: 1_000 });
    assert.equal(invalid.error?.retryAfterMs, undefined);
  });

  for (const [code, message] of [
    ["ECONNREFUSED", "Brave Search endpoint refused the connection"],
    ["ENOTFOUND", "Brave Search hostname could not be resolved"],
    ["EAI_AGAIN", "Brave Search hostname could not be resolved"],
    ["EHOSTUNREACH", "Brave Search endpoint was unreachable"],
    ["ENETUNREACH", "Brave Search endpoint was unreachable"],
    ["ECONNRESET", "Brave Search connection was reset"],
  ] as const) {
    it(`maps network cause ${code}`, async () => {
      const outcome = await backend((async () => {
        throw new Error("secret network detail", { cause: { code } });
      }) as typeof fetch).search(request, { timeoutMs: 1_000 });
      assert.equal(outcome.error?.code, "fetch_failed");
      assert.equal(outcome.error?.message, message);
    });
  }

  it("does not expose unknown network errors", async () => {
    const marker = "SECRET_BRAVE_NETWORK_DETAIL";
    const outcome = await backend((async () => {
      throw new Error(marker, { cause: new Error(marker) });
    }) as typeof fetch).search(request, { timeoutMs: 1_000 });
    assert.equal(outcome.error?.message, "Brave Search request failed");
    assert.doesNotMatch(JSON.stringify(outcome), new RegExp(marker));
  });

  it("rejects non-JSON, oversized, malformed, and unsafe payloads", async () => {
    const nonJson = await backend(
      (async () =>
        new Response("html", {
          headers: { "content-type": "text/html" },
        })) as typeof fetch,
    ).search(request, { timeoutMs: 1_000 });
    assert.equal(nonJson.error?.code, "parse_failed");

    const oversized = await backend(
      (async () =>
        new Response("{}", {
          headers: {
            "content-type": "application/json",
            "content-length": String(2 * 1024 * 1024 + 1),
          },
        })) as typeof fetch,
    ).search(request, { timeoutMs: 1_000 });
    assert.equal(oversized.error?.code, "parse_failed");

    const malformed = await backend((async () =>
      jsonResponse({ web: { results: "wrong" } })) as typeof fetch).search(
      request,
      { timeoutMs: 1_000 },
    );
    assert.equal(malformed.error?.code, "parse_failed");

    const unsafe = await backend((async () =>
      jsonResponse({
        web: { results: [{ title: "Bad", url: "javascript:alert(1)" }] },
      })) as typeof fetch).search(request, { timeoutMs: 1_000 });
    assert.equal(unsafe.error?.code, "parse_failed");
  });

  it("accepts empty or missing web results as legitimate no-results", async () => {
    for (const body of [{}, { web: null }, { web: { results: [] } }]) {
      const outcome = await backend((async () =>
        jsonResponse(body)) as typeof fetch).search(request, {
        timeoutMs: 1_000,
      });
      assert.equal(outcome.status, "no_results");
    }
  });

  it("maps request options and defensively clamps count", async () => {
    const requested: URL[] = [];
    const brave = backend((async (input) => {
      requested.push(new URL(input.toString()));
      return jsonResponse({ web: { results: [] } });
    }) as typeof fetch);
    await brave.search(
      {
        ...request,
        limit: 99,
        safeSearch: "off",
        region: "DE-DE",
        timeRange: "year",
      },
      { timeoutMs: 1_000 },
    );
    await brave.search(
      { ...request, limit: 0, region: "not-a-region", timeRange: undefined },
      { timeoutMs: 1_000 },
    );
    assert.equal(requested[0].searchParams.get("count"), "20");
    assert.equal(requested[0].searchParams.get("safesearch"), "off");
    assert.equal(requested[0].searchParams.get("freshness"), "py");
    assert.equal(requested[0].searchParams.get("country"), "DE");
    assert.equal(requested[0].searchParams.get("search_lang"), "de");
    assert.equal(requested[0].searchParams.get("result_filter"), "web");
    assert.equal(requested[0].searchParams.get("text_decorations"), "false");
    assert.equal(requested[0].searchParams.get("spellcheck"), "false");
    assert.equal(requested[1].searchParams.get("count"), "1");
    assert.equal(requested[1].searchParams.has("country"), false);
  });

  it("times out and propagates parent cancellation", async () => {
    const timeout = await backend(
      (async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          const abort = () =>
            reject(init?.signal?.reason ?? new Error("aborted"));
          if (init?.signal?.aborted) abort();
          else init?.signal?.addEventListener("abort", abort, { once: true });
        })) as typeof fetch,
    ).search(request, { timeoutMs: 10 });
    assert.equal(timeout.error?.code, "timeout");

    const controller = new AbortController();
    const execution = backend(
      (async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          const abort = () =>
            reject(init?.signal?.reason ?? new Error("aborted"));
          if (init?.signal?.aborted) abort();
          else init?.signal?.addEventListener("abort", abort, { once: true });
        })) as typeof fetch,
    ).search(request, { timeoutMs: 1_000, signal: controller.signal });
    controller.abort(new Error("cancelled by test"));
    await assert.rejects(execution, /cancelled by test/);
  });
});
