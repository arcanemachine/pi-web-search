import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SearchRequest } from "../src/contracts.js";
import { DuckDuckGoBackend } from "../src/search/duckduckgo.js";

const request: SearchRequest = {
  query: '--exact "quoted"; echo nope — 世界\nnext',
  limit: 2,
  safeSearch: "on",
};

function htmlResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    ...init,
    headers: { "content-type": "text/html; charset=UTF-8", ...init.headers },
  });
}

const html = `<html><body><form class="header__form" action="/html/" method="post"><input name="q"></form><div id="links"><div class="links_main"><h2 class="result__title"><a href="https://example.com/docs">Docs</a></h2><div class="result__snippet">Reference</div></div></div></body></html>`;

function backend(
  fetch: typeof globalThis.fetch,
  now = () => 100,
): DuckDuckGoBackend {
  return new DuckDuckGoBackend({ fetch, now });
}

describe("DuckDuckGo backend", () => {
  it("sends the native POST request and maps all form options", async () => {
    let endpoint: string | undefined;
    let method: string | undefined;
    let headers: Headers | undefined;
    let body: URLSearchParams | undefined;
    const outcome = await backend((async (input, init) => {
      endpoint = input.toString();
      method = init?.method;
      headers = new Headers(init?.headers);
      body = init?.body as URLSearchParams;
      return htmlResponse(html);
    }) as typeof fetch).search(
      {
        ...request,
        region: "  DE-de ",
        safeSearch: "off",
        timeRange: "month",
      },
      { timeoutMs: 1_000 },
    );

    assert.equal(outcome.status, "ok");
    assert.equal(endpoint, "https://html.duckduckgo.com/html");
    assert.equal(method, "POST");
    assert.equal(
      headers?.get("content-type"),
      "application/x-www-form-urlencoded",
    );
    assert.equal(headers?.get("dnt"), "1");
    assert.match(headers?.get("user-agent") ?? "", /^Mozilla\//);
    assert.equal(headers?.get("accept"), "text/html,application/xhtml+xml");
    assert.equal(body?.get("q"), request.query);
    assert.equal(body?.get("b"), "");
    assert.equal(body?.get("df"), "m");
    assert.equal(body?.get("kf"), "-1");
    assert.equal(body?.get("kh"), "1");
    assert.equal(body?.get("kl"), "DE-de");
    assert.equal(body?.get("kp"), "-2");
    assert.equal(body?.get("k1"), "-1");
    assert.equal(outcome.provenance?.backend, "duckduckgo");
    assert.equal(outcome.data?.results.length, 1);
  });

  it("defaults region and safe search and maps every freshness value", async () => {
    const bodies: URLSearchParams[] = [];
    const search = backend((async (_input, init) => {
      bodies.push(init?.body as URLSearchParams);
      return htmlResponse("<html><body><div id=links></div></body></html>");
    }) as typeof fetch);
    await search.search(
      { ...request, region: undefined, safeSearch: undefined },
      { timeoutMs: 1_000 },
    );
    for (const [timeRange, expected] of [
      ["day", "d"],
      ["week", "w"],
      ["month", "m"],
      ["year", "y"],
    ] as const) {
      await search.search({ ...request, timeRange }, { timeoutMs: 1_000 });
      assert.equal(bodies.at(-1)?.get("df"), expected);
    }
    assert.equal(bodies[0].get("kl"), "us-en");
    assert.equal(bodies[0].get("kp"), "1");
    assert.equal(bodies[0].get("df"), "");
  });

  for (const [status, code, retryable] of [
    [202, "blocked", true],
    [403, "blocked", true],
    [429, "rate_limited", true],
    [500, "backend_failed", true],
    [418, "backend_failed", false],
  ] as const) {
    it(`classifies HTTP ${status}`, async () => {
      const outcome = await backend(
        (async () =>
          new Response("ignored", {
            status,
            headers: status === 429 ? { "retry-after": "3" } : undefined,
          })) as typeof fetch,
      ).search(request, { timeoutMs: 1_000 });
      assert.equal(outcome.error?.code, code);
      assert.equal(outcome.error?.retryable, retryable);
      if (status === 429) assert.equal(outcome.error?.retryAfterMs, 3_000);
    });
  }

  it("uses an HTTP-date Retry-After value", async () => {
    const date = new Date(10_000).toUTCString();
    const outcome = await backend(
      (async () =>
        new Response("", {
          status: 429,
          headers: { "retry-after": date },
        })) as typeof fetch,
      () => 0,
    ).search(request, { timeoutMs: 1_000 });
    assert.equal(outcome.error?.retryAfterMs, 10_000);
  });

  it("maps network failures without exposing thrown details", async () => {
    const known = await backend((async () => {
      throw new Error("secret", { cause: { code: "ECONNREFUSED" } });
    }) as typeof fetch).search(request, { timeoutMs: 1_000 });
    assert.equal(
      known.error?.message,
      "DuckDuckGo endpoint refused the connection",
    );

    const marker = "SECRET_DDG_NETWORK_DETAIL";
    const unknown = await backend((async () => {
      throw new Error(marker, { cause: new Error(marker) });
    }) as typeof fetch).search(request, { timeoutMs: 1_000 });
    assert.equal(unknown.error?.message, "DuckDuckGo request failed");
    assert.doesNotMatch(JSON.stringify(unknown), new RegExp(marker));
  });

  it("handles no-results, invalid HTML, blocks, content types, and sizes", async () => {
    const empty = await backend((async () =>
      htmlResponse(
        "<html><body><div id=links></div></body></html>",
      )) as typeof fetch).search(request, { timeoutMs: 1_000 });
    assert.equal(empty.status, "no_results");

    const invalid = await backend((async () =>
      htmlResponse(
        "<html><body><h1>unrelated</h1></body></html>",
      )) as typeof fetch).search(request, { timeoutMs: 1_000 });
    assert.equal(invalid.error?.code, "parse_failed");

    const blocked = await backend((async () =>
      htmlResponse(
        '<html><body><div id="anomaly-modal">verify you are human</div></body></html>',
      )) as typeof fetch).search(request, { timeoutMs: 1_000 });
    assert.equal(blocked.error?.code, "blocked");
    assert.equal(blocked.error?.retryable, true);

    const nonHtml = await backend(
      (async () =>
        new Response("{}", {
          headers: { "content-type": "application/json" },
        })) as typeof fetch,
    ).search(request, { timeoutMs: 1_000 });
    assert.equal(nonHtml.error?.code, "parse_failed");

    const declared = await backend((async () =>
      htmlResponse("ok", {
        headers: { "content-length": String(2 * 1024 * 1024 + 1) },
      })) as typeof fetch).search(request, { timeoutMs: 1_000 });
    assert.equal(declared.error?.code, "parse_failed");

    const actual = await backend((async () =>
      htmlResponse("x".repeat(2 * 1024 * 1024 + 1))) as typeof fetch).search(
      request,
      { timeoutMs: 1_000 },
    );
    assert.equal(actual.error?.code, "parse_failed");
  });

  it("times out while fetching and while reading the body", async () => {
    const fetchTimeout = await backend(
      (async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          const abort = () =>
            reject(init?.signal?.reason ?? new Error("aborted"));
          init?.signal?.addEventListener("abort", abort, { once: true });
        })) as typeof fetch,
    ).search(request, { timeoutMs: 10 });
    assert.equal(fetchTimeout.error?.code, "timeout");

    let signal: AbortSignal | undefined;
    const readTimeout = await backend((async (_input, init) => {
      signal = init?.signal ?? undefined;
      const response = {
        status: 200,
        ok: true,
        headers: new Headers({ "content-type": "text/html" }),
        text: () =>
          new Promise<string>((_resolve, reject) => {
            const abort = () => reject(signal?.reason ?? new Error("aborted"));
            signal?.addEventListener("abort", abort, { once: true });
          }),
      } as Response;
      return response;
    }) as typeof fetch).search(request, { timeoutMs: 10 });
    assert.equal(readTimeout.error?.code, "timeout");
  });

  it("propagates parent cancellation", async () => {
    const controller = new AbortController();
    const execution = backend(
      (async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          const abort = () =>
            reject(init?.signal?.reason ?? new Error("aborted"));
          init?.signal?.addEventListener("abort", abort, { once: true });
        })) as typeof fetch,
    ).search(request, {
      timeoutMs: 1_000,
      signal: controller.signal,
    });
    controller.abort(new Error("cancelled by test"));
    await assert.rejects(execution, /cancelled by test/);
  });
});
