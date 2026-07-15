import { byteLength } from "../bounds.js";
import type { DocumentSnapshot } from "./types.js";

interface DocumentCacheEntry {
  snapshot: DocumentSnapshot;
  storedAt: number;
  bytes: number;
}

export interface DocumentCacheHit {
  snapshot: DocumentSnapshot;
  ageMs: number;
  storedAt: number;
}

export class DocumentCache {
  private readonly entries = new Map<string, DocumentCacheEntry>();
  private readonly snapshotKeys = new Map<string, string>();
  private totalBytes = 0;

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly maxBytes: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): DocumentCacheHit | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    return this.use(key, entry);
  }

  getBySnapshotId(snapshotId: string): DocumentCacheHit | undefined {
    const key = this.snapshotKeys.get(snapshotId);
    if (!key) return undefined;
    const entry = this.entries.get(key);
    if (!entry || entry.snapshot.id !== snapshotId) {
      this.snapshotKeys.delete(snapshotId);
      return undefined;
    }
    return this.use(key, entry);
  }

  set(key: string, snapshot: DocumentSnapshot): number | undefined {
    const indexBytes = snapshot.lines.reduce(
      (total, line) => total + 40 + byteLength(line.heading ?? ""),
      0,
    );
    const metadataBytes = byteLength(
      JSON.stringify({
        requestedUrl: snapshot.requestedUrl,
        finalUrl: snapshot.finalUrl,
        contentType: snapshot.contentType,
        title: snapshot.title,
        etag: snapshot.etag,
        lastModified: snapshot.lastModified,
        warnings: snapshot.warnings,
      }),
    );
    const bytes = snapshot.normalizedBytes + indexBytes + metadataBytes;
    if (bytes > this.maxBytes) return undefined;
    const existing = this.entries.get(key);
    if (existing) this.delete(key, existing);

    const storedAt = this.now();
    const entry = { snapshot, storedAt, bytes };
    this.entries.set(key, entry);
    this.snapshotKeys.set(snapshot.id, key);
    this.totalBytes += bytes;
    while (
      this.entries.size > this.maxEntries ||
      this.totalBytes > this.maxBytes
    ) {
      const oldest = this.entries.entries().next().value as
        | [string, DocumentCacheEntry]
        | undefined;
      if (!oldest) break;
      this.delete(oldest[0], oldest[1]);
    }
    return this.entries.has(key) ? storedAt : undefined;
  }

  private use(
    key: string,
    entry: DocumentCacheEntry,
  ): DocumentCacheHit | undefined {
    const ageMs = Math.max(0, this.now() - entry.storedAt);
    if (ageMs >= this.ttlMs) {
      this.delete(key, entry);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return { snapshot: entry.snapshot, ageMs, storedAt: entry.storedAt };
  }

  private delete(key: string, entry: DocumentCacheEntry): void {
    if (!this.entries.delete(key)) return;
    if (this.snapshotKeys.get(entry.snapshot.id) === key) {
      this.snapshotKeys.delete(entry.snapshot.id);
    }
    this.totalBytes -= entry.bytes;
  }
}
