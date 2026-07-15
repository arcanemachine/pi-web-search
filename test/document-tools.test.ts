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

function toolsFor(
  config: PiWebSearchConfig,
  fixture: DocumentFixture,
  now: () => number = Date.now,
): Map<string, RegisteredTool> {
  const tools: RegisteredTool[] = [];
  const pi = {
    registerTool(tool: RegisteredTool) {
      tools.push(tool);
    },
  } as unknown as ExtensionAPI;
  createDocumentToolsController(pi, () => config, {
    fetch: globalThis.fetch,
    now,
    cursorSecret: new Uint8Array(32).fill(9),
  }).register();
  assert.ok(fixture.baseUrl);
  return new Map(tools.map((tool) => [tool.name, tool]));
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

  it("registers read and grep and paginates reads against one stable snapshot", async () => {
    let now = 10_000;
    const tools = toolsFor(packageConfig(), fixture, () => now);
    const read = tools.get("read_url_content");
    const grep = tools.get("grep_url_content");
    assert.ok(read);
    assert.ok(grep);

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
      maxMatches: 10,
      maxChars: 2_000,
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

  it("returns explicit no-match and stable match pagination", async () => {
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
      nextCursor?: string;
      matches: Array<{ quote: string }>;
    };
    assert.ok(firstData.nextCursor);
    assert.equal(firstData.matches[0].quote, "Target");
    const second = await execute(grep, {
      url: `${fixture.baseUrl}/technical`,
      query: "Target",
      maxMatches: 1,
      maxChars: 6,
      beforeLines: 0,
      afterLines: 0,
      cursor: firstData.nextCursor,
    });
    assert.equal(
      (second.details.bounds as { returnedItems?: number }).returnedItems,
      1,
    );
    assert.equal(
      (second.details.data as { nextCursor?: string }).nextCursor,
      undefined,
    );
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
