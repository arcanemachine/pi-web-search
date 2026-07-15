import { createHash } from "node:crypto";
import { byteLength, truncateUtf8 } from "../bounds.js";
import type { PiWebSearchConfig } from "../config.js";
import type { Diagnostic, OperationalError } from "../contracts.js";
import { DocumentCache } from "./cache.js";
import { fetchDocument, type DocumentFetchDependencies } from "./fetch.js";
import { normalizeDocument } from "./markdown.js";
import type {
  DocumentLine,
  DocumentOptions,
  DocumentSnapshot,
  DocumentSnapshotResult,
} from "./types.js";

const MAX_INDEX_LINES = 50_000;

interface CreatedSnapshot {
  snapshot?: DocumentSnapshot;
  error?: OperationalError;
  storedAt?: number;
}

export interface DocumentServiceDependencies extends DocumentFetchDependencies {}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function keyFor(options: DocumentOptions): string {
  return sha256(
    JSON.stringify({
      url: new URL(options.url).toString(),
      mode: options.mode,
      selector: options.selector ?? null,
    }),
  );
}

async function awaitWithSignal<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return await promise;
  if (signal.aborted) {
    throw signal.reason ?? new Error("Document operation aborted");
  }
  return await new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(signal.reason ?? new Error("Document operation aborted"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

function boundIndexedContent(content: string): {
  content: string;
  truncated: boolean;
} {
  let lines = 1;
  for (let offset = 0; offset < content.length; offset += 1) {
    if (content.charCodeAt(offset) !== 10) continue;
    lines += 1;
    if (lines > MAX_INDEX_LINES) {
      return { content: content.slice(0, offset), truncated: true };
    }
  }
  return { content, truncated: false };
}

function buildLines(content: string): DocumentLine[] {
  const values = content.split("\n");
  const lines: DocumentLine[] = [];
  const headings: string[] = [];
  let offset = 0;
  let characterOffset = 0;
  let fence: string | undefined;
  let currentHeading: string | undefined;

  for (let index = 0; index < values.length; index += 1) {
    const text = values[index];
    const fenceMatch = /^\s*(```+|~~~+)/.exec(text);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!fence) fence = marker;
      else if (fence === marker) fence = undefined;
    } else if (!fence) {
      const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(text);
      if (heading) {
        const level = heading[1].length;
        headings.length = level;
        headings[level - 1] = heading[2];
        currentHeading = headings.filter(Boolean).join(" > ");
      }
    }

    const characterLength = [...text].length;
    lines.push({
      number: index + 1,
      startOffset: offset,
      endOffset: offset + text.length,
      startCharacter: characterOffset,
      endCharacter: characterOffset + characterLength,
      ...(currentHeading ? { heading: currentHeading } : {}),
    });
    offset += text.length + (index + 1 < values.length ? 1 : 0);
    characterOffset += characterLength + (index + 1 < values.length ? 1 : 0);
  }
  return lines;
}

export class DocumentService {
  private readonly cache: DocumentCache;
  private readonly inFlight = new Map<string, Promise<CreatedSnapshot>>();

  constructor(
    private readonly config: PiWebSearchConfig,
    private readonly dependencies: DocumentServiceDependencies = {
      fetch: globalThis.fetch,
      now: Date.now,
    },
  ) {
    this.cache = new DocumentCache(
      config.documentCacheTtlSeconds * 1_000,
      config.documentCacheMaxEntries,
      config.documentCacheMaxBytes,
      dependencies.now,
    );
  }

  async getSnapshot(
    options: DocumentOptions,
    forceRefresh: boolean,
    signal?: AbortSignal,
  ): Promise<DocumentSnapshotResult> {
    const key = keyFor(options);
    if (!forceRefresh) {
      const cached = this.cache.get(key);
      if (cached) {
        return {
          snapshot: cached.snapshot,
          cache: {
            status: "hit",
            ageMs: cached.ageMs,
            storedAt: new Date(cached.storedAt).toISOString(),
          },
        };
      }
    }

    const pending = this.inFlight.get(key);
    if (pending) {
      const result = await awaitWithSignal(pending, signal);
      return {
        ...(result.snapshot ? { snapshot: result.snapshot } : {}),
        ...(result.error ? { error: result.error } : {}),
        cache: {
          status: "coalesced",
          ...(result.storedAt === undefined
            ? {}
            : { storedAt: new Date(result.storedAt).toISOString(), ageMs: 0 }),
        },
      };
    }

    const execution = this.createAndCache(key, options, signal);
    this.inFlight.set(key, execution);
    try {
      const result = await execution;
      return {
        ...(result.snapshot ? { snapshot: result.snapshot } : {}),
        ...(result.error ? { error: result.error } : {}),
        cache: {
          status: forceRefresh ? "bypassed" : "miss",
          ...(result.storedAt === undefined
            ? {}
            : { storedAt: new Date(result.storedAt).toISOString(), ageMs: 0 }),
        },
      };
    } finally {
      if (this.inFlight.get(key) === execution) this.inFlight.delete(key);
    }
  }

  getSnapshotById(snapshotId: string): DocumentSnapshotResult {
    const cached = this.cache.getBySnapshotId(snapshotId);
    if (!cached) {
      return {
        error: {
          code: "cursor_expired",
          message: "The cursor snapshot has expired or been evicted",
          retryable: false,
        },
        cache: { status: "miss" },
      };
    }
    return {
      snapshot: cached.snapshot,
      cache: {
        status: "hit",
        ageMs: cached.ageMs,
        storedAt: new Date(cached.storedAt).toISOString(),
      },
    };
  }

  private async createAndCache(
    key: string,
    options: DocumentOptions,
    signal?: AbortSignal,
  ): Promise<CreatedSnapshot> {
    const fetched = await fetchDocument(
      options.url,
      this.config.documentTimeoutMs,
      this.config.documentMaxDownloadBytes,
      signal,
      this.dependencies,
    );
    if (fetched.error) return { error: fetched.error };
    if (signal?.aborted)
      throw signal.reason ?? new Error("Document fetch aborted");

    const normalized = normalizeDocument(
      fetched.value.body,
      fetched.value.contentType,
      fetched.value.finalUrl,
      options.mode,
      options.selector,
    );
    if (normalized.error) return { error: normalized.error };
    if (signal?.aborted) {
      throw signal.reason ?? new Error("Document normalization aborted");
    }

    const bounded = truncateUtf8(
      normalized.value.content,
      this.config.documentMaxNormalizedBytes,
    );
    const indexed = boundIndexedContent(bounded.value);
    const warnings: Diagnostic[] = [
      ...fetched.value.warnings,
      ...normalized.value.warnings,
    ];
    if (bounded.truncated) {
      warnings.push({
        code: "normalized_content_truncated",
        message: `Normalized content exceeded the configured ${this.config.documentMaxNormalizedBytes}-byte snapshot limit`,
        source: "document",
      });
    }
    if (indexed.truncated) {
      warnings.push({
        code: "line_index_truncated",
        message: `Normalized content exceeded the ${MAX_INDEX_LINES}-line snapshot safety limit`,
        source: "document",
      });
    }
    const contentHash = sha256(indexed.content);
    const fetchedAt = Math.max(
      0,
      this.dependencies.now() - fetched.value.durationMs,
    );
    const snapshot: DocumentSnapshot = {
      id: sha256(`${key}:${contentHash}:${fetchedAt}`),
      key,
      requestedUrl: fetched.value.requestedUrl,
      finalUrl: fetched.value.finalUrl,
      statusCode: fetched.value.statusCode,
      contentType: fetched.value.contentType,
      ...(normalized.value.title ? { title: normalized.value.title } : {}),
      fetchedAt,
      fetchDurationMs: fetched.value.durationMs,
      downloadedBytes: fetched.value.downloadedBytes,
      normalizedBytes: byteLength(indexed.content),
      ...(fetched.value.etag ? { etag: fetched.value.etag } : {}),
      ...(fetched.value.lastModified
        ? { lastModified: fetched.value.lastModified }
        : {}),
      contentHash,
      extractor: normalized.value.extractor,
      content: indexed.content,
      characterCount: [...indexed.content].length,
      lines: buildLines(indexed.content),
      warnings,
      truncated: bounded.truncated || indexed.truncated,
    };
    const storedAt = this.cache.set(key, snapshot);
    if (storedAt === undefined) {
      snapshot.warnings.push({
        code: "snapshot_not_cached",
        message: "The normalized snapshot exceeded the configured cache budget",
        source: "document",
      });
    }
    return { snapshot, ...(storedAt === undefined ? {} : { storedAt }) };
  }
}
