import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { createAbortScope } from "../abort.js";
import { byteLength, truncateUtf8 } from "../bounds.js";
import type { PiWebSearchConfig } from "../config.js";

const ExistingGrepParams = Type.Object({
  url: Type.String({ description: "The URL to fetch" }),
  query: Type.String({ description: "The search query to grep for" }),
  beforeLines: Type.Optional(Type.Number()),
  afterLines: Type.Optional(Type.Number()),
});

interface PageCacheEntry {
  text: string;
  timestamp: number;
  bytes: number;
}

export interface ExistingToolDependencies {
  fetch: typeof globalThis.fetch;
  now(): number;
}

const DEFAULT_DEPENDENCIES: ExistingToolDependencies = {
  fetch: globalThis.fetch,
  now: Date.now,
};

function normalizeDocument(body: string, isHtml: boolean): string {
  const withoutMarkup = isHtml
    ? body
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, "")
    : body;
  return withoutMarkup
    .replace(/\r\n?/g, "\n")
    .replace(/\n\s*\n/g, "\n\n")
    .trim();
}

function grepWithContext(
  text: string,
  query: string,
  beforeLines: number,
  afterLines: number,
): string {
  const lines = text.split("\n");
  const matches: string[] = [];
  const needle = query.toLowerCase();
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].toLowerCase().includes(needle)) continue;
    const start = Math.max(0, index - beforeLines);
    const end = Math.min(lines.length, index + afterLines + 1);
    for (let contextIndex = start; contextIndex < end; contextIndex += 1) {
      matches.push(`${contextIndex + 1}: ${lines[contextIndex]}`);
    }
  }
  return matches.join("\n") || "No matches found.";
}

export function registerExistingGrepTool(
  pi: ExtensionAPI,
  getConfig: () => PiWebSearchConfig,
  dependencies: ExistingToolDependencies = DEFAULT_DEPENDENCIES,
): void {
  const pageCache = new Map<string, PageCacheEntry>();
  let cacheBytes = 0;

  function getCached(
    url: string,
    config: PiWebSearchConfig,
  ): PageCacheEntry | undefined {
    const cached = pageCache.get(url);
    if (!cached) return undefined;
    if (
      dependencies.now() - cached.timestamp >=
      config.documentCacheTtlSeconds * 1_000
    ) {
      pageCache.delete(url);
      cacheBytes -= cached.bytes;
      return undefined;
    }
    pageCache.delete(url);
    pageCache.set(url, cached);
    return cached;
  }

  function cachePage(
    url: string,
    text: string,
    config: PiWebSearchConfig,
  ): void {
    const bounded = truncateUtf8(text, config.documentMaxNormalizedBytes).value;
    const existing = pageCache.get(url);
    if (existing) cacheBytes -= existing.bytes;
    const entry = {
      text: bounded,
      timestamp: dependencies.now(),
      bytes: byteLength(bounded),
    };
    pageCache.delete(url);
    pageCache.set(url, entry);
    cacheBytes += entry.bytes;
    while (
      pageCache.size > config.documentCacheMaxEntries ||
      cacheBytes > config.documentCacheMaxBytes
    ) {
      const oldest = pageCache.entries().next().value as
        | [string, PageCacheEntry]
        | undefined;
      if (!oldest) break;
      pageCache.delete(oldest[0]);
      cacheBytes -= oldest[1].bytes;
    }
  }

  async function fetchDocument(
    url: string,
    signal: AbortSignal | undefined,
    config: PiWebSearchConfig,
  ): Promise<{ text: string; cached: boolean }> {
    const cached = getCached(url, config);
    if (cached) return { text: cached.text, cached: true };

    const scope = createAbortScope(signal, config.documentTimeoutMs);
    try {
      const response = await dependencies.fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; pi-agent/1.0)" },
        signal: scope.signal,
      });
      if (!response.ok) {
        throw new Error(
          `Failed to load page: ${response.status} ${response.statusText}`,
        );
      }
      const body = await response.text();
      const contentType = response.headers.get("content-type") ?? "";
      const text = normalizeDocument(
        body,
        contentType.includes("text/html") || url.endsWith(".html"),
      );
      cachePage(url, text, config);
      return { text: getCached(url, config)?.text ?? text, cached: false };
    } finally {
      scope.cleanup();
    }
  }

  pi.registerTool({
    name: "grep_url_content",
    label: "Grep URL Content",
    description:
      "Fetch a web page and grep for specific content, returning matching lines with configurable context.",
    promptSnippet:
      "Fetch a page and grep matching lines; when available, prefer Playwright for dynamic pages and subagents for broader research tasks.",
    promptGuidelines: [
      "Use grep_url_content for targeted extraction from known or likely static URLs.",
      "If available, prefer Playwright-based browsing when page content depends on JavaScript rendering.",
      "If available, prefer a subagent type suited to web research for deep, multi-page investigation.",
    ],
    parameters: ExistingGrepParams,

    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const config = getConfig();
      const url = params.url as string;
      const query = params.query as string;
      const beforeLines = Math.max(
        0,
        Math.floor((params.beforeLines as number | undefined) ?? 1),
      );
      const afterLines = Math.max(
        0,
        Math.floor((params.afterLines as number | undefined) ?? 1),
      );
      const page = await fetchDocument(url, signal, config);
      const text = truncateUtf8(
        grepWithContext(page.text, query, beforeLines, afterLines),
        config.grepMaxChars,
      );
      return {
        content: [{ type: "text" as const, text: text.value }],
        details: { url, query, cached: page.cached, truncated: text.truncated },
      };
    },
  });
}
