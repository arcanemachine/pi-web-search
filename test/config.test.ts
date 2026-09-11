import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ConfigurationError,
  DEFAULT_CONFIG,
  resolveConfig,
} from "../src/config.js";

describe("pi-web-search configuration", () => {
  it("uses only DuckDuckGo by default", () => {
    assert.deepEqual(DEFAULT_CONFIG.backends, ["duckduckgo"]);
    assert.deepEqual(resolveConfig({}, {}, {}).backends, ["duckduckgo"]);
  });

  it("automatically adds Brave when a key is available", () => {
    assert.deepEqual(
      resolveConfig({}, {}, { BRAVE_SEARCH_API_KEY: "environment-token" })
        .backends,
      ["duckduckgo", "brave"],
    );
    assert.deepEqual(
      resolveConfig(
        { "pi-web-search": { braveApiKey: "settings-token" } },
        {},
        {},
      ).backends,
      ["duckduckgo", "brave"],
    );
  });

  it("keeps an explicit backend list authoritative", () => {
    assert.deepEqual(
      resolveConfig(
        { "pi-web-search": { braveApiKey: "settings-token" } },
        { "pi-web-search": { backends: ["duckduckgo"] } },
        {},
      ).backends,
      ["duckduckgo"],
    );
  });

  it("defaults summarization on and merges its settings", () => {
    const defaults = resolveConfig({}, {}, {});
    assert.equal(defaults.summarizationEnabled, true);
    assert.equal(defaults.summarizerModel, undefined);
    assert.equal(defaults.summarizerThinkingLevel, undefined);

    const config = resolveConfig(
      {
        "pi-web-search": {
          summarizationEnabled: false,
          summarizerModel: "openai/gpt-5",
          summarizerThinkingLevel: "low",
        },
      },
      { "pi-web-search": { summarizationEnabled: true } },
      {},
    );
    assert.equal(config.summarizationEnabled, true);
    assert.equal(config.summarizerModel, "openai/gpt-5");
    assert.equal(config.summarizerThinkingLevel, "low");
  });

  it("accepts every summarizer thinking level", () => {
    for (const level of [
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]) {
      assert.equal(
        resolveConfig(
          {},
          { "pi-web-search": { summarizerThinkingLevel: level } },
          {},
        ).summarizerThinkingLevel,
        level,
      );
    }
  });

  it("merges global and project package settings by property", () => {
    const config = resolveConfig(
      {
        "pi-web-search": {
          searxngUrl: "https://global.example",
          searchMaxResults: 4,
        },
      },
      { "pi-web-search": { searchMaxResults: 7 } },
      {},
    );

    assert.equal(config.searxngUrl, "https://global.example");
    assert.equal(config.searchMaxResults, 7);
    assert.equal(
      config.searchMaxLimitResults,
      DEFAULT_CONFIG.searchMaxLimitResults,
    );
  });

  it("uses compatibility environment values only below settings", () => {
    const fromEnvironment = resolveConfig(
      {},
      {},
      {
        SEARXNG_URL: "https://environment.example",
        CACHE_TTL_MINUTES: "7",
      },
    );
    assert.equal(fromEnvironment.searxngUrl, "https://environment.example");
    assert.equal(fromEnvironment.documentCacheTtlSeconds, 420);

    const configured = resolveConfig(
      { "pi-web-search": { searxngUrl: "https://configured.example" } },
      { "pi-web-search": { documentCacheTtlSeconds: 90 } },
      {
        SEARXNG_URL: "https://environment.example",
        CACHE_TTL_MINUTES: "7",
      },
    );
    assert.equal(configured.searxngUrl, "https://configured.example");
    assert.equal(configured.documentCacheTtlSeconds, 90);

    const ignoresInvalidLowerPriorityFallback = resolveConfig(
      {
        "pi-web-search": {
          searxngUrl: "https://configured.example",
          documentCacheTtlSeconds: 90,
        },
      },
      {},
      { CACHE_TTL_MINUTES: "invalid" },
    );
    assert.equal(
      ignoresInvalidLowerPriorityFallback.documentCacheTtlSeconds,
      90,
    );
  });

  it("normalizes an ordered backend list", () => {
    const config = resolveConfig(
      {},
      { "pi-web-search": { backends: [" SearXNG ", "DUCKDUCKGO", "BRAVE"] } },
      {},
    );
    assert.deepEqual(config.backends, ["searxng", "duckduckgo", "brave"]);
  });

  it("lists supported backends for an unknown backend", () => {
    assert.throws(
      () => resolveConfig({}, { "pi-web-search": { backends: ["other"] } }, {}),
      /supported backends are duckduckgo, searxng, and brave/,
    );
  });

  it("accepts the Brave key from settings before the environment", () => {
    const fromEnvironment = resolveConfig(
      {},
      { "pi-web-search": { backends: ["brave"] } },
      { BRAVE_SEARCH_API_KEY: "  environment-token  " },
    );
    assert.equal(fromEnvironment.braveApiKey, "environment-token");

    const fromGlobalSettings = resolveConfig(
      { "pi-web-search": { braveApiKey: "  global-token  " } },
      {},
      { BRAVE_SEARCH_API_KEY: "environment-token" },
    );
    assert.equal(fromGlobalSettings.braveApiKey, "global-token");

    const fromProjectSettings = resolveConfig(
      { "pi-web-search": { braveApiKey: "global-token" } },
      { "pi-web-search": { braveApiKey: "  project-token  " } },
      { BRAVE_SEARCH_API_KEY: "environment-token" },
    );
    assert.equal(fromProjectSettings.braveApiKey, "project-token");
    assert.equal(DEFAULT_CONFIG.braveApiKey, undefined);
  });

  it("rejects invalid Brave keys without exposing their values", () => {
    for (const value of ["", "   ", 42, true]) {
      assert.throws(
        () =>
          resolveConfig({}, { "pi-web-search": { braveApiKey: value } }, {}),
        /braveApiKey must be a non-empty string/,
      );
    }

    const secret = "BRAVE_SETTINGS_SECRET_123";
    let configurationError: unknown;
    try {
      resolveConfig({}, { "pi-web-search": { braveApiKey: { secret } } }, {});
    } catch (error) {
      configurationError = error;
    }
    assert.ok(configurationError instanceof ConfigurationError);
    assert.doesNotMatch(String(configurationError), new RegExp(secret));
    assert.equal(
      resolveConfig({}, {}, { BRAVE_SEARCH_API_KEY: "   " }).braveApiKey,
      undefined,
    );
  });

  it("configures the token-bucket rate and burst independently", () => {
    const config = resolveConfig(
      { "pi-web-search": { searchRateLimitPerMinute: 20 } },
      { "pi-web-search": { searchRateLimitBurst: 4 } },
      {},
    );
    assert.equal(config.searchRateLimitPerMinute, 20);
    assert.equal(config.searchRateLimitBurst, 4);
  });

  for (const [name, settings] of [
    ["invalid summarization toggle", { summarizationEnabled: "true" }],
    [
      "invalid summarizer thinking level",
      { summarizerThinkingLevel: "sometimes" },
    ],
    ["blank summarizer thinking level", { summarizerThinkingLevel: "   " }],
    ["non-string summarizer thinking level", { summarizerThinkingLevel: 1 }],
    ["invalid summarizer model", { summarizerModel: "not-a-model" }],
    [
      "oversized summarizer model",
      { summarizerModel: `provider/${"m".repeat(500)}` },
    ],
    ["blank summarizer model", { summarizerModel: "   " }],
    ["empty backend list", { backends: [] }],
    ["unknown backend", { backends: ["other"] }],
    ["duplicate backend", { backends: ["duckduckgo", "duckduckgo"] }],
    ["non-finite number", { searchTimeoutMs: Number.POSITIVE_INFINITY }],
    ["negative number", { searchTimeoutMs: -1 }],
    ["zero rate limit", { searchRateLimitPerMinute: 0 }],
    ["excessive burst", { searchRateLimitBurst: 101 }],
    ["unknown property", { surprise: true }],
    [
      "inconsistent defaults and caps",
      { searchMaxResults: 11, searchMaxLimitResults: 10 },
    ],
  ] as const) {
    it(`rejects ${name}`, () => {
      assert.throws(
        () => resolveConfig({}, { "pi-web-search": settings }, {}),
        ConfigurationError,
      );
    });
  }
});
