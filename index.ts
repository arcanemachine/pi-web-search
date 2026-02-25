/**
 * Web Search Extension
 *
 * Provides a /search tool to search the web.
 * Requires SearXNG to be running (default: http://127.0.0.1:8080)
 *
 * Usage:
 * - The tool is automatically available after loading this extension
 * - Set SEARXNG_URL environment variable if your SearXNG instance is at a different URL
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function(pi: ExtensionAPI) {
  pi.registerTool({
    name: "search",
    label: "Search",
    description: "Search the web for information",
    parameters: {
      type: "object" as const,
      properties: {
        query: { type: "string" as const, description: "Search query" },
      },
    },

    async execute(_toolCallId, params, _onUpdate, _ctx, _signal) {
      const query = params.query as string;

      const searxngUrl = process.env.SEARXNG_URL ?? "http://127.0.0.1:8080";
      const url = `${searxngUrl}/search?q=${encodeURIComponent(query)}&format=json&categories=general`;
      const res = await fetch(url);

      if (!res.ok) {
        throw new Error(`SearXNG error: ${res.status} ${res.statusText}`);
      }

      const data = await res.json();
      const results = (data.results ?? [])
        .slice(0, 10)
        .map((r: any, i: number) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.content ?? ""}`)
        .join("\n\n");

      return {
        content: [{ type: "text" as const, text: results || "No results found." }],
        details: { query },
      };
    },
  });
}
