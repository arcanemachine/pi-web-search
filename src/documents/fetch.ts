import { createAbortScope } from "../abort.js";
import { truncateChars } from "../bounds.js";
import { operationalError } from "../contracts.js";
import type { FetchDocumentResult } from "./types.js";

const MAX_REDIRECTS = 5;
const USER_AGENT = "Mozilla/5.0 (compatible; pi-web-search/1.0)";

export interface DocumentFetchDependencies {
  fetch: typeof globalThis.fetch;
  now(): number;
}

const DEFAULT_DEPENDENCIES: DocumentFetchDependencies = {
  fetch: globalThis.fetch,
  now: Date.now,
};

function validateUrl(value: string): URL | undefined {
  try {
    if (value.length > 2_048) return undefined;
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.username || url.password) return undefined;
    if (url.toString().length > 2_048) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

function retryAfterMs(response: Response, now: number): number | undefined {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1_000);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(0, timestamp - now);
}

function httpError(response: Response, now: number) {
  const status = response.status;
  const statusText = truncateChars(response.statusText, 100).value;
  const message = `Document fetch returned HTTP ${status}${statusText ? ` ${statusText}` : ""}`;
  if (status === 429) {
    return operationalError(
      "rate_limited",
      message,
      true,
      retryAfterMs(response, now),
    );
  }
  if (status === 401 || status === 403 || status === 451) {
    return operationalError("blocked", message, false);
  }
  return operationalError("fetch_failed", message, status >= 500);
}

function charset(contentType: string): string {
  const match = /(?:^|;)\s*charset\s*=\s*["']?([^;"']+)/i.exec(contentType);
  return match?.[1]?.trim() || "utf-8";
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<
  | { bytes: Uint8Array; error?: never }
  | { bytes?: never; error: ReturnType<typeof operationalError> }
> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    return {
      error: operationalError(
        "fetch_failed",
        `Document exceeds the configured ${maxBytes}-byte download limit`,
        false,
      ),
    };
  }

  if (!response.body) return { bytes: new Uint8Array() };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      received += item.value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return {
          error: operationalError(
            "fetch_failed",
            `Document exceeds the configured ${maxBytes}-byte download limit`,
            false,
          ),
        };
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes };
}

export async function fetchDocument(
  requestedUrl: string,
  timeoutMs: number,
  maxBytes: number,
  signal?: AbortSignal,
  dependencies: DocumentFetchDependencies = DEFAULT_DEPENDENCIES,
): Promise<FetchDocumentResult> {
  const initialUrl = validateUrl(requestedUrl);
  if (!initialUrl) {
    return {
      error: operationalError(
        "invalid_request",
        "url must be an HTTP(S) URL without embedded credentials",
        false,
      ),
    };
  }

  const startedAt = dependencies.now();
  const scope = createAbortScope(signal, timeoutMs);
  let currentUrl = initialUrl;
  try {
    for (
      let redirectCount = 0;
      redirectCount <= MAX_REDIRECTS;
      redirectCount += 1
    ) {
      let response: Response;
      try {
        response = await dependencies.fetch(currentUrl, {
          redirect: "manual",
          headers: {
            "User-Agent": USER_AGENT,
            Accept:
              "text/html,text/plain,text/markdown,application/json;q=0.9,*/*;q=0.1",
          },
          signal: scope.signal,
        });
      } catch (error) {
        if (signal?.aborted) throw signal.reason ?? error;
        if (scope.signal.aborted) {
          return {
            error: operationalError(
              "timeout",
              `Document fetch timed out after ${timeoutMs}ms`,
              true,
            ),
          };
        }
        const message = error instanceof Error ? error.message : String(error);
        return {
          error: operationalError(
            "fetch_failed",
            `Document fetch failed: ${truncateChars(message, 300).value}`,
            true,
          ),
        };
      }

      if (
        response.status >= 300 &&
        response.status < 400 &&
        response.status !== 304
      ) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
        if (!location) {
          return {
            error: operationalError(
              "fetch_failed",
              `HTTP ${response.status} redirect omitted the Location header`,
              false,
            ),
          };
        }
        if (redirectCount === MAX_REDIRECTS) {
          return {
            error: operationalError(
              "fetch_failed",
              `Document exceeded the ${MAX_REDIRECTS}-redirect limit`,
              false,
            ),
          };
        }
        let redirectedUrl: string;
        try {
          redirectedUrl = new URL(location, currentUrl).toString();
        } catch {
          return {
            error: operationalError(
              "fetch_failed",
              "Document redirect contained an invalid Location URL",
              false,
            ),
          };
        }
        const nextUrl = validateUrl(redirectedUrl);
        if (!nextUrl) {
          return {
            error: operationalError(
              "fetch_failed",
              "Document redirect targeted an unsupported or credentialed URL",
              false,
            ),
          };
        }
        currentUrl = nextUrl;
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return { error: httpError(response, dependencies.now()) };
      }

      let bodyResult: Awaited<ReturnType<typeof readBoundedBody>>;
      try {
        bodyResult = await readBoundedBody(response, maxBytes);
      } catch (error) {
        if (signal?.aborted) throw signal.reason ?? error;
        if (scope.signal.aborted) {
          return {
            error: operationalError(
              "timeout",
              `Document fetch timed out after ${timeoutMs}ms`,
              true,
            ),
          };
        }
        const message = error instanceof Error ? error.message : String(error);
        return {
          error: operationalError(
            "fetch_failed",
            `Document body read failed: ${truncateChars(message, 300).value}`,
            true,
          ),
        };
      }
      if (bodyResult.error) return { error: bodyResult.error };

      const contentType = truncateChars(
        response.headers.get("content-type")?.trim() ||
          "application/octet-stream",
        300,
      ).value;
      let body: string;
      const warnings = [];
      try {
        body = new TextDecoder(charset(contentType)).decode(bodyResult.bytes);
      } catch {
        body = new TextDecoder("utf-8").decode(bodyResult.bytes);
        warnings.push({
          code: "charset_fallback",
          message: "Unsupported response charset; decoded as UTF-8",
          source: "document" as const,
        });
      }

      return {
        value: {
          requestedUrl: initialUrl.toString(),
          finalUrl: currentUrl.toString(),
          statusCode: response.status,
          contentType,
          body,
          downloadedBytes: bodyResult.bytes.byteLength,
          ...(response.headers.get("etag")
            ? {
                etag: truncateChars(response.headers.get("etag") ?? "", 300)
                  .value,
              }
            : {}),
          ...(response.headers.get("last-modified")
            ? {
                lastModified: truncateChars(
                  response.headers.get("last-modified") ?? "",
                  300,
                ).value,
              }
            : {}),
          durationMs: Math.max(0, dependencies.now() - startedAt),
          warnings,
        },
      };
    }

    return {
      error: operationalError(
        "fetch_failed",
        "Document redirect failed",
        false,
      ),
    };
  } finally {
    scope.cleanup();
  }
}
