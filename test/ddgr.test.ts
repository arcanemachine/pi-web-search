import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExecResult } from "@earendil-works/pi-coding-agent";
import type { SearchRequest } from "../src/contracts.js";
import { DdgrBackend, type CommandExecutor } from "../src/search/ddgr.js";

const request: SearchRequest = {
  query: '--exact "quoted"; echo nope — 世界',
  limit: 5,
  region: "us-en",
  safeSearch: "off",
  timeRange: "month",
};

function result(overrides: Partial<ExecResult> = {}): ExecResult {
  return { stdout: "", stderr: "", code: 0, killed: false, ...overrides };
}

describe("ddgr backend", () => {
  it("passes an inert query argv element with only required flags", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const execute: CommandExecutor = async (command, args) => {
      calls.push({ command, args });
      if (args[0] === "--version") return result({ stdout: "ddgr 2.2" });
      return result({
        stdout: JSON.stringify([
          {
            title: "Docs",
            url: "https://example.com/docs",
            abstract: "Reference",
          },
        ]),
      });
    };
    const backend = new DdgrBackend(execute, () => 100);
    const outcome = await backend.search(request, { timeoutMs: 1_000 });

    assert.equal(outcome.status, "ok");
    assert.equal(calls.length, 2);
    assert.equal(calls[1].command, "ddgr");
    assert.deepEqual(calls[1].args, [
      "--json",
      "--num",
      "5",
      "--reg",
      "us-en",
      "--time",
      "m",
      "--unsafe",
      "--",
      request.query,
    ]);
    assert.equal(calls[1].args.at(-1), request.query);
  });

  it("caches the version probe", async () => {
    let probes = 0;
    const execute: CommandExecutor = async (_command, args) => {
      if (args[0] === "--version") {
        probes += 1;
        return result({ stdout: "2.2" });
      }
      return result({ stdout: "[]" });
    };
    const backend = new DdgrBackend(execute);
    await backend.search(request, { timeoutMs: 1_000 });
    await backend.search(
      { ...request, query: "another" },
      { timeoutMs: 1_000 },
    );
    assert.equal(probes, 1);
  });

  it("distinguishes clean empty output from exit-zero failure evidence", async () => {
    const clean = new DdgrBackend(async (_command, args) =>
      args[0] === "--version"
        ? result({ stdout: "2.2" })
        : result({ stdout: "[]" }),
    );
    assert.equal(
      (await clean.search(request, { timeoutMs: 1_000 })).status,
      "no_results",
    );

    const failed = new DdgrBackend(async (_command, args) =>
      args[0] === "--version"
        ? result({ stdout: "2.2" })
        : result({ stdout: "[]", stderr: "HTTP Error 429: rate limit" }),
    );
    const failure = await failed.search(request, { timeoutMs: 1_000 });
    assert.equal(failure.status, "error");
    assert.equal(failure.error?.code, "rate_limited");
  });

  it("returns friendly missing-PATH guidance", async () => {
    const backend = new DdgrBackend(async () => {
      throw new Error("spawn ddgr ENOENT");
    });
    const outcome = await backend.search(request, { timeoutMs: 1_000 });
    assert.equal(outcome.error?.code, "backend_unavailable");
    assert.match(outcome.summary, /PATH/);
    assert.match(outcome.summary, /github\.com\/jarun\/ddgr/);
  });

  it("classifies killed work as a timeout", async () => {
    const backend = new DdgrBackend(async (_command, args) =>
      args[0] === "--version"
        ? result({ stdout: "2.2" })
        : result({ killed: true }),
    );
    const outcome = await backend.search(request, { timeoutMs: 1_000 });
    assert.equal(outcome.error?.code, "timeout");
  });

  it("forwards cancellation to subprocess execution", async () => {
    const execute: CommandExecutor = async (_command, args, options) => {
      if (args[0] === "--version") return result({ stdout: "2.2" });
      return await new Promise<ExecResult>((_resolve, reject) => {
        const abort = () =>
          reject(options.signal?.reason ?? new Error("aborted"));
        if (options.signal?.aborted) abort();
        else options.signal?.addEventListener("abort", abort, { once: true });
      });
    };
    const backend = new DdgrBackend(execute);
    const controller = new AbortController();
    const execution = backend.search(request, {
      timeoutMs: 1_000,
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort(new Error("cancelled by test"));
    await assert.rejects(execution, /cancelled by test/);
  });
});
