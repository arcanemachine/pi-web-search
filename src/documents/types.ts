import type { CacheState, Diagnostic, OperationalError } from "../contracts.js";

export type DocumentMode = "main" | "full";

export interface DocumentOptions {
  url: string;
  mode: DocumentMode;
  selector?: string;
}

export function normalizeDocumentOptions(
  url: string,
  mode: DocumentMode = "main",
  selector?: string,
): DocumentOptions {
  const parsed = new URL(url);
  parsed.hash = "";
  const normalizedSelector = selector?.trim();
  return {
    url: parsed.toString(),
    mode,
    ...(normalizedSelector ? { selector: normalizedSelector } : {}),
  };
}

export interface DocumentLine {
  number: number;
  startCodeUnit: number;
  endCodeUnit: number;
  startCharacter: number;
  endCharacter: number;
  heading?: string;
}

export interface DocumentSnapshot {
  id: string;
  key: string;
  requestedUrl: string;
  finalUrl: string;
  statusCode: number;
  contentType: string;
  title?: string;
  fetchedAt: number;
  fetchDurationMs: number;
  downloadedBytes: number;
  normalizedBytes: number;
  etag?: string;
  lastModified?: string;
  contentHash: string;
  extractor: string;
  content: string;
  characterCount: number;
  lines: DocumentLine[];
  warnings: Diagnostic[];
  truncated: boolean;
}

export interface DocumentSnapshotResult {
  snapshot?: DocumentSnapshot;
  error?: OperationalError;
  cache: CacheState;
}

export interface FetchDocumentSuccess {
  requestedUrl: string;
  finalUrl: string;
  statusCode: number;
  contentType: string;
  body: string;
  downloadedBytes: number;
  etag?: string;
  lastModified?: string;
  durationMs: number;
  warnings: Diagnostic[];
}

export type FetchDocumentResult =
  | { value: FetchDocumentSuccess; error?: never }
  | { value?: never; error: OperationalError };

export interface NormalizedDocument {
  content: string;
  title?: string;
  extractor: string;
  warnings: Diagnostic[];
}
