import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_CONFIG, type PiWebSearchConfig } from "../src/config.js";
import { CursorService, optionsHash } from "../src/documents/cursor.js";
import { DocumentService } from "../src/documents/service.js";

function config(overrides: Partial<PiWebSearchConfig> = {}): PiWebSearchConfig {
  return {
    ...DEFAULT_CONFIG,
    backends: [...DEFAULT_CONFIG.backends],
    ...overrides,
  };
}

describe("shared document service", () => {
  it("coalesces in-flight fetches, reports cache age, and bypasses completed cache on refresh", async () => {
    let now = 1_000;
    let requests = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchMock = (async () => {
      requests += 1;
      if (requests === 1) await gate;
      return new Response("# Heading\n\nbody", {
        headers: { "content-type": "text/markdown" },
      });
    }) as typeof fetch;
    const service = new DocumentService(config(), {
      fetch: fetchMock,
      now: () => now,
    });
    const options = {
      url: "https://example.com/docs",
      mode: "main" as const,
    };
    const first = service.getSnapshot(options, false);
    const second = service.getSnapshot(options, false);
    release?.();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.equal(firstResult.cache.status, "miss");
    assert.equal(secondResult.cache.status, "coalesced");
    assert.equal(requests, 1);
    assert.equal(
      firstResult.snapshot?.contentHash,
      secondResult.snapshot?.contentHash,
    );

    now += 250;
    const hit = await service.getSnapshot(options, false);
    assert.equal(hit.cache.status, "hit");
    assert.equal(hit.cache.ageMs, 250);
    assert.equal(hit.snapshot?.fetchedAt, firstResult.snapshot?.fetchedAt);

    const refreshed = await service.getSnapshot(options, true);
    assert.equal(refreshed.cache.status, "bypassed");
    assert.equal(requests, 2);
  });

  it("does not cache operational fetch failures", async () => {
    let requests = 0;
    const service = new DocumentService(config(), {
      fetch: (async () => {
        requests += 1;
        return requests === 1
          ? new Response("failed", { status: 503 })
          : new Response("recovered", {
              headers: { "content-type": "text/plain" },
            });
      }) as typeof fetch,
      now: () => 1_000,
    });
    const options = {
      url: "https://example.com/retry",
      mode: "main" as const,
    };
    assert.equal(
      (await service.getSnapshot(options, false)).error?.code,
      "fetch_failed",
    );
    assert.equal(
      (await service.getSnapshot(options, false)).snapshot?.content,
      "recovered",
    );
    assert.equal(requests, 2);
  });

  it("lets a coalesced caller cancel promptly without abandoning shared work", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = new DocumentService(config(), {
      fetch: (async () => {
        await gate;
        return new Response("content", {
          headers: { "content-type": "text/plain" },
        });
      }) as typeof fetch,
      now: () => 1_000,
    });
    const options = {
      url: "https://example.com/coalesced",
      mode: "main" as const,
    };
    const primary = service.getSnapshot(options, false);
    const controller = new AbortController();
    const coalesced = service.getSnapshot(options, false, controller.signal);
    controller.abort(new Error("cancelled coalesced caller"));
    await assert.rejects(coalesced, /cancelled coalesced caller/);
    release?.();
    assert.equal((await primary).snapshot?.content, "content");
  });

  it("caps normalized snapshots on UTF-8 boundaries and indexes final lines/headings", async () => {
    const service = new DocumentService(
      config({
        documentMaxNormalizedBytes: 80,
        documentCacheMaxBytes: 1_000,
      }),
      {
        fetch: (async () =>
          new Response(`# Heading\n\n${"界".repeat(100)}`, {
            headers: { "content-type": "text/markdown" },
          })) as typeof fetch,
        now: () => 1_000,
      },
    );
    const result = await service.getSnapshot(
      { url: "https://example.com/large", mode: "main" },
      false,
    );
    const snapshot = result.snapshot;
    assert.ok(snapshot);
    assert.ok(snapshot.normalizedBytes <= 80);
    assert.equal(snapshot.truncated, true);
    assert.equal(
      snapshot.warnings.some(
        (warning) => warning.code === "normalized_content_truncated",
      ),
      true,
    );
    assert.equal(snapshot.lines[0].heading, "Heading");
    assert.equal(snapshot.lines.at(-1)?.heading, "Heading");
    assert.equal(snapshot.characterCount, [...snapshot.content].length);
  });

  it("caps adversarial line indexes and reports incomplete snapshots", async () => {
    const service = new DocumentService(
      config({
        documentMaxNormalizedBytes: 500_000,
        documentCacheMaxBytes: 1_000_000,
      }),
      {
        fetch: (async () =>
          new Response("x\n".repeat(50_100), {
            headers: { "content-type": "text/plain" },
          })) as typeof fetch,
        now: () => 1_000,
      },
    );
    const result = await service.getSnapshot(
      { url: "https://example.com/many-lines", mode: "main" },
      false,
    );
    assert.equal(result.snapshot?.lines.length, 50_000);
    assert.equal(result.snapshot?.truncated, true);
    assert.equal(
      result.snapshot?.warnings.some(
        (warning) => warning.code === "line_index_truncated",
      ),
      true,
    );
  });

  it("uses authenticated opaque operation- and option-bound read cursors", () => {
    const cursors = new CursorService(new Uint8Array(32).fill(7));
    const hash = optionsHash({ url: "https://example.com", mode: "main" });
    const token = cursors.encode({
      snapshotId: "snapshot",
      operation: "read",
      position: 12,
      optionsHash: hash,
    });
    assert.doesNotMatch(token, /example|snapshot/);
    assert.equal(cursors.decode(token, "read", hash).value?.position, 12);
    assert.equal(
      cursors.decode(token, "read", optionsHash({ different: true })).error
        ?.code,
      "invalid_request",
    );
    assert.equal(
      cursors.decode(`${token.slice(0, -1)}x`, "read", hash).error?.code,
      "invalid_request",
    );
  });
});
