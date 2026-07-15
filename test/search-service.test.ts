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
    const ddgr = new FakeBackend("ddgr", async () => failure("ddgr"));
    const searxng = new FakeBackend("searxng", async () => ok("searxng"));
    const service = new SearchService(
      config(),
      backendMap(ddgr, searxng),
      () => 0,
    );

    const outcome = await service.search(request);
    assert.equal(outcome.status, "ok");
    assert.equal(outcome.provenance?.backend, "searxng");
    assert.equal(outcome.provenance?.attempts?.length, 2);
    assert.equal(outcome.warnings?.[0].source, "ddgr");
  });

  it("does not fall through after legitimate no-results", async () => {
    const ddgr = new FakeBackend("ddgr", async () => noResults("ddgr"));
    const searxng = new FakeBackend("searxng", async () => ok("searxng"));
    const service = new SearchService(
      config(),
      backendMap(ddgr, searxng),
      () => 0,
    );

    const outcome = await service.search(request);
    assert.equal(outcome.status, "no_results");
    assert.equal(ddgr.calls, 1);
    assert.equal(searxng.calls, 0);
  });

  it("returns immediate local rate limiting without backend fallback", async () => {
    let now = 1_000;
    const ddgr = new FakeBackend("ddgr", async () => ok("ddgr"));
    const searxng = new FakeBackend("searxng", async () => ok("searxng"));
    const service = new SearchService(
      config({ searchMinIntervalMs: 10_000 }),
      backendMap(ddgr, searxng),
      () => now,
    );

    await service.search(request);
    now += 2_000;
    const blocked = await service.search({ ...request, query: "different" });
    assert.equal(blocked.error?.code, "rate_limited");
    assert.equal(blocked.error?.retryAfterMs, 8_000);
    assert.equal(ddgr.calls, 1);
    assert.equal(searxng.calls, 0);
  });

  it("serves completed cache hits before the limiter", async () => {
    let now = 1_000;
    const ddgr = new FakeBackend("ddgr", async () => ok("ddgr"));
    const service = new SearchService(
      config({ backends: ["ddgr"] }),
      backendMap(ddgr),
      () => now,
    );

    await service.search(request);
    now += 1;
    const cached = await service.search(request);
    assert.equal(cached.provenance?.cache?.status, "hit");
    assert.equal(ddgr.calls, 1);
  });

  it("coalesces identical in-flight searches before the limiter", async () => {
    let resolve:
      | ((value: OutcomeEnvelope<SearchOutcomeData>) => void)
      | undefined;
    const pending = new Promise<OutcomeEnvelope<SearchOutcomeData>>((done) => {
      resolve = done;
    });
    const ddgr = new FakeBackend("ddgr", async () => pending);
    const service = new SearchService(
      config({ backends: ["ddgr"] }),
      backendMap(ddgr),
      () => 1_000,
    );

    const first = service.search(request);
    const second = service.search(request);
    assert.equal(ddgr.calls, 1);
    resolve?.(ok("ddgr"));
    await first;
    const coalesced = await second;
    assert.equal(coalesced.provenance?.cache?.status, "coalesced");
  });

  it("does not let forceRefresh bypass the limiter", async () => {
    const ddgr = new FakeBackend("ddgr", async () => ok("ddgr"));
    const service = new SearchService(
      config({ backends: ["ddgr"] }),
      backendMap(ddgr),
      () => 1_000,
    );

    await service.search(request);
    const blocked = await service.search({ ...request, forceRefresh: true });
    assert.equal(blocked.error?.code, "rate_limited");
    assert.equal(ddgr.calls, 1);
  });

  it("allows a new dispatch exactly at the interval boundary", async () => {
    let now = 1_000;
    const ddgr = new FakeBackend("ddgr", async () => ok("ddgr"));
    const service = new SearchService(
      config({ backends: ["ddgr"], searchMinIntervalMs: 10_000 }),
      backendMap(ddgr),
      () => now,
    );

    await service.search(request);
    now += 10_000;
    const second = await service.search({ ...request, query: "different" });
    assert.equal(second.status, "ok");
    assert.equal(ddgr.calls, 2);
  });

  it("does not cache operational errors", async () => {
    let now = 1_000;
    const ddgr = new FakeBackend("ddgr", async () => failure("ddgr"));
    const service = new SearchService(
      config({ backends: ["ddgr"], searchMinIntervalMs: 10_000 }),
      backendMap(ddgr),
      () => now,
    );

    assert.equal((await service.search(request)).status, "error");
    now += 10_000;
    assert.equal((await service.search(request)).status, "error");
    assert.equal(ddgr.calls, 2);
  });

  it("lets forceRefresh bypass a completed cache entry after limiter capacity is available", async () => {
    let now = 1_000;
    const ddgr = new FakeBackend("ddgr", async () => ok("ddgr"));
    const service = new SearchService(
      config({ backends: ["ddgr"], searchMinIntervalMs: 10_000 }),
      backendMap(ddgr),
      () => now,
    );

    await service.search(request);
    now += 10_000;
    const refreshed = await service.search({ ...request, forceRefresh: true });
    assert.equal(refreshed.status, "ok");
    assert.equal(refreshed.provenance?.cache?.status, "miss");
    assert.equal(ddgr.calls, 2);
  });
});
