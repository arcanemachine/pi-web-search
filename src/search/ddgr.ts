import type { ExecResult } from "@earendil-works/pi-coding-agent";
import { truncateUtf8 } from "../bounds.js";
import {
  operationalError,
  type Diagnostic,
  type OperationalError,
  type OutcomeEnvelope,
  type SearchOutcomeData,
  type SearchRequest,
} from "../contracts.js";
import type { SearchBackend, SearchBackendContext } from "./backend.js";
import { parseDdgrPayload } from "./validation.js";

const DDGR_REPOSITORY = "https://github.com/jarun/ddgr";
const STDERR_MAX_BYTES = 4_096;

export type CommandExecutor = (
  command: string,
  args: string[],
  options: { signal?: AbortSignal; timeout: number },
) => Promise<ExecResult>;

type ProbeResult =
  | { available: true; version: string; supportsDoubleDash: boolean }
  | { available: false; error: OperationalError };

function elapsed(start: number, now: () => number): number {
  return Math.max(0, now() - start);
}

function backendError(
  request: SearchRequest,
  error: OperationalError,
  durationMs: number,
): OutcomeEnvelope<SearchOutcomeData> {
  return {
    operation: "search_web",
    status: "error",
    summary: error.message,
    data: { query: request.query, results: [] },
    error,
    provenance: { backend: "ddgr", durationMs, cache: { status: "miss" } },
  };
}

function missingError(): OperationalError {
  return operationalError(
    "backend_unavailable",
    `ddgr is not installed or not available on PATH. Install it from ${DDGR_REPOSITORY}.`,
    false,
  );
}

function classifyStderr(stderr: string): OperationalError | undefined {
  const normalized = stderr.toLowerCase();
  if (/\bhttp error 202:\s*accepted\b/.test(normalized)) {
    return operationalError(
      "blocked",
      "ddgr received DuckDuckGo's transient HTTP 202 blocking response",
      true,
    );
  }
  if (/rate[ -]?limit|too many requests|\b429\b/.test(normalized)) {
    return operationalError(
      "rate_limited",
      "ddgr reported rate-limit evidence",
      true,
    );
  }
  if (/captcha|anomal|forbidden|\b403\b|blocked/.test(normalized)) {
    return operationalError("blocked", "ddgr reported blocking evidence", true);
  }
  if (/timed? out|timeout/.test(normalized)) {
    return operationalError("timeout", "ddgr reported a timeout", true);
  }
  if (/error|exception|failed|failure|unable|connection/.test(normalized)) {
    return operationalError(
      "backend_failed",
      "ddgr reported a backend failure",
      true,
    );
  }
  return undefined;
}

function timeArgument(value: SearchRequest["timeRange"]): string | undefined {
  switch (value) {
    case undefined:
      return undefined;
    case "day":
      return "d";
    case "week":
      return "w";
    case "month":
      return "m";
    case "year":
      return "y";
  }
}

export class DdgrBackend implements SearchBackend {
  readonly name = "ddgr" as const;
  private probePromise: Promise<ProbeResult> | undefined;

  constructor(
    private readonly execute: CommandExecutor,
    private readonly now: () => number = Date.now,
  ) {}

  async search(
    request: SearchRequest,
    context: SearchBackendContext,
  ): Promise<OutcomeEnvelope<SearchOutcomeData>> {
    const startedAt = this.now();
    const probe = await this.probe(context);
    if (!probe.available) {
      return backendError(request, probe.error, elapsed(startedAt, this.now));
    }

    const remainingMs = context.timeoutMs - elapsed(startedAt, this.now);
    if (remainingMs <= 0) {
      return backendError(
        request,
        operationalError("timeout", "ddgr search timed out", true),
        elapsed(startedAt, this.now),
      );
    }

    const args = ["--json", "--num", String(request.limit ?? 5)];
    if (request.region) args.push("--reg", request.region);
    const time = timeArgument(request.timeRange);
    if (time) args.push("--time", time);
    if (request.safeSearch === "off") args.push("--unsafe");
    if (probe.supportsDoubleDash) args.push("--");
    args.push(request.query);

    let result: ExecResult;
    try {
      result = await this.execute("ddgr", args, {
        signal: context.signal,
        timeout: remainingMs,
      });
    } catch (error) {
      if (context.signal?.aborted) throw context.signal.reason ?? error;
      const message = error instanceof Error ? error.message : String(error);
      if (/ENOENT|not found|no such file/i.test(message)) {
        return backendError(
          request,
          missingError(),
          elapsed(startedAt, this.now),
        );
      }
      return backendError(
        request,
        operationalError(
          "backend_failed",
          `ddgr execution failed: ${message}`,
          true,
        ),
        elapsed(startedAt, this.now),
      );
    }

    if (context.signal?.aborted) {
      throw context.signal.reason ?? new Error("ddgr search cancelled");
    }
    if (result.killed) {
      return backendError(
        request,
        operationalError("timeout", "ddgr search timed out", true),
        elapsed(startedAt, this.now),
      );
    }

    const stderr = truncateUtf8(result.stderr.trim(), STDERR_MAX_BYTES).value;
    const stderrError = classifyStderr(stderr);
    if (result.code !== 0) {
      return backendError(
        request,
        stderrError ??
          operationalError(
            "backend_failed",
            `ddgr exited with status ${result.code}`,
            true,
          ),
        elapsed(startedAt, this.now),
      );
    }

    let native: unknown;
    try {
      native = JSON.parse(result.stdout);
    } catch {
      return backendError(
        request,
        operationalError("parse_failed", "ddgr returned malformed JSON", false),
        elapsed(startedAt, this.now),
      );
    }
    const parsed = parseDdgrPayload(native);
    if (!parsed.ok) {
      return backendError(request, parsed.error, elapsed(startedAt, this.now));
    }
    if (parsed.value.length === 0 && stderrError) {
      return backendError(request, stderrError, elapsed(startedAt, this.now));
    }

    const warnings: Diagnostic[] = [];
    if (stderr) {
      warnings.push({
        code: stderrError?.code ?? "backend_stderr",
        message: stderr,
        source: "ddgr",
      });
    }
    const status = parsed.value.length === 0 ? "no_results" : "ok";
    return {
      operation: "search_web",
      status,
      summary:
        status === "ok"
          ? `ddgr returned ${parsed.value.length} result${parsed.value.length === 1 ? "" : "s"}`
          : "ddgr returned no results",
      data: { query: request.query, results: parsed.value },
      ...(warnings.length === 0 ? {} : { warnings }),
      provenance: {
        backend: "ddgr",
        durationMs: elapsed(startedAt, this.now),
        cache: { status: "miss" },
      },
    };
  }

  private async probe(context: SearchBackendContext): Promise<ProbeResult> {
    if (!this.probePromise) {
      this.probePromise = this.runProbe(context)
        .then((result) => {
          if (
            !result.available &&
            result.error.code !== "backend_unavailable"
          ) {
            this.probePromise = undefined;
          }
          return result;
        })
        .catch((error) => {
          this.probePromise = undefined;
          throw error;
        });
    }
    return this.probePromise;
  }

  private async runProbe(context: SearchBackendContext): Promise<ProbeResult> {
    let result: ExecResult;
    try {
      result = await this.execute("ddgr", ["--version"], {
        signal: context.signal,
        timeout: context.timeoutMs,
      });
    } catch (error) {
      if (context.signal?.aborted) throw context.signal.reason ?? error;
      const message = error instanceof Error ? error.message : String(error);
      if (/ENOENT|not found|no such file/i.test(message)) {
        return { available: false, error: missingError() };
      }
      return {
        available: false,
        error: operationalError(
          "backend_failed",
          `Unable to probe ddgr: ${message}`,
          true,
        ),
      };
    }
    if (context.signal?.aborted) {
      throw context.signal.reason ?? new Error("ddgr probe cancelled");
    }
    if (result.killed) {
      return {
        available: false,
        error: operationalError(
          "timeout",
          "ddgr version probe timed out",
          true,
        ),
      };
    }
    if (result.code === 127) return { available: false, error: missingError() };
    if (result.code !== 0) {
      return {
        available: false,
        error: operationalError(
          "backend_failed",
          `ddgr version probe exited with status ${result.code}`,
          true,
        ),
      };
    }

    const output = `${result.stdout}\n${result.stderr}`.trim();
    const version = output.match(/\b\d+(?:\.\d+)+\b/)?.[0];
    if (!version) {
      return {
        available: false,
        error: operationalError(
          "backend_failed",
          "ddgr version probe returned an unrecognized version",
          false,
        ),
      };
    }
    return { available: true, version, supportsDoubleDash: true };
  }
}
