import { byteLength } from "../bounds.js";
import type { OutcomeEnvelope, SearchOutcomeData } from "../contracts.js";

interface CacheEntry {
  outcome: OutcomeEnvelope<SearchOutcomeData>;
  storedAt: number;
  bytes: number;
}

export interface SearchCacheHit {
  outcome: OutcomeEnvelope<SearchOutcomeData>;
  ageMs: number;
  storedAt: number;
}

export class SearchCache {
  private readonly entries = new Map<string, CacheEntry>();
  private totalBytes = 0;

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly maxBytes: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): SearchCacheHit | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    const ageMs = Math.max(0, this.now() - entry.storedAt);
    if (ageMs >= this.ttlMs) {
      this.delete(key, entry);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return { outcome: entry.outcome, ageMs, storedAt: entry.storedAt };
  }

  set(key: string, outcome: OutcomeEnvelope<SearchOutcomeData>): void {
    const bytes = byteLength(JSON.stringify(outcome));
    if (bytes > this.maxBytes) return;
    const existing = this.entries.get(key);
    if (existing) this.delete(key, existing);

    const entry = { outcome, storedAt: this.now(), bytes };
    this.entries.set(key, entry);
    this.totalBytes += bytes;
    while (
      this.entries.size > this.maxEntries ||
      this.totalBytes > this.maxBytes
    ) {
      const oldest = this.entries.entries().next().value as
        | [string, CacheEntry]
        | undefined;
      if (!oldest) break;
      this.delete(oldest[0], oldest[1]);
    }
  }

  private delete(key: string, entry: CacheEntry): void {
    if (!this.entries.delete(key)) return;
    this.totalBytes -= entry.bytes;
  }
}
