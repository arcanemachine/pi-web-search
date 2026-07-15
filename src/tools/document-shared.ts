import { truncateChars } from "../bounds.js";
import type {
  CacheState,
  Diagnostic,
  OutcomeEnvelope,
  Provenance,
} from "../contracts.js";
import type { PiWebSearchConfig } from "../config.js";
import type { CursorService } from "../documents/cursor.js";
import type { DocumentService } from "../documents/service.js";
import type { DocumentSnapshot } from "../documents/types.js";
import { formatOutcome, type FormattedOutcome } from "../format.js";

export interface DocumentToolRuntime {
  config: PiWebSearchConfig;
  service: DocumentService;
  cursors: CursorService;
}

export const DOCUMENT_OUTPUT_BUDGET = 48 * 1_024;

export function boundedDocumentWarnings(
  warnings: readonly Diagnostic[],
): Diagnostic[] {
  return warnings.slice(0, 10).map((warning) => ({
    code: truncateChars(warning.code, 100).value,
    message: truncateChars(warning.message, 500).value,
    source: warning.source,
  }));
}

export function documentProvenance(
  snapshot: DocumentSnapshot,
  cache: CacheState,
): Provenance {
  return {
    requestedUrl: truncateChars(snapshot.requestedUrl, 2_048).value,
    finalUrl: truncateChars(snapshot.finalUrl, 2_048).value,
    fetchedAt: new Date(snapshot.fetchedAt).toISOString(),
    durationMs: snapshot.fetchDurationMs,
    cache,
    contentHash: snapshot.contentHash,
    statusCode: snapshot.statusCode,
    contentType: truncateChars(snapshot.contentType, 300).value,
    downloadedBytes: snapshot.downloadedBytes,
    normalizedBytes: snapshot.normalizedBytes,
    ...(snapshot.etag ? { etag: truncateChars(snapshot.etag, 300).value } : {}),
    ...(snapshot.lastModified
      ? { lastModified: truncateChars(snapshot.lastModified, 300).value }
      : {}),
    extractor: snapshot.extractor,
  };
}

export function formatDocumentOutcome(
  outcome: OutcomeEnvelope,
): FormattedOutcome {
  return formatOutcome(outcome, {
    maxContentBytes: DOCUMENT_OUTPUT_BUDGET,
    maxDetailsBytes: DOCUMENT_OUTPUT_BUDGET,
    maxArrayItems: 150,
    maxStringBytes: 40_000,
  });
}

export function wasFormatTruncated(formatted: FormattedOutcome): boolean {
  const format = formatted.details.format;
  return (
    format !== null &&
    typeof format === "object" &&
    !Array.isArray(format) &&
    format.truncated === true
  );
}

export function clampWarning(
  property: string,
  requested: number,
  clamped: number,
): Diagnostic | undefined {
  if (requested <= clamped) return undefined;
  return {
    code: "limit_clamped",
    message: `${property}=${requested} was clamped to ${clamped}`,
    source: "local",
  };
}
