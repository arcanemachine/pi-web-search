import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { byteLength } from "../src/bounds.js";
import { DEFAULT_CONFIG, type PiWebSearchConfig } from "../src/config.js";
import { createDocumentToolsController } from "../src/tools/document-tools.js";
import {
  createDocumentFixture,
  type DocumentFixture,
} from "./document-fixture.js";

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
}

interface RegisteredTool {
  name: string;
  renderCall?: (...args: unknown[]) => unknown;
  renderResult?: (...args: unknown[]) => unknown;
  parameters: unknown;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: { cwd: string },
  ): Promise<ToolResult>;
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

type ToolMap = Map<string, RegisteredTool> & {
  activeTools(): string[];
  setActiveCalls: string[][];
};

function toolsFor(
  config: PiWebSearchConfig,
  fixture: DocumentFixture,
  now: () => number = Date.now,
  initialActiveTools = [
    "read_url_content",
    "grep_url_content",
    "search_web",
    "bash",
    "custom_extension_tool",
  ],
  registerTimes = 1,
): ToolMap {
  const tools: RegisteredTool[] = [];
  let activeTools = [...initialActiveTools];
  const setActiveCalls: string[][] = [];
  const pi = {
    registerTool(tool: RegisteredTool) {
      tools.push(tool);
    },
    getActiveTools() {
      return [...activeTools];
    },
    setActiveTools(names: string[]) {
      activeTools = [...names];
      setActiveCalls.push([...names]);
    },
  } as unknown as ExtensionAPI;
  const controller = createDocumentToolsController(pi, () => config, {
    fetch: globalThis.fetch,
    now,
    cursorSecret: new Uint8Array(32).fill(9),
  });
  for (let index = 0; index < registerTimes; index += 1) {
    controller.register();
  }
  controller.synchronizeActivation();
  assert.ok(fixture.baseUrl);
  const result = new Map(tools.map((tool) => [tool.name, tool])) as ToolMap;
  result.activeTools = () => [...activeTools];
  result.setActiveCalls = setActiveCalls;
  return result;
}

async function execute(
  tool: RegisteredTool,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ToolResult> {
  return await tool.execute("call", params, signal, undefined, {
    cwd: process.cwd(),
  });
}

describe("shared document tools", () => {
  let fixture: DocumentFixture;
  before(async () => {
    fixture = await createDocumentFixture();
  });
  after(async () => {
    await fixture.close();
  });

  it("synchronizes only summarizer activation while preserving other tools", () => {
    const initiallyEnabled = toolsFor(
      packageConfig(),
      fixture,
      Date.now,
      [
        "read_url_content",
        "grep_url_content",
        "search_web",
        "bash",
        "custom_extension_tool",
        "summarize_url_content",
        "summarize_url_content",
      ],
      2,
    );
    assert.equal(initiallyEnabled.setActiveCalls.length, 1);
    assert.deepEqual(initiallyEnabled.activeTools(), [
      "read_url_content",
      "grep_url_content",
      "search_web",
      "bash",
      "custom_extension_tool",
      "summarize_url_content",
    ]);

    const disabled = toolsFor(
      packageConfig({ summarizationEnabled: false }),
      fixture,
      Date.now,
      initiallyEnabled.activeTools(),
    );
    assert.deepEqual(disabled.activeTools(), [
      "read_url_content",
      "grep_url_content",
      "search_web",
      "bash",
      "custom_extension_tool",
    ]);
    assert.equal(disabled.setActiveCalls.length, 1);
    assert.ok(disabled.has("summarize_url_content"));

    const reenabled = toolsFor(
      packageConfig(),
      fixture,
      Date.now,
      disabled.activeTools(),
    );
    assert.deepEqual(reenabled.activeTools(), [
      "read_url_content",
      "grep_url_content",
      "search_web",
      "bash",
      "custom_extension_tool",
      "summarize_url_content",
    ]);
    assert.equal(
      reenabled.activeTools().filter((name) => name === "summarize_url_content")
        .length,
      1,
    );
  });

  it("registers read and grep and paginates reads against one stable snapshot", async () => {
    let now = 10_000;
    const tools = toolsFor(packageConfig(), fixture, () => now);
    const read = tools.get("read_url_content");
    const grep = tools.get("grep_url_content");
    assert.ok(read);
    assert.ok(grep);
    assert.equal(typeof read.renderCall, "function");
    assert.equal(typeof read.renderResult, "function");
    assert.equal(typeof grep.renderCall, "function");
    assert.equal(typeof grep.renderResult, "function");

    const beforeRequests = fixture.requests("/changing");
    const first = await execute(read, {
      url: `${fixture.baseUrl}/changing`,
      maxChars: 40,
    });
    assert.equal(first.details.status, "ok");
    const firstData = first.details.data as {
      content: string;
      nextCursor?: string;
    };
    assert.ok(firstData.nextCursor);
    const firstProvenance = first.details.provenance as {
      contentHash?: string;
      fetchedAt?: string;
      cache?: { status?: string; ageMs?: number };
    };
    assert.equal(firstProvenance.cache?.status, "miss");

    now += 250;
    const second = await execute(read, {
      url: `${fixture.baseUrl}/changing`,
      maxChars: 40,
      cursor: firstData.nextCursor,
    });
    const secondProvenance = second.details.provenance as {
      contentHash?: string;
      fetchedAt?: string;
      cache?: { status?: string; ageMs?: number };
    };
    assert.equal(secondProvenance.contentHash, firstProvenance.contentHash);
    assert.equal(secondProvenance.fetchedAt, firstProvenance.fetchedAt);
    assert.equal(secondProvenance.cache?.status, "hit");
    assert.equal(secondProvenance.cache?.ageMs, 250);
    assert.equal(fixture.requests("/changing") - beforeRequests, 1);
  });

  it("shares normalized snapshots and returns reproducible coalesced grep windows", async () => {
    const tools = toolsFor(packageConfig(), fixture);
    const read = tools.get("read_url_content");
    const grep = tools.get("grep_url_content");
    assert.ok(read);
    assert.ok(grep);
    const beforeRequests = fixture.requests("/technical");

    const readResult = await execute(read, {
      url: `${fixture.baseUrl}/technical`,
      maxChars: 10_000,
    });
    const readData = readResult.details.data as { content: string };
    const readProvenance = readResult.details.provenance as {
      contentHash?: string;
    };
    assert.match(readData.content, /# API Guide/);
    assert.doesNotMatch(readData.content, /Navigation noise|Footer noise/);

    const grepResult = await execute(grep, {
      url: `${fixture.baseUrl}/technical`,
      query: "Target",
      beforeLines: 1,
      afterLines: 1,
    });
    assert.equal(grepResult.details.status, "ok");
    const grepData = grepResult.details.data as {
      totalMatches: number;
      matches: Array<{
        quote: string;
        quoteStartOffset: number;
        quoteEndOffset: number;
        matchCount: number;
        heading?: string;
      }>;
    };
    assert.equal(grepData.totalMatches, 2);
    assert.equal(grepData.matches.length, 1);
    assert.match(grepResult.content[0].text, /\*\*Matches:\*\* 2 of 2/);
    assert.doesNotMatch(grepResult.content[0].text, /\*\*Truncated:\*\*/);
    assert.equal(grepData.matches[0].matchCount, 2);
    assert.equal(grepData.matches[0].heading, "API Guide > Usage");
    assert.equal(
      [...readData.content]
        .slice(
          grepData.matches[0].quoteStartOffset,
          grepData.matches[0].quoteEndOffset,
        )
        .join(""),
      grepData.matches[0].quote,
    );
    assert.equal(
      (grepResult.details.provenance as { contentHash?: string }).contentHash,
      readProvenance.contentHash,
    );
    assert.equal(fixture.requests("/technical") - beforeRequests, 1);
  });

  it("returns explicit no-match and match offset pagination", async () => {
    const tools = toolsFor(packageConfig(), fixture);
    const grep = tools.get("grep_url_content");
    assert.ok(grep);

    const noMatch = await execute(grep, {
      url: `${fixture.baseUrl}/technical`,
      query: "definitely absent",
    });
    assert.equal(noMatch.details.status, "no_match");
    assert.ok(noMatch.content[0].text.trim());

    const literal = await execute(grep, {
      url: `${fixture.baseUrl}/technical`,
      query: "const value = 1;",
      caseSensitive: true,
    });
    assert.equal(literal.details.status, "ok");
    assert.equal(
      (literal.details.data as { totalMatches: number }).totalMatches,
      1,
    );
    const caseSensitive = await execute(grep, {
      url: `${fixture.baseUrl}/technical`,
      query: "target",
      caseSensitive: true,
    });
    assert.equal(caseSensitive.details.status, "no_match");

    const first = await execute(grep, {
      url: `${fixture.baseUrl}/technical`,
      query: "Target",
      maxMatches: 1,
      maxChars: 6,
      beforeLines: 0,
      afterLines: 0,
    });
    const firstData = first.details.data as {
      offset: number;
      nextOffset?: number;
      matches: Array<{ quote: string }>;
    };
    assert.equal(firstData.offset, 0);
    assert.equal(firstData.nextOffset, 1);
    assert.equal(firstData.matches[0].quote, "Target");
    assert.match(first.content[0].text, /\*\*Next offset:\*\* 1/);
    const second = await execute(grep, {
      url: `${fixture.baseUrl}/technical`,
      query: "Target",
      maxMatches: 1,
      maxChars: 6,
      beforeLines: 0,
      afterLines: 0,
      offset: firstData.nextOffset,
    });
    assert.equal(
      (second.details.bounds as { returnedItems?: number }).returnedItems,
      1,
    );
    assert.equal(
      (second.details.data as { nextOffset?: number }).nextOffset,
      undefined,
    );
    assert.equal((second.details.data as { offset?: number }).offset, 1);
  });

  it("expires evicted snapshot cursors instead of silently refetching", async () => {
    let now = 1_000;
    const tools = toolsFor(
      packageConfig({ documentCacheTtlSeconds: 1 }),
      fixture,
      () => now,
    );
    const read = tools.get("read_url_content");
    assert.ok(read);
    const first = await execute(read, {
      url: `${fixture.baseUrl}/changing`,
      maxChars: 20,
    });
    const cursor = (first.details.data as { nextCursor?: string }).nextCursor;
    assert.ok(cursor);

    now += 1_000;
    const expired = await execute(read, {
      url: `${fixture.baseUrl}/changing`,
      maxChars: 20,
      cursor,
    });
    assert.equal(expired.details.status, "error");
    assert.equal(
      (expired.details.error as { code?: string }).code,
      "cursor_expired",
    );
  });

  it("expires cursors when their snapshot is evicted", async () => {
    const tools = toolsFor(
      packageConfig({ documentCacheMaxEntries: 1 }),
      fixture,
    );
    const read = tools.get("read_url_content");
    assert.ok(read);
    const first = await execute(read, {
      url: `${fixture.baseUrl}/changing`,
      maxChars: 20,
    });
    const cursor = (first.details.data as { nextCursor?: string }).nextCursor;
    assert.ok(cursor);
    await execute(read, { url: `${fixture.baseUrl}/technical` });

    const expired = await execute(read, {
      url: `${fixture.baseUrl}/changing`,
      maxChars: 20,
      cursor,
    });
    assert.equal(
      (expired.details.error as { code?: string }).code,
      "cursor_expired",
    );
  });

  it("renders readable Markdown while preserving bounded structured details", async () => {
    const tools = toolsFor(packageConfig(), fixture);
    const read = tools.get("read_url_content");
    assert.ok(read);

    const markdown = await execute(read, {
      url: `${fixture.baseUrl}/markdown`,
    });
    assert.match(markdown.content[0].text, /^# Markdown/m);
    assert.equal(markdown.content[0].text.includes("data.content"), false);
    assert.equal(
      (markdown.details.data as { content: string }).content,
      "# Markdown\n\n- item",
    );
    assert.ok(
      markdown.content[0].text.includes(
        `**Source:** ${fixture.baseUrl}/markdown`,
      ),
    );
    assert.match(markdown.content[0].text, /Range:.*characters 0-18 of 18/);

    const json = await execute(read, { url: `${fixture.baseUrl}/json` });
    assert.match(json.content[0].text, /```json\n\{\n  "name": "fixture"/);
    assert.match(json.content[0].text, /\n```\n/);
    assert.match(json.content[0].text, /"items": \[\n    1,\n    2\n  \]/);
    assert.equal(
      (json.details.provenance as { contentType?: string }).contentType,
      "application/json",
    );

    const fenced = await execute(read, {
      url: `${fixture.baseUrl}/fenced-json`,
    });
    assert.match(fenced.content[0].text, /````json/);
    assert.ok(fenced.content[0].text.includes('"text": "```\\n~~~"'));
    assert.ok(byteLength(fenced.content[0].text) < 48 * 1_024);

    const first = await execute(read, {
      url: `${fixture.baseUrl}/changing`,
      maxChars: 10,
    });
    const nextCursor = (first.details.data as { nextCursor?: string })
      .nextCursor;
    assert.ok(nextCursor);
    assert.match(first.content[0].text, /\*\*Next cursor:\*\*/);
    const continued = await execute(read, {
      url: `${fixture.baseUrl}/changing`,
      maxChars: 10,
      cursor: nextCursor,
    });
    assert.match(continued.content[0].text, /\*\*Next cursor:\*\*/);
    assert.equal(
      (continued.details.data as { cursor?: string }).cursor,
      nextCursor,
    );
    const complete = await execute(read, {
      url: `${fixture.baseUrl}/article`,
      maxChars: 100,
    });
    assert.doesNotMatch(complete.content[0].text, /\*\*Next cursor:\*\*/);

    const error = await execute(read, { url: "ftp://example.test/file" });
    assert.match(error.content[0].text, /^\*\*read_url_content failed:\*\*/);
    assert.match(error.content[0].text, /Error code: `invalid_request`/);
    assert.equal(
      (error.details.error as { code?: string }).code,
      "invalid_request",
    );
  });

  it("bounds huge single lines and forwards cancellation", async () => {
    const tools = toolsFor(packageConfig(), fixture);
    const read = tools.get("read_url_content");
    const grep = tools.get("grep_url_content");
    assert.ok(read);
    assert.ok(grep);

    const huge = await execute(read, {
      url: `${fixture.baseUrl}/huge`,
      maxChars: 100,
    });
    assert.ok(byteLength(huge.content[0].text) <= 48 * 1_024);
    assert.ok(byteLength(JSON.stringify(huge.details)) <= 48 * 1_024);
    assert.ok(
      [...((huge.details.data as { content: string }).content ?? "")].length <=
        100,
    );
    const hugeVisible = await execute(read, {
      url: `${fixture.baseUrl}/huge`,
      maxChars: 40_000,
    });
    assert.ok(byteLength(hugeVisible.content[0].text) <= 48 * 1_024);
    assert.match(hugeVisible.content[0].text, /\*\*Range:\*\*/);
    const hugeBounds = hugeVisible.details.bounds as {
      returnedChars?: number;
      totalChars?: number;
    };
    assert.ok((hugeBounds.returnedChars ?? 0) < (hugeBounds.totalChars ?? 0));

    const grepHuge = await execute(grep, {
      url: `${fixture.baseUrl}/huge`,
      query: "界",
      maxMatches: 100,
      maxChars: 50,
      beforeLines: 20,
      afterLines: 20,
    });
    const matches = (
      grepHuge.details.data as { matches: Array<{ quote: string }> }
    ).matches;
    assert.ok(
      matches.reduce((total, match) => total + [...match.quote].length, 0) <=
        50,
    );
    assert.ok(byteLength(JSON.stringify(grepHuge.details)) <= 48 * 1_024);

    const controller = new AbortController();
    const pending = execute(
      read,
      { url: `${fixture.baseUrl}/slow` },
      controller.signal,
    );
    controller.abort(new Error("cancelled document tool"));
    await assert.rejects(pending, /cancelled document tool/);
  });
});
