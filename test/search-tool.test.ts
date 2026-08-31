import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { byteLength } from "../src/bounds.js";
import { DEFAULT_CONFIG, type PiWebSearchConfig } from "../src/config.js";
import { createSearchToolController } from "../src/tools/search-web.js";

interface RegisteredTool {
  name: string;
  renderCall?: (...args: unknown[]) => unknown;
  renderResult?: (...args: unknown[]) => unknown;
  promptGuidelines?: string[];
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: { cwd: string },
  ): Promise<{
    content: Array<{ type: "text"; text: string }>;
    details: Record<string, unknown>;
  }>;
}

function htmlResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    ...init,
    headers: { "content-type": "text/html", ...init.headers },
  });
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

function nativeResults(count: number): string {
  const results = Array.from(
    { length: count },
    (_, index) =>
      `<div class="links_main"><h2 class="result__title"><a href="https://example.com/${index}">Result ${index}</a></h2><div class="result__snippet">Snippet</div></div>`,
  ).join("");
  return `<html><body><form class="header__form" action="/html/" method="post"><input name="q"></form><div id="links">${results}</div></body></html>`;
}

function controller(
  config: PiWebSearchConfig,
  fetch: typeof globalThis.fetch,
): RegisteredTool {
  const tools: RegisteredTool[] = [];
  const pi = {
    registerTool(tool: RegisteredTool) {
      tools.push(tool);
    },
  } as unknown as ExtensionAPI;
  createSearchToolController(pi, () => config, {
    fetch,
    now: () => 1_000,
  }).register();
  const tool = tools.find((candidate) => candidate.name === "search_web");
  assert.ok(tool);
  return tool;
}

async function execute(
  tool: RegisteredTool,
  params: Record<string, unknown>,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
}> {
  return tool.execute("call", params, undefined, undefined, {
    cwd: process.cwd(),
  });
}

describe("search_web tool", () => {
  it("registers the native backend and returns bounded structured provenance", async () => {
    const config: PiWebSearchConfig = {
      ...DEFAULT_CONFIG,
      backends: ["duckduckgo"],
      searchMaxResults: 2,
      searchMaxLimitResults: 3,
      searchMaxOutputBytes: 4_096,
    };
    const tool = controller(config, (async () =>
      htmlResponse(nativeResults(5))) as typeof fetch);
    assert.equal(typeof tool.renderCall, "function");
    assert.equal(typeof tool.renderResult, "function");
    const promptGuidelines = tool.promptGuidelines?.join("\n") ?? "";
    assert.match(promptGuidelines, /rate_limited/);
    assert.match(promptGuidelines, /error\.retryAfterMs/);
    assert.match(promptGuidelines, /discovery aids/);
    assert.match(promptGuidelines, /prefer summarize_url_content/);
    assert.match(promptGuidelines, /exact source text/);
    const result = await execute(tool, { query: "query", limit: 10 });
    assert.ok(
      byteLength(result.content[0].text) <= config.searchMaxOutputBytes,
    );
    assert.equal(result.details.status, "ok");
    const provenance = result.details.provenance as {
      backend?: string;
      cache?: { status?: string };
    };
    assert.equal(provenance.backend, "duckduckgo");
    assert.equal(provenance.cache?.status, "miss");
    const data = result.details.data as { results: unknown[] };
    assert.equal(data.results.length, 3);
    const warnings = result.details.warnings as Array<{ code?: string }>;
    assert.equal(warnings[0].code, "limit_clamped");
  });

  it("uses Brave when explicitly configured", async () => {
    const config: PiWebSearchConfig = {
      ...DEFAULT_CONFIG,
      backends: ["brave"],
      braveApiKey: "fake-token",
    };
    const tool = controller(config, (async () =>
      jsonResponse({
        web: {
          results: [
            {
              title: "Brave result",
              url: "https://example.com",
              description: "Snippet",
            },
          ],
        },
      })) as typeof fetch);
    const result = await execute(tool, { query: "query" });
    assert.equal(result.details.status, "ok");
    assert.equal(
      (result.details.provenance as { backend?: string }).backend,
      "brave",
    );
    assert.equal(
      (result.details.data as { results: Array<{ engine?: string }> })
        .results[0].engine,
      "brave",
    );
  });

  it("falls through from missing Brave to SearXNG with a bounded warning", async () => {
    let calls = 0;
    const config: PiWebSearchConfig = {
      ...DEFAULT_CONFIG,
      backends: ["brave", "searxng"],
      braveApiKey: "fake-token",
    };
    const tool = controller(config, (async () => {
      calls += 1;
      return calls === 1
        ? new Response("", { status: 401 })
        : jsonResponse({
            results: [
              {
                title: "Fallback result",
                url: "https://example.com",
                content: "SearXNG",
              },
            ],
          });
    }) as typeof fetch);
    const result = await execute(tool, { query: "query" });
    assert.equal(result.details.status, "ok");
    assert.equal(
      (result.details.provenance as { backend?: string }).backend,
      "searxng",
    );
    assert.deepEqual(
      (
        result.details.provenance as { attempts?: Array<{ backend?: string }> }
      ).attempts?.map((attempt) => attempt.backend),
      ["brave", "searxng"],
    );
    assert.equal(
      (result.details.warnings as Array<{ source?: string }>)[0].source,
      "brave",
    );
  });

  it("does not fall through after Brave returns no results", async () => {
    let calls = 0;
    const config: PiWebSearchConfig = {
      ...DEFAULT_CONFIG,
      backends: ["brave", "searxng"],
      braveApiKey: "fake-token",
    };
    const tool = controller(config, (async () => {
      calls += 1;
      return jsonResponse({ web: { results: [] } });
    }) as typeof fetch);
    const result = await execute(tool, { query: "query" });
    assert.equal(result.details.status, "no_results");
    assert.equal(calls, 1);
    assert.deepEqual(
      (
        result.details.provenance as { attempts?: Array<{ backend?: string }> }
      ).attempts?.map((attempt) => attempt.backend),
      ["brave"],
    );
  });

  for (const { status, code } of [
    { status: 401, code: "backend_unavailable" },
    { status: 403, code: "blocked" },
    { status: 429, code: "rate_limited" },
  ] as const) {
    it(`falls through from Brave HTTP ${status} to SearXNG`, async () => {
      let calls = 0;
      const config: PiWebSearchConfig = {
        ...DEFAULT_CONFIG,
        backends: ["brave", "searxng"],
        braveApiKey: "FAKE_BRAVE_FALLBACK_TOKEN",
      };
      const tool = controller(config, (async () => {
        calls += 1;
        return calls === 1
          ? new Response("", { status })
          : jsonResponse({
              results: [
                {
                  title: "Fallback",
                  url: "https://example.com",
                  content: "SearXNG",
                },
              ],
            });
      }) as typeof fetch);
      const result = await execute(tool, { query: "query" });
      assert.equal(result.details.status, "ok");
      assert.deepEqual(
        (
          result.details.provenance as {
            attempts?: Array<{ backend?: string }>;
          }
        ).attempts?.map((attempt) => attempt.backend),
        ["brave", "searxng"],
      );
      const warning = (
        result.details.warnings as Array<{ code?: string; source?: string }>
      )[0];
      assert.equal(warning.code, `backend_${code}`);
      assert.equal(warning.source, "brave");
      assert.doesNotMatch(JSON.stringify(result), /FAKE_BRAVE_FALLBACK_TOKEN/);
    });
  }

  it("returns Brave-only missing-key errors without fetching", async () => {
    let calls = 0;
    const config: PiWebSearchConfig = {
      ...DEFAULT_CONFIG,
      backends: ["brave"],
    };
    const tool = controller(config, (async () => {
      calls += 1;
      return new Response("", { status: 500 });
    }) as typeof fetch);
    const result = await execute(tool, { query: "query" });
    assert.equal(result.details.status, "error");
    assert.equal(
      (result.details.error as { code?: string }).code,
      "backend_unavailable",
    );
    assert.equal(calls, 0);
  });

  it("falls through from a native DuckDuckGo block to SearXNG", async () => {
    let calls = 0;
    const config: PiWebSearchConfig = {
      ...DEFAULT_CONFIG,
      backends: ["duckduckgo", "searxng"],
    };
    const tool = controller(config, (async () => {
      calls += 1;
      return calls === 1
        ? htmlResponse(
            '<html><body><div id="anomaly-modal">verify you are human</div></body></html>',
          )
        : jsonResponse({
            results: [
              {
                title: "Fallback",
                url: "https://example.com",
                content: "SearXNG",
              },
            ],
          });
    }) as typeof fetch);
    const result = await execute(tool, { query: "query" });
    assert.equal(result.details.status, "ok");
    assert.deepEqual(
      (
        result.details.provenance as { attempts?: Array<{ backend?: string }> }
      ).attempts?.map((attempt) => attempt.backend),
      ["duckduckgo", "searxng"],
    );
    assert.equal(
      (result.details.warnings as Array<{ source?: string }>)[0].source,
      "duckduckgo",
    );
  });
});
