import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG, type PiWebSearchConfig } from "../src/config.js";
import { createDocumentToolsController } from "../src/tools/document-tools.js";
import {
  createDocumentFixture,
  type DocumentFixture,
} from "./document-fixture.js";

interface RegisteredTool {
  name: string;
  renderCall?: (...args: unknown[]) => unknown;
  renderResult?: (...args: unknown[]) => unknown;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: unknown;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    context: unknown,
  ): Promise<{
    content: Array<{ type: "text"; text: string }>;
    details: Record<string, unknown>;
    usage?: unknown;
  }>;
}

function packageConfig(
  overrides: Partial<PiWebSearchConfig> = {},
): PiWebSearchConfig {
  return {
    ...DEFAULT_CONFIG,
    backends: [...DEFAULT_CONFIG.backends],
    ...overrides,
  };
}

function toolsFor(
  config: PiWebSearchConfig,
  fixture: DocumentFixture,
): Map<string, RegisteredTool> {
  const tools: RegisteredTool[] = [];
  let activeTools = [
    "read_url_content",
    "grep_url_content",
    "search_web",
    "bash",
  ];
  const pi = {
    registerTool(tool: RegisteredTool) {
      tools.push(tool);
    },
    getActiveTools() {
      return [...activeTools];
    },
    setActiveTools(names: string[]) {
      activeTools = [...names];
    },
  } as unknown as ExtensionAPI;
  createDocumentToolsController(pi, () => config, {
    fetch: globalThis.fetch,
    now: Date.now,
    cursorSecret: new Uint8Array(32).fill(7),
  }).register();
  assert.ok(fixture.baseUrl);
  return new Map(tools.map((tool) => [tool.name, tool]));
}

function usage(reasoning?: number) {
  return {
    input: 10,
    output: 5,
    cacheRead: 0,
    cacheWrite: 0,
    ...(reasoning === undefined ? {} : { reasoning }),
    totalTokens: 15,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function model() {
  return {
    provider: "fake-provider",
    id: "summary-model",
    name: "Summary Model",
    api: "fake-api",
    baseUrl: "https://fake.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32_000,
    maxTokens: 2_048,
  };
}

function contextFor(
  currentModel: ReturnType<typeof model>,
  complete: (context: any, options?: any) => Promise<any>,
  find: (provider: string, id: string) => unknown = () => currentModel,
) {
  return {
    model: currentModel,
    modelRegistry: {
      find,
      hasConfiguredAuth: () => true,
      complete: async (_model: unknown, nested: unknown, options: unknown) =>
        await complete(nested, options),
    },
  };
}

async function execute(
  tool: RegisteredTool,
  params: Record<string, unknown>,
  context: unknown,
  signal?: AbortSignal,
) {
  return await tool.execute("call", params, signal, undefined, context);
}

describe("summarize_url_content tool", () => {
  let fixture: DocumentFixture;
  before(async () => {
    fixture = await createDocumentFixture();
  });
  after(async () => {
    await fixture.close();
  });

  it("stays registered with an invariant schema while disabled", async () => {
    const disabledTools = toolsFor(
      packageConfig({ summarizationEnabled: false }),
      fixture,
    );
    const enabledTools = toolsFor(
      packageConfig({
        summarizationEnabled: true,
        summarizerModel: "fake-provider/summary-model",
      }),
      fixture,
    );
    const disabled = disabledTools.get("summarize_url_content");
    const enabled = enabledTools.get("summarize_url_content");
    assert.ok(disabled);
    assert.ok(enabled);
    assert.equal(typeof disabled.renderCall, "function");
    assert.equal(typeof disabled.renderResult, "function");
    assert.equal(typeof enabled.renderCall, "function");
    assert.equal(typeof enabled.renderResult, "function");
    assert.deepEqual(disabled.parameters, enabled.parameters);
    assert.equal(disabled.description, enabled.description);
    assert.equal(disabled.promptSnippet, enabled.promptSnippet);
    assert.deepEqual(disabled.promptGuidelines, enabled.promptGuidelines);
    const summaryGuidelines = enabled.promptGuidelines?.join("\n") ?? "";
    assert.match(summaryGuidelines, /Prefer summarize_url_content/);
    assert.match(summaryGuidelines, /rather than reading the page first/);
    const readGuidelines =
      disabledTools.get("read_url_content")?.promptGuidelines?.join("\n") ?? "";
    const grepGuidelines =
      disabledTools.get("grep_url_content")?.promptGuidelines?.join("\n") ?? "";
    assert.match(readGuidelines, /exact source text/);
    assert.match(readGuidelines, /when it is available/);
    assert.match(grepGuidelines, /targeted literal evidence/);
    assert.match(grepGuidelines, /when it is available/);
    const result = await execute(
      disabled,
      { url: `${fixture.baseUrl}/technical` },
      {},
    );
    assert.equal(result.details.status, "error");
    assert.equal(
      (result.details.error as { code: string }).code,
      "backend_unavailable",
    );
  });

  it("uses an isolated direct completion for a small document", async () => {
    const config = packageConfig({ summarizationEnabled: true });
    const tools = toolsFor(config, fixture);
    const summarize = tools.get("summarize_url_content");
    assert.ok(summarize);
    const currentModel = model();
    const nestedContexts: any[] = [];
    const result = await execute(
      summarize,
      {
        url: `${fixture.baseUrl}/technical`,
        objective: "What is this guide about?",
      },
      contextFor(currentModel, async (nested) => {
        nestedContexts.push(nested);
        return {
          role: "assistant",
          content: [{ type: "text", text: "It is an API usage guide." }],
          provider: currentModel.provider,
          model: currentModel.id,
          stopReason: "stop",
          usage: usage(),
          timestamp: Date.now(),
        };
      }),
    );
    assert.equal(result.details.status, "ok");
    const data = result.details.data as {
      summary: string;
      generation: { provider: string; model: string; modelCalls: number };
    };
    assert.equal(data.summary, "It is an API usage guide.");
    assert.equal(data.generation.provider, currentModel.provider);
    assert.equal(data.generation.model, currentModel.id);
    assert.equal(data.generation.modelCalls, 1);
    assert.equal((result.usage as { totalTokens: number }).totalTokens, 15);
    assert.equal(nestedContexts.length, 1);
    assert.match(
      nestedContexts[0].messages[0].content,
      /What is this guide about/,
    );
    assert.match(nestedContexts[0].messages[0].content, /API Guide/);
    assert.equal(fixture.requests("/technical"), 1);
  });

  it("omits reasoning effort when thinking level is not configured", async () => {
    const config = packageConfig({ summarizationEnabled: true });
    const tools = toolsFor(config, fixture);
    const summarize = tools.get("summarize_url_content");
    assert.ok(summarize);
    const currentModel = model();
    let options: any;
    const result = await execute(
      summarize,
      { url: `${fixture.baseUrl}/article` },
      contextFor(currentModel, async (_nested, nextOptions) => {
        options = nextOptions;
        return {
          role: "assistant",
          content: [{ type: "text", text: "Default reasoning." }],
          provider: currentModel.provider,
          model: currentModel.id,
          stopReason: "stop",
          usage: usage(),
          timestamp: Date.now(),
        };
      }),
    );
    assert.equal(result.details.status, "ok");
    assert.equal(options.reasoningEffort, undefined);
  });

  it("passes configured Codex thinking effort on every nested turn", async () => {
    const config = packageConfig({
      summarizationEnabled: true,
      summarizerThinkingLevel: "low",
    });
    const tools = toolsFor(config, fixture);
    const summarize = tools.get("summarize_url_content");
    assert.ok(summarize);
    const currentModel = {
      ...model(),
      api: "openai-codex-responses",
      reasoning: true,
    };
    const options: any[] = [];
    let calls = 0;
    const result = await execute(
      summarize,
      { url: `${fixture.baseUrl}/article` },
      contextFor(currentModel, async (_nested, nextOptions) => {
        options.push(nextOptions);
        calls += 1;
        if (calls === 1) {
          return {
            role: "assistant",
            content: [
              {
                type: "toolCall",
                id: "read-1",
                name: "read_document",
                arguments: { startLine: 1, lineCount: 1 },
              },
            ],
            provider: currentModel.provider,
            model: currentModel.id,
            stopReason: "toolUse",
            usage: usage(2),
            timestamp: Date.now(),
          };
        }
        return {
          role: "assistant",
          content: [{ type: "text", text: "Low effort summary." }],
          provider: currentModel.provider,
          model: currentModel.id,
          stopReason: "stop",
          usage: usage(3),
          timestamp: Date.now(),
        };
      }),
    );
    assert.equal(result.details.status, "ok");
    assert.equal((result.usage as { reasoning?: number }).reasoning, 5);
    assert.equal(options.length, 2);
    assert.deepEqual(
      options.map((next) => next.reasoningEffort),
      ["low", "low"],
    );
    assert.equal(
      (result.details.data as { generation: { thinkingLevel?: string } })
        .generation.thinkingLevel,
      "low",
    );
  });

  it("maps Codex off to none", async () => {
    const config = packageConfig({
      summarizationEnabled: true,
      summarizerThinkingLevel: "off",
    });
    const tools = toolsFor(config, fixture);
    const summarize = tools.get("summarize_url_content");
    assert.ok(summarize);
    const currentModel = {
      ...model(),
      api: "openai-codex-responses",
      reasoning: true,
    };
    let options: any;
    const result = await execute(
      summarize,
      { url: `${fixture.baseUrl}/article` },
      contextFor(currentModel, async (_nested, nextOptions) => {
        options = nextOptions;
        return {
          role: "assistant",
          content: [{ type: "text", text: "No reasoning summary." }],
          provider: currentModel.provider,
          model: currentModel.id,
          stopReason: "stop",
          usage: usage(),
          timestamp: Date.now(),
        };
      }),
    );
    assert.equal(result.details.status, "ok");
    assert.equal(options.reasoningEffort, "none");
  });

  it("fails before completion for unsupported or non-reasoning thinking", async () => {
    const unsupportedTools = toolsFor(
      packageConfig({
        summarizationEnabled: true,
        summarizerThinkingLevel: "low",
      }),
      fixture,
    );
    const unsupported = unsupportedTools.get("summarize_url_content");
    assert.ok(unsupported);
    let unsupportedCalls = 0;
    const unsupportedResult = await execute(
      unsupported,
      { url: `${fixture.baseUrl}/article` },
      contextFor({ ...model(), reasoning: true }, async () => {
        unsupportedCalls += 1;
        return {};
      }),
    );
    assert.equal(unsupportedResult.details.status, "error");
    assert.match(unsupportedResult.details.summary as string, /unsupported/);
    assert.equal(unsupportedCalls, 0);

    const nonReasoningModel = {
      ...model(),
      api: "openai-codex-responses",
      reasoning: false,
    };
    let nonReasoningCalls = 0;
    const nonReasoningResult = await execute(
      unsupported,
      { url: `${fixture.baseUrl}/article` },
      contextFor(nonReasoningModel, async () => {
        nonReasoningCalls += 1;
        return {};
      }),
    );
    assert.equal(nonReasoningResult.details.status, "error");
    assert.match(nonReasoningResult.details.summary as string, /non-reasoning/);
    assert.equal(nonReasoningCalls, 0);
  });

  it("uses the explicitly configured model without active-model fallback", async () => {
    const configured = {
      ...model(),
      id: "configured-model",
      api: "openai-codex-responses",
      reasoning: true,
    };
    const active = { ...model(), id: "active-model" };
    const config = packageConfig({
      summarizationEnabled: true,
      summarizerModel: "fake-provider/configured-model",
      summarizerThinkingLevel: "low",
    });
    const tools = toolsFor(config, fixture);
    const summarize = tools.get("summarize_url_content");
    assert.ok(summarize);
    let selected: unknown;
    let options: any;
    const result = await execute(
      summarize,
      { url: `${fixture.baseUrl}/article` },
      {
        model: active,
        modelRegistry: {
          find: () => configured,
          hasConfiguredAuth: () => true,
          complete: async (
            selectedModel: unknown,
            _nested: unknown,
            nextOptions: unknown,
          ) => {
            selected = selectedModel;
            options = nextOptions;
            return {
              role: "assistant",
              content: [{ type: "text", text: "Configured model answer." }],
              provider: configured.provider,
              model: configured.id,
              stopReason: "stop",
              usage: usage(),
              timestamp: Date.now(),
            };
          },
        },
      },
    );
    assert.equal(result.details.status, "ok");
    assert.equal(
      (result.details.data as { generation: { selection: string } }).generation
        .selection,
      "configured",
    );
    assert.equal((selected as { id: string }).id, configured.id);
    assert.equal(options.reasoningEffort, "low");
    assert.equal(
      (result.details.data as { generation: { thinkingLevel?: string } })
        .generation.thinkingLevel,
      "low",
    );
  });

  it("allows only bound reads and literal grep for large-document follow-up", async () => {
    const tools = toolsFor(
      packageConfig({ summarizationEnabled: true }),
      fixture,
    );
    const summarize = tools.get("summarize_url_content");
    assert.ok(summarize);
    const currentModel = model();
    const nestedContexts: any[] = [];
    const result = await execute(
      summarize,
      { url: `${fixture.baseUrl}/technical`, objective: "Find the targets." },
      contextFor(currentModel, async (nested) => {
        nestedContexts.push(nested);
        if (nestedContexts.length === 1) {
          return {
            role: "assistant",
            content: [
              {
                type: "toolCall",
                id: "read-1",
                name: "read_document",
                arguments: { startLine: 1, lineCount: 3 },
              },
            ],
            provider: currentModel.provider,
            model: currentModel.id,
            stopReason: "toolUse",
            usage: usage(),
            timestamp: Date.now(),
          };
        }
        if (nestedContexts.length === 2) {
          return {
            role: "assistant",
            content: [
              {
                type: "toolCall",
                id: "grep-1",
                name: "grep_document",
                arguments: { query: "Target", maxMatches: 5 },
              },
            ],
            provider: currentModel.provider,
            model: currentModel.id,
            stopReason: "toolUse",
            usage: usage(),
            timestamp: Date.now(),
          };
        }
        return {
          role: "assistant",
          content: [
            { type: "text", text: "Targets appear in the Usage section." },
          ],
          provider: currentModel.provider,
          model: currentModel.id,
          stopReason: "stop",
          usage: usage(),
          timestamp: Date.now(),
        };
      }),
    );
    assert.equal(result.details.status, "ok");
    const data = result.details.data as {
      summary: string;
      generation: { documentToolCalls: number; modelCalls: number };
    };
    assert.equal(data.summary, "Targets appear in the Usage section.");
    assert.equal(data.generation.documentToolCalls, 2);
    assert.equal(data.generation.modelCalls, 3);
    assert.equal(nestedContexts[0].tools.length, 2);
    assert.deepEqual(
      nestedContexts[0].tools.map((tool: { name: string }) => tool.name),
      ["read_document", "grep_document"],
    );
    assert.equal(fixture.requests("/technical"), 2);
  });

  it("marks bounded private document results for the nested model", async () => {
    const tools = toolsFor(
      packageConfig({ summarizationEnabled: true }),
      fixture,
    );
    const summarize = tools.get("summarize_url_content");
    assert.ok(summarize);
    const currentModel = model();
    const nestedContexts: any[] = [];
    const result = await execute(
      summarize,
      { url: `${fixture.baseUrl}/huge` },
      contextFor(currentModel, async (nested) => {
        nestedContexts.push(nested);
        if (nestedContexts.length === 1) {
          return {
            role: "assistant",
            content: [
              {
                type: "toolCall",
                id: "read-huge",
                name: "read_document",
                arguments: { startLine: 1, lineCount: 1 },
              },
            ],
            provider: currentModel.provider,
            model: currentModel.id,
            stopReason: "toolUse",
            usage: usage(),
            timestamp: Date.now(),
          };
        }
        return {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "The document contains a bounded large line.",
            },
          ],
          provider: currentModel.provider,
          model: currentModel.id,
          stopReason: "stop",
          usage: usage(),
          timestamp: Date.now(),
        };
      }),
    );
    assert.equal(result.details.status, "ok");
    const toolMessage = nestedContexts[1].messages.find(
      (message: { role: string }) => message.role === "toolResult",
    );
    assert.equal(toolMessage.details.truncated, true);
    assert.equal(toolMessage.details.resultTruncated, true);
  });

  it("reuses a snapshot created by read_url_content", async () => {
    const tools = toolsFor(
      packageConfig({ summarizationEnabled: true }),
      fixture,
    );
    const read = tools.get("read_url_content");
    const summarize = tools.get("summarize_url_content");
    assert.ok(read);
    assert.ok(summarize);
    const currentModel = model();
    const context = contextFor(currentModel, async () => ({
      role: "assistant",
      content: [{ type: "text", text: "Reused source summary" }],
      provider: currentModel.provider,
      model: currentModel.id,
      stopReason: "stop",
      usage: usage(),
      timestamp: Date.now(),
    }));
    const before = fixture.requests("/article");
    await execute(read, { url: `${fixture.baseUrl}/article` }, context);
    await execute(summarize, { url: `${fixture.baseUrl}/article` }, context);
    assert.equal(fixture.requests("/article") - before, 1);
  });

  it("reuses source snapshots but never caches generated summaries", async () => {
    const tools = toolsFor(
      packageConfig({ summarizationEnabled: true }),
      fixture,
    );
    const summarize = tools.get("summarize_url_content");
    assert.ok(summarize);
    const currentModel = model();
    let calls = 0;
    const context = contextFor(currentModel, async () => {
      calls += 1;
      return {
        role: "assistant",
        content: [{ type: "text", text: `Summary ${calls}` }],
        provider: currentModel.provider,
        model: currentModel.id,
        stopReason: "stop",
        usage: usage(),
        timestamp: Date.now(),
      };
    });
    const before = fixture.requests("/article");
    const first = await execute(
      summarize,
      { url: `${fixture.baseUrl}/article` },
      context,
    );
    const second = await execute(
      summarize,
      { url: `${fixture.baseUrl}/article` },
      context,
    );
    assert.equal(first.details.status, "ok");
    assert.equal(second.details.status, "ok");
    assert.equal(calls, 2);
    assert.equal(fixture.requests("/article") - before, 1);
  });

  it("forceRefresh refetches the source snapshot", async () => {
    const tools = toolsFor(
      packageConfig({ summarizationEnabled: true }),
      fixture,
    );
    const summarize = tools.get("summarize_url_content");
    assert.ok(summarize);
    const currentModel = model();
    const context = contextFor(currentModel, async () => ({
      role: "assistant",
      content: [{ type: "text", text: "Summary" }],
      provider: currentModel.provider,
      model: currentModel.id,
      stopReason: "stop",
      usage: usage(),
      timestamp: Date.now(),
    }));
    const before = fixture.requests("/article");
    await execute(summarize, { url: `${fixture.baseUrl}/article` }, context);
    await execute(
      summarize,
      { url: `${fixture.baseUrl}/article`, forceRefresh: true },
      context,
    );
    assert.equal(fixture.requests("/article") - before, 2);
  });

  it("fails without partial prose after repeated invalid completions", async () => {
    const tools = toolsFor(
      packageConfig({ summarizationEnabled: true }),
      fixture,
    );
    const summarize = tools.get("summarize_url_content");
    assert.ok(summarize);
    const currentModel = model();
    let calls = 0;
    const result = await execute(
      summarize,
      { url: `${fixture.baseUrl}/article` },
      contextFor(currentModel, async () => {
        calls += 1;
        return {
          role: "assistant",
          content: [],
          provider: currentModel.provider,
          model: currentModel.id,
          stopReason: "stop",
          usage: usage(),
          timestamp: Date.now(),
        };
      }),
    );
    assert.equal(result.details.status, "error");
    assert.equal(
      (result.details.error as { code: string }).code,
      "generation_failed",
    );
    assert.equal((result.details.data as unknown) ?? undefined, undefined);
    assert.equal(calls, 4);
  });

  it("corrects an oversized model answer instead of truncating it", async () => {
    const tools = toolsFor(
      packageConfig({ summarizationEnabled: true }),
      fixture,
    );
    const summarize = tools.get("summarize_url_content");
    assert.ok(summarize);
    const currentModel = model();
    let calls = 0;
    const result = await execute(
      summarize,
      { url: `${fixture.baseUrl}/article` },
      contextFor(currentModel, async () => {
        calls += 1;
        return {
          role: "assistant",
          content: [
            {
              type: "text",
              text: calls === 1 ? "x".repeat(12_001) : "Bounded answer",
            },
          ],
          provider: currentModel.provider,
          model: currentModel.id,
          stopReason: "stop",
          usage: usage(),
          timestamp: Date.now(),
        };
      }),
    );
    assert.equal(result.details.status, "ok");
    assert.equal(
      (result.details.data as { summary: string }).summary,
      "Bounded answer",
    );
    assert.equal(calls, 2);
    assert.ok(result.content[0].text.length < 48 * 1_024);
    assert.ok(JSON.stringify(result.details).length < 48 * 1_024);
  });

  it("fails after repeated unknown nested tools", async () => {
    const tools = toolsFor(
      packageConfig({ summarizationEnabled: true }),
      fixture,
    );
    const summarize = tools.get("summarize_url_content");
    assert.ok(summarize);
    const currentModel = model();
    let calls = 0;
    const result = await execute(
      summarize,
      { url: `${fixture.baseUrl}/article` },
      contextFor(currentModel, async () => {
        calls += 1;
        return {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: `unknown-${calls}`,
              name: "read_anything",
              arguments: {},
            },
          ],
          provider: currentModel.provider,
          model: currentModel.id,
          stopReason: "toolUse",
          usage: usage(),
          timestamp: Date.now(),
        };
      }),
    );
    assert.equal(result.details.status, "error");
    assert.equal(
      (result.details.error as { code: string }).code,
      "generation_failed",
    );
    assert.equal(calls, 4);
  });

  it("rejects an unauthenticated configured model without fetching", async () => {
    const tools = toolsFor(
      packageConfig({
        summarizationEnabled: true,
        summarizerModel: "fake-provider/configured-model",
      }),
      fixture,
    );
    const summarize = tools.get("summarize_url_content");
    assert.ok(summarize);
    const configured = { ...model(), id: "configured-model" };
    const result = await execute(
      summarize,
      { url: `${fixture.baseUrl}/article` },
      {
        model: model(),
        modelRegistry: {
          find: () => configured,
          hasConfiguredAuth: () => false,
          complete: async () => {
            throw new Error("must not complete");
          },
        },
      },
    );
    assert.equal(result.details.status, "error");
    assert.match(result.details.summary as string, /authentication/);
  });

  it("propagates parent cancellation while the provider is still pending", async () => {
    const tools = toolsFor(
      packageConfig({ summarizationEnabled: true }),
      fixture,
    );
    const summarize = tools.get("summarize_url_content");
    assert.ok(summarize);
    const currentModel = model();
    const controller = new AbortController();
    const pending = execute(
      summarize,
      { url: `${fixture.baseUrl}/article` },
      contextFor(currentModel, async () => await new Promise(() => undefined)),
      controller.signal,
    );
    controller.abort(new Error("cancelled summarization"));
    await assert.rejects(pending, /cancelled summarization/);
  });

  it("does not fall back when an explicit configured model is unavailable", async () => {
    const tools = toolsFor(
      packageConfig({
        summarizationEnabled: true,
        summarizerModel: "missing/model",
      }),
      fixture,
    );
    const summarize = tools.get("summarize_url_content");
    assert.ok(summarize);
    const currentModel = model();
    const result = await execute(
      summarize,
      { url: `${fixture.baseUrl}/article` },
      contextFor(
        currentModel,
        async () => {
          throw new Error("active model must not be used");
        },
        () => undefined,
      ),
    );
    assert.equal(result.details.status, "error");
    assert.match(result.details.summary as string, /unavailable/);
  });
});
