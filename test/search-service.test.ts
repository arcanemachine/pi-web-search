import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_CONFIG, type PiWebSearchConfig } from "../src/config.js";
import {
  operationalError,
  type OutcomeEnvelope,
  type SearchBackendName,
  type SearchOutcomeData,
  type SearchRequest,
} from "../src/contracts.js";
import type {
  SearchBackend,
  SearchBackendContext,
} from "../src/search/backend.js";
import { SearchService } from "../src/search/service.js";

const request: SearchRequest = { query: "query", limit: 5, safeSearch: "on" };

function config(overrides: Partial<PiWebSearchConfig> = {}): PiWebSearchConfig {
  return {
    ...DEFAULT_CONFIG,
    backends: [...DEFAULT_CONFIG.backends],
    ...overrides,
  };
}

function ok(backend: SearchBackendName): OutcomeEnvelope<SearchOutcomeData> {
  return {
    operation: "search_web",
    status: "ok",
    summary: `${backend} ok`,
    data: {
      query: request.query,
      results: [
        { title: "Result", url: "https://example.com", snippet: "Text" },
      ],
    },
    provenance: { backend, durationMs: 5, cache: { status: "miss" } },
  };
}

function noResults(
  backend: SearchBackendName,
): OutcomeEnvelope<SearchOutcomeData> {
  return {
    operation: "search_web",
    status: "no_results",
    summary: `${backend} empty`,
    data: { query: request.query, results: [] },
    provenance: { backend, durationMs: 5, cache: { status: "miss" } },
  };
}

function failure(
  backend: SearchBackendName,
): OutcomeEnvelope<SearchOutcomeData> {
  const error = operationalError("backend_failed", `${backend} failed`, true);
  return {
    operation: "search_web",
    status: "error",
    summary: error.message,
    data: { query: request.query, results: [] },
    error,
    provenance: { backend, durationMs: 5, cache: { status: "miss" } },
  };
}

class FakeBackend implements SearchBackend {
  calls = 0;

  constructor(
    readonly name: SearchBackendName,
    private readonly respond: (
      request: SearchRequest,
      context: SearchBackendContext,
    ) => Promise<OutcomeEnvelope<SearchOutcomeData>>,
  ) {}

  async search(
    input: SearchRequest,
    context: SearchBackendContext,
  ): Promise<OutcomeEnvelope<SearchOutcomeData>> {
    this.calls += 1;
    return this.respond(input, context);
  }
}

function backendMap(...backends: SearchBackend[]) {
  return new Map(backends.map((backend) => [backend.name, backend]));
}

describe("ordered search service", () => {
  it("falls through only after an explicit operational error", async () => {
    const duckduckgo = new FakeBackend("duckduckgo", async () =>
      failure("duckduckgo"),
    );
    const searxng = new FakeBackend("searxng", async () => ok("searxng"));
    const service = new SearchService(
      config(),
      backendMap(duckduckgo, searxng),
      () => 0,
    );

    const outcome = await service.search(request);
    assert.equal(outcome.status, "ok");
    assert.equal(outcome.provenance?.backend, "searxng");
    assert.equal(outcome.provenance?.attempts?.length, 2);
    assert.equal(outcome.warnings?.[0].source, "duckduckgo");
  });

  it("does not fall through after legitimate no-results", async () => {
    const duckduckgo = new FakeBackend("duckduckgo", async () =>
      noResults("duckduckgo"),
    );
    const searxng = new FakeBackend("searxng", async () => ok("searxng"));
    const service = new SearchService(
      config(),
      backendMap(duckduckgo, searxng),
      () => 0,
    );

    const outcome = await service.search(request);
    assert.equal(outcome.status, "no_results");
    assert.equal(duckduckgo.calls, 1);
    assert.equal(searxng.calls, 0);
  });

  it("allows a configured burst before returning local rate limiting", async () => {
    const duckduckgo = new FakeBackend("duckduckgo", async () =>
      ok("duckduckgo"),
    );
    const service = new SearchService(
      config({
        backends: ["duckduckgo"],
        searchRateLimitPerMinute: 10,
        searchRateLimitBurst: 3,
      }),
      backendMap(duckduckgo),
      () => 1_000,
    );

    assert.equal((await service.search(request)).status, "ok");
    assert.equal(
      (await service.search({ ...request, query: "second" })).status,
      "ok",
    );
    assert.equal(
      (await service.search({ ...request, query: "third" })).status,
      "ok",
    );
    const blocked = await service.search({ ...request, query: "fourth" });
    assert.equal(blocked.error?.code, "rate_limited");
    assert.equal(blocked.error?.retryAfterMs, 6_000);
    assert.equal(duckduckgo.calls, 3);
  });

  it("returns immediate local rate limiting without backend fallback", async () => {
    let now = 1_000;
    const duckduckgo = new FakeBackend("duckduckgo", async () =>
      ok("duckduckgo"),
    );
    const searxng = new FakeBackend("searxng", async () => ok("searxng"));
    const service = new SearchService(
      config({ searchRateLimitPerMinute: 10, searchRateLimitBurst: 1 }),
      backendMap(duckduckgo, searxng),
      () => now,
    );

    await service.search(request);
    now += 2_000;
    const blocked = await service.search({ ...request, query: "different" });
    assert.equal(blocked.error?.code, "rate_limited");
    assert.match(
      blocked.error?.message ?? "",
      /Local process search token bucket exhausted \(10\/minute, burst 1\)/,
    );
    assert.equal(blocked.error?.retryAfterMs, 4_000);
    assert.equal(duckduckgo.calls, 1);
    assert.equal(searxng.calls, 0);
  });

  it("serves completed cache hits before the limiter", async () => {
    let now = 1_000;
    const duckduckgo = new FakeBackend("duckduckgo", async () =>
      ok("duckduckgo"),
    );
    const service = new SearchService(
      config({ backends: ["duckduckgo"] }),
      backendMap(duckduckgo),
      () => now,
    );

    await service.search(request);
    now += 1;
    const cached = await service.search(request);
    assert.equal(cached.provenance?.cache?.status, "hit");
    assert.equal(duckduckgo.calls, 1);
  });

  it("coalesces identical in-flight searches before the limiter", async () => {
    let resolve:
      ((value: OutcomeEnvelope<SearchOutcomeData>) => void) | undefined;
    const pending = new Promise<OutcomeEnvelope<SearchOutcomeData>>((done) => {
      resolve = done;
    });
    const duckduckgo = new FakeBackend("duckduckgo", async () => pending);
    const service = new SearchService(
      config({ backends: ["duckduckgo"] }),
      backendMap(duckduckgo),
      () => 1_000,
    );

    const first = service.search(request);
    const second = service.search(request);
    assert.equal(duckduckgo.calls, 1);
    resolve?.(ok("duckduckgo"));
    await first;
    const coalesced = await second;
    assert.equal(coalesced.provenance?.cache?.status, "coalesced");
  });

  it("does not let forceRefresh bypass the limiter", async () => {
    const duckduckgo = new FakeBackend("duckduckgo", async () =>
      ok("duckduckgo"),
    );
    const service = new SearchService(
      config({
        backends: ["duckduckgo"],
        searchRateLimitPerMinute: 10,
        searchRateLimitBurst: 1,
      }),
      backendMap(duckduckgo),
      () => 1_000,
    );

    await service.search(request);
    const blocked = await service.search({ ...request, forceRefresh: true });
    assert.equal(blocked.error?.code, "rate_limited");
    assert.equal(duckduckgo.calls, 1);
  });

  it("allows a new dispatch when the next token has fully refilled", async () => {
    let now = 1_000;
    const duckduckgo = new FakeBackend("duckduckgo", async () =>
      ok("duckduckgo"),
    );
    const service = new SearchService(
      config({
        backends: ["duckduckgo"],
        searchRateLimitPerMinute: 10,
        searchRateLimitBurst: 1,
      }),
      backendMap(duckduckgo),
      () => now,
    );

    await service.search(request);
    now += 6_000;
    const second = await service.search({ ...request, query: "different" });
    assert.equal(second.status, "ok");
    assert.equal(duckduckgo.calls, 2);
  });

  it("does not cache operational errors", async () => {
    let now = 1_000;
    const duckduckgo = new FakeBackend("duckduckgo", async () =>
      failure("duckduckgo"),
    );
    const service = new SearchService(
      config({
        backends: ["duckduckgo"],
        searchRateLimitPerMinute: 10,
        searchRateLimitBurst: 1,
      }),
      backendMap(duckduckgo),
      () => now,
    );

    assert.equal((await service.search(request)).status, "error");
    now += 6_000;
    assert.equal((await service.search(request)).status, "error");
    assert.equal(duckduckgo.calls, 2);
  });

  it("lets forceRefresh bypass a completed cache entry after limiter capacity is available", async () => {
    let now = 1_000;
    const duckduckgo = new FakeBackend("duckduckgo", async () =>
      ok("duckduckgo"),
    );
    const service = new SearchService(
      config({
        backends: ["duckduckgo"],
        searchRateLimitPerMinute: 10,
        searchRateLimitBurst: 1,
      }),
      backendMap(duckduckgo),
      () => now,
    );

    await service.search(request);
    now += 6_000;
    const refreshed = await service.search({ ...request, forceRefresh: true });
    assert.equal(refreshed.status, "ok");
    assert.equal(refreshed.provenance?.cache?.status, "miss");
    assert.equal(duckduckgo.calls, 2);
  });
});
