export const OPERATIONAL_ERROR_CODES = [
  "invalid_request",
  "backend_unavailable",
  "rate_limited",
  "timeout",
  "blocked",
  "fetch_failed",
  "backend_failed",
  "parse_failed",
  "cursor_expired",
] as const;

export type OperationalErrorCode = (typeof OPERATIONAL_ERROR_CODES)[number];
export type ToolOperation =
  "search_web" | "read_url_content" | "grep_url_content";
export type OutcomeStatus = "ok" | "no_results" | "no_match" | "error";
export type SearchBackendName = "duckduckgo" | "searxng" | "brave";
export type CacheStatus = "miss" | "hit" | "coalesced" | "bypassed";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface OperationalError {
  code: OperationalErrorCode;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
}

export interface Diagnostic {
  code: string;
  message: string;
  source?: SearchBackendName | "local" | "document";
}

export interface BackendAttempt {
  backend: SearchBackendName;
  status: OutcomeStatus;
  durationMs: number;
  errorCode?: OperationalErrorCode;
}

export interface CacheState {
  status: CacheStatus;
  ageMs?: number;
  storedAt?: string;
}

export interface Provenance {
  backend?: SearchBackendName;
  attempts?: BackendAttempt[];
  requestedUrl?: string;
  finalUrl?: string;
  fetchedAt?: string;
  durationMs?: number;
  cache?: CacheState;
  contentHash?: string;
  statusCode?: number;
  contentType?: string;
  downloadedBytes?: number;
  normalizedBytes?: number;
  etag?: string;
  lastModified?: string;
  extractor?: string;
}

export interface BoundState {
  truncated: boolean;
  returnedItems?: number;
  totalItems?: number;
  returnedChars?: number;
  totalChars?: number;
  maxBytes?: number;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  engine?: string;
}

export interface SearchOutcomeData {
  query: string;
  results: SearchResult[];
}

export interface ReadOutcomeData {
  content: string;
  title?: string;
  cursor?: string;
  nextCursor?: string;
}

export interface GrepMatch {
  line: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  quoteStartOffset: number;
  quoteEndOffset: number;
  quote: string;
  matchCount: number;
  heading?: string;
}

export interface GrepOutcomeData {
  query: string;
  matches: GrepMatch[];
  totalMatches: number;
  cursor?: string;
  nextCursor?: string;
}

export interface OutcomeEnvelope<T = unknown> {
  operation: ToolOperation;
  status: OutcomeStatus;
  summary: string;
  data?: T;
  error?: OperationalError;
  warnings?: Diagnostic[];
  provenance?: Provenance;
  bounds?: BoundState;
}

export interface SearchRequest {
  query: string;
  limit?: number;
  region?: string;
  safeSearch?: "on" | "off";
  timeRange?: "day" | "week" | "month" | "year";
  forceRefresh?: boolean;
}

export interface ReadUrlContentRequest {
  url: string;
  mode?: "main" | "full";
  selector?: string;
  maxChars?: number;
  cursor?: string;
  forceRefresh?: boolean;
}

export interface GrepUrlContentRequest {
  url: string;
  query: string;
  beforeLines?: number;
  afterLines?: number;
  maxMatches?: number;
  maxChars?: number;
  caseSensitive?: boolean;
  selector?: string;
  cursor?: string;
  forceRefresh?: boolean;
}

export class InvariantError extends Error {
  readonly kind = "invariant";

  constructor(message: string) {
    super(message);
    this.name = "InvariantError";
  }
}

export function operationalError(
  code: OperationalErrorCode,
  message: string,
  retryable: boolean,
  retryAfterMs?: number,
): OperationalError {
  return {
    code,
    message,
    retryable,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  };
}

export function errorOutcome(
  operation: ToolOperation,
  error: OperationalError,
): OutcomeEnvelope {
  return {
    operation,
    status: "error",
    summary: error.message,
    error,
  };
}

export function assertNever(value: never, context: string): never {
  throw new InvariantError(`${context}: ${String(value)}`);
}
