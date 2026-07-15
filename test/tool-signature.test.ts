import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG, type PiWebSearchConfig } from "../src/config.js";
import { registerExistingGrepTool } from "../src/tools/existing-tools.js";

interface RegisteredTool {
  name: string;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: { cwd: string },
  ): Promise<unknown>;
}

describe("existing tool bridge", () => {
  it("forwards Pi's third execute argument as the cancellation signal", async () => {
    const tools: RegisteredTool[] = [];
    const pi = {
      registerTool(tool: RegisteredTool) {
        tools.push(tool);
      },
    } as unknown as ExtensionAPI;

    let receivedSignal: AbortSignal | undefined;
    const fetchMock = (async (
      _input: URL | RequestInfo,
      init?: RequestInit,
    ): Promise<Response> => {
      receivedSignal = init?.signal ?? undefined;
      return await new Promise<Response>((_resolve, reject) => {
        const rejectAborted = () =>
          reject(receivedSignal?.reason ?? new Error("aborted"));
        if (receivedSignal?.aborted) rejectAborted();
        else
          receivedSignal?.addEventListener("abort", rejectAborted, {
            once: true,
          });
      });
    }) as typeof fetch;

    registerExistingGrepTool(
      pi,
      () =>
        ({
          ...DEFAULT_CONFIG,
          backends: [...DEFAULT_CONFIG.backends],
        }) as PiWebSearchConfig,
      { fetch: fetchMock, now: Date.now },
    );
    const tool = tools.find(
      (candidate) => candidate.name === "grep_url_content",
    );
    assert.ok(tool);

    const controller = new AbortController();
    const execution = tool.execute(
      "call-1",
      { url: "https://example.com", query: "query" },
      controller.signal,
      undefined,
      { cwd: process.cwd() },
    );
    controller.abort(new Error("cancelled by test"));

    await assert.rejects(execution, /cancelled by test/);
    assert.equal(receivedSignal?.aborted, true);
  });
});
