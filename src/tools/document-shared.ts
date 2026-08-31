import { byteLength, truncateChars } from "../bounds.js";
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

export interface ReadContentMetadata {
  source: string;
  contentType: string;
  finalUrl: string;
  start: number;
  end: number;
  total: number;
  truncated: boolean;
  nextCursor?: string;
}

function inlineMetadata(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/[\r\n]+/g, " ");
}

function longestFenceRun(value: string, marker: "`" | "~"): number {
  const pattern = marker === "`" ? /`+/g : /~+/g;
  let longest = 0;
  for (const match of value.matchAll(pattern)) {
    longest = Math.max(longest, match[0].length);
  }
  return longest;
}

function fencedSource(source: string, language?: string): string {
  const backticks = longestFenceRun(source, "`");
  const tildes = longestFenceRun(source, "~");
  const marker = backticks <= tildes ? "`" : "~";
  const fence = marker.repeat(
    Math.max(3, (marker === "`" ? backticks : tildes) + 1),
  );
  return `${fence}${language ?? ""}\n${source}\n${fence}`;
}

function renderReadSource(source: string, contentType: string): string {
  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
  if (mediaType === "application/json" || mediaType.endsWith("+json")) {
    return fencedSource(source, "json");
  }
  if (
    mediaType === "application/xml" ||
    mediaType === "text/xml" ||
    mediaType.endsWith("+xml") ||
    mediaType === "application/javascript" ||
    mediaType === "text/javascript" ||
    mediaType === "text/css" ||
    mediaType === "application/x-yaml" ||
    mediaType === "text/yaml"
  ) {
    const language = mediaType.includes("xml")
      ? "xml"
      : mediaType.includes("css")
        ? "css"
        : mediaType.includes("yaml")
          ? "yaml"
          : "text";
    return fencedSource(source, language);
  }
  if (/^[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(source)) {
    return fencedSource(source, "text");
  }
  return source;
}

export function formatReadDocumentOutcome(
  outcome: OutcomeEnvelope,
  metadata: ReadContentMetadata,
): FormattedOutcome | undefined;
export function formatReadDocumentOutcome(
  outcome: OutcomeEnvelope,
  metadata?: undefined,
): FormattedOutcome;
export function formatReadDocumentOutcome(
  outcome: OutcomeEnvelope,
  metadata?: ReadContentMetadata,
): FormattedOutcome | undefined {
  const formatted = formatDocumentOutcome(outcome);
  if (outcome.status === "error") {
    const message = inlineMetadata(
      truncateChars(outcome.error?.message ?? "Read failed", 500).value,
    );
    const code = outcome.error?.code ?? "unknown";
    return {
      ...formatted,
      content: [
        {
          type: "text",
          text: `**read_url_content failed:** ${message}\n\nError code: \`${inlineMetadata(code)}\``,
        },
      ],
    };
  }
  if (!metadata || wasFormatTruncated(formatted)) return undefined;
  const source = renderReadSource(metadata.source, metadata.contentType);
  const footer = [
    "---",
    `**Source:** ${inlineMetadata(metadata.finalUrl)}`,
    `**Range:** normalized characters ${metadata.start}-${metadata.end} of ${metadata.total}`,
    `**Truncated:** ${metadata.truncated ? "yes" : "no"}`,
    ...(metadata.nextCursor
      ? [`**Next cursor:** \`${inlineMetadata(metadata.nextCursor)}\``]
      : []),
    ...((outcome.warnings ?? []).length > 0
      ? [
          "**Warnings:**",
          ...(outcome.warnings ?? [])
            .slice(0, 5)
            .map(
              (warning) =>
                `- \`${inlineMetadata(warning.code)}\`: ${inlineMetadata(
                  truncateChars(warning.message, 300).value,
                )}`,
            ),
        ]
      : []),
  ].join("\n");
  const text = `${source}${source.endsWith("\n") ? "" : "\n\n"}${footer}`;
  if (byteLength(text) > DOCUMENT_OUTPUT_BUDGET) return undefined;
  return { ...formatted, content: [{ type: "text", text }] };
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
