import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionAPI, ExecResult } from "@earendil-works/pi-coding-agent";
import { byteLength } from "../src/bounds.js";
import { DEFAULT_CONFIG, type PiWebSearchConfig } from "../src/config.js";
import { createSearchToolController } from "../src/tools/search-web.js";

interface RegisteredTool {
  name: string;
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

function commandResult(overrides: Partial<ExecResult> = {}): ExecResult {
  return { stdout: "", stderr: "", code: 0, killed: false, ...overrides };
}

describe("search_web tool", () => {
  it("registers the approved schema and returns bounded structured provenance", async () => {
    const tools: RegisteredTool[] = [];
    const pi = {
      registerTool(tool: RegisteredTool) {
        tools.push(tool);
      },
    } as unknown as ExtensionAPI;
    const config: PiWebSearchConfig = {
      ...DEFAULT_CONFIG,
      backends: ["ddgr"],
      searchMaxResults: 2,
      searchMaxLimitResults: 3,
      searchMaxOutputBytes: 4_096,
    };
    const controller = createSearchToolController(pi, () => config, {
      fetch: (async () => {
        throw new Error("SearXNG should not run");
      }) as typeof fetch,
      execute: async (_command, args) =>
        args[0] === "--version"
          ? commandResult({ stdout: "2.2" })
          : commandResult({
              stdout: JSON.stringify(
                Array.from({ length: 5 }, (_, index) => ({
                  title: `Result ${index}`,
                  url: `https://example.com/${index}`,
                  abstract: "Snippet",
                })),
              ),
            }),
      now: () => 1_000,
    });
    controller.register();
    const tool = tools.find((candidate) => candidate.name === "search_web");
    assert.ok(tool);
    const promptGuidelines = tool.promptGuidelines?.join("\n") ?? "";
    assert.match(promptGuidelines, /rate_limited/);
    assert.match(promptGuidelines, /error\.retryAfterMs/);
    assert.match(promptGuidelines, /discovery aids/);

    const result = await tool.execute(
      "call",
      { query: "query", limit: 10 },
      undefined,
      undefined,
      { cwd: process.cwd() },
    );
    assert.ok(
      byteLength(result.content[0].text) <= config.searchMaxOutputBytes,
    );
    assert.equal(result.details.status, "ok");
    const provenance = result.details.provenance as {
      backend?: string;
      cache?: { status?: string };
    };
    assert.equal(provenance.backend, "ddgr");
    assert.equal(provenance.cache?.status, "miss");
    const data = result.details.data as { results: unknown[] };
    assert.equal(data.results.length, 3);
    const warnings = result.details.warnings as Array<{ code?: string }>;
    assert.equal(warnings[0].code, "limit_clamped");
  });

  it("uses Brave when explicitly configured", async () => {
    const tools: RegisteredTool[] = [];
    const pi = {
      registerTool(tool: RegisteredTool) {
        tools.push(tool);
      },
    } as unknown as ExtensionAPI;
    const config: PiWebSearchConfig = {
      ...DEFAULT_CONFIG,
      backends: ["brave"],
      braveApiKey: "fake-token",
    };
    const controller = createSearchToolController(pi, () => config, {
      execute: async () => {
        throw new Error("ddgr should not run");
      },
      fetch: (async () =>
        new Response(
          JSON.stringify({
            web: {
              results: [
                {
                  title: "Brave result",
                  url: "https://example.com",
                  description: "Snippet",
                },
              ],
            },
          }),
          { headers: { "content-type": "application/json" } },
        )) as typeof fetch,
      now: () => 1_000,
    });
    controller.register();
    const tool = tools.find((candidate) => candidate.name === "search_web");
    assert.ok(tool);
    const result = await tool.execute(
      "call",
      { query: "query" },
      undefined,
      undefined,
      { cwd: process.cwd() },
    );
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
    const tools: RegisteredTool[] = [];
    const pi = {
      registerTool(tool: RegisteredTool) {
        tools.push(tool);
      },
    } as unknown as ExtensionAPI;
    const config: PiWebSearchConfig = {
      ...DEFAULT_CONFIG,
      backends: ["brave", "searxng"],
    };
    const controller = createSearchToolController(pi, () => config, {
      execute: async () => {
        throw new Error("ddgr should not run");
      },
      fetch: (async () =>
        new Response(
          JSON.stringify({
            results: [
              {
                title: "Fallback result",
                url: "https://example.com",
                content: "SearXNG",
              },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        )) as typeof fetch,
      now: () => 1_000,
    });
    controller.register();
    const tool = tools.find((candidate) => candidate.name === "search_web");
    assert.ok(tool);
    const result = await tool.execute(
      "call",
      { query: "query" },
      undefined,
      undefined,
      { cwd: process.cwd() },
    );
    assert.equal(result.details.status, "ok");
    assert.equal(
      (result.details.provenance as { backend?: string }).backend,
      "searxng",
    );
    const provenance = result.details.provenance as {
      attempts?: Array<{ backend?: string }>;
    };
    assert.deepEqual(
      provenance.attempts?.map((attempt) => attempt.backend),
      ["brave", "searxng"],
    );
    const warnings = result.details.warnings as Array<{ source?: string }>;
    assert.equal(warnings[0].source, "brave");
  });

  it("does not fall through after Brave returns no results", async () => {
    const tools: RegisteredTool[] = [];
    let calls = 0;
    const pi = {
      registerTool(tool: RegisteredTool) {
        tools.push(tool);
      },
    } as unknown as ExtensionAPI;
    const config: PiWebSearchConfig = {
      ...DEFAULT_CONFIG,
      backends: ["brave", "searxng"],
      braveApiKey: "fake-token",
    };
    const controller = createSearchToolController(pi, () => config, {
      execute: async () => {
        throw new Error("ddgr should not run");
      },
      fetch: (async () => {
        calls += 1;
        return new Response(JSON.stringify({ web: { results: [] } }), {
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch,
      now: () => 1_000,
    });
    controller.register();
    const tool = tools.find((candidate) => candidate.name === "search_web");
    assert.ok(tool);
    const result = await tool.execute(
      "call",
      { query: "query" },
      undefined,
      undefined,
      { cwd: process.cwd() },
    );
    assert.equal(result.details.status, "no_results");
    assert.equal(calls, 1);
    assert.deepEqual(
      (
        result.details.provenance as { attempts?: Array<{ backend?: string }> }
      ).attempts?.map((attempt) => attempt.backend),
      ["brave"],
    );
  });

  for (const { status, code, retryAfterMs } of [
    { status: 401, code: "backend_unavailable" },
    { status: 403, code: "blocked" },
    { status: 429, code: "rate_limited", retryAfterMs: "2" },
  ] as const) {
    it(`falls through from Brave HTTP ${status} to SearXNG`, async () => {
      const tools: RegisteredTool[] = [];
      let fetchCalls = 0;
      const pi = {
        registerTool(tool: RegisteredTool) {
          tools.push(tool);
        },
      } as unknown as ExtensionAPI;
      const config: PiWebSearchConfig = {
        ...DEFAULT_CONFIG,
        backends: ["brave", "searxng"],
        braveApiKey: "FAKE_BRAVE_FALLBACK_TOKEN",
      };
      const controller = createSearchToolController(pi, () => config, {
        execute: async () => {
          throw new Error("ddgr should not run");
        },
        fetch: (async () => {
          fetchCalls += 1;
          if (fetchCalls === 1) {
            return new Response("", {
              status,
              headers:
                retryAfterMs === undefined
                  ? undefined
                  : { "x-ratelimit-reset": retryAfterMs },
            });
          }
          return new Response(
            JSON.stringify({
              results: [
                {
                  title: "Fallback result",
                  url: "https://example.com",
                  content: "SearXNG",
                },
              ],
            }),
            { headers: { "content-type": "application/json" } },
          );
        }) as typeof fetch,
        now: () => 1_000,
      });
      controller.register();
      const tool = tools.find((candidate) => candidate.name === "search_web");
      assert.ok(tool);
      const result = await tool.execute(
        "call",
        { query: "query" },
        undefined,
        undefined,
        { cwd: process.cwd() },
      );
      assert.equal(result.details.status, "ok");
      assert.equal(
        (result.details.provenance as { backend?: string }).backend,
        "searxng",
      );
      assert.deepEqual(
        (
          result.details.provenance as {
            attempts?: Array<{ backend?: string }>;
          }
        ).attempts?.map((attempt) => attempt.backend),
        ["brave", "searxng"],
      );
      const warnings = result.details.warnings as Array<{
        code?: string;
        source?: string;
      }>;
      assert.equal(warnings[0].code, `backend_${code}`);
      assert.equal(warnings[0].source, "brave");
      assert.ok(byteLength(JSON.stringify(result)) < 10_000);
      assert.doesNotMatch(JSON.stringify(result), /FAKE_BRAVE_FALLBACK_TOKEN/);
    });
  }

  it("returns Brave-only missing-key errors at the registered tool layer", async () => {
    const tools: RegisteredTool[] = [];
    let fetchCalls = 0;
    let commandCalls = 0;
    const pi = {
      registerTool(tool: RegisteredTool) {
        tools.push(tool);
      },
    } as unknown as ExtensionAPI;
    const config: PiWebSearchConfig = {
      ...DEFAULT_CONFIG,
      backends: ["brave"],
    };
    const controller = createSearchToolController(pi, () => config, {
      execute: async () => {
        commandCalls += 1;
        throw new Error("ddgr should not run");
      },
      fetch: (async () => {
        fetchCalls += 1;
        return new Response("", { status: 500 });
      }) as typeof fetch,
      now: () => 1_000,
    });
    controller.register();
    const tool = tools.find((candidate) => candidate.name === "search_web");
    assert.ok(tool);
    const result = await tool.execute(
      "call",
      { query: "query" },
      undefined,
      undefined,
      { cwd: process.cwd() },
    );
    assert.equal(result.details.status, "error");
    assert.deepEqual(result.details.error, {
      code: "backend_unavailable",
      message: "Brave Search backend requires PI_WEB_SEARCH_BRAVE_API_KEY",
      retryable: false,
    });
    assert.equal(
      (result.details.provenance as { backend?: string }).backend,
      "brave",
    );
    assert.deepEqual(
      (
        result.details.provenance as {
          attempts?: Array<{ backend?: string }>;
        }
      ).attempts?.map((attempt) => attempt.backend),
      ["brave"],
    );
    assert.ok(byteLength(result.content[0].text) < 2_000);
    assert.equal(fetchCalls, 0);
    assert.equal(commandCalls, 0);
  });

  it("falls through from missing ddgr to SearXNG with a bounded warning", async () => {
    const tools: RegisteredTool[] = [];
    const pi = {
      registerTool(tool: RegisteredTool) {
        tools.push(tool);
      },
    } as unknown as ExtensionAPI;
    const config: PiWebSearchConfig = {
      ...DEFAULT_CONFIG,
      backends: ["ddgr", "searxng"],
    };
    const controller = createSearchToolController(pi, () => config, {
      execute: async () => {
        throw new Error("spawn ddgr ENOENT");
      },
      fetch: (async () =>
        new Response(
          JSON.stringify({
            results: [
              {
                title: "Fallback result",
                url: "https://example.com",
                content: "SearXNG",
              },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        )) as typeof fetch,
      now: () => 1_000,
    });
    controller.register();
    const tool = tools.find((candidate) => candidate.name === "search_web");
    assert.ok(tool);

    const result = await tool.execute(
      "call",
      { query: "query" },
      undefined,
      undefined,
      { cwd: process.cwd() },
    );
    assert.equal(result.details.status, "ok");
    assert.equal(
      (result.details.provenance as { backend?: string }).backend,
      "searxng",
    );
    const warnings = result.details.warnings as Array<{ message?: string }>;
    assert.match(warnings[0].message ?? "", /PATH/);
    assert.ok(byteLength(JSON.stringify(warnings)) < 2_000);
  });
});
