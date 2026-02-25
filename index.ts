/**
 * Web Search Extension
 *
 * Provides a /search tool to search the web or load and extract text from a URL.
 * Requires SearXNG to be running (default: http://127.0.0.1:8080)
 *
 * Usage:
 * - The tool is automatically available after loading this extension
 * - Set SEARXNG_URL environment variable if your SearXNG instance is at a different URL
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";

export default function(pi: ExtensionAPI) {
  pi.registerTool({
    name: "search",
    label: "Search",
    description: "Search the web or load and extract text from a URL",
    parameters: {
      type: "object" as const,
      properties: {
        action: StringEnum(["search", "load"] as const),
        input: { type: "string" as const, description: "Search query or full URL" },
      },
    },

    async execute(_toolCallId, params, _onUpdate, _ctx, _signal) {
      const action = params.action as "search" | "load";
      const input = params.input as string;

      if (action === "search") {
        const searxngUrl = process.env.SEARXNG_URL ?? "http://127.0.0.1:8080";
        const url = `${searxngUrl}/search?q=${encodeURIComponent(input)}&format=json&categories=general`;
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
          details: { query: input },
        };
      } else {
        const res = await fetch(input, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; pi-agent/1.0)" },
        });

        if (!res.ok) {
          throw new Error(`Failed to load page: ${res.status} ${res.statusText}`);
        }

        const contentType = res.headers.get("content-type") || "";
        
        // Handle HTML pages
        if (contentType.includes("text/html") || input.endsWith(".html")) {
          const html = await res.text();
          const text = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\n\s*\n/g, "\n\n")
            .trim();
          
          return {
            content: [{ type: "text" as const, text: text.slice(0, 20000) }],
            details: { url: input, contentType: "html", extractedTextLength: text.length },
          };
        }
        
        // Handle plain text or other content types directly
        const textContent = await res.text();
        return {
          content: [{ type: "text" as const, text: textContent.slice(0, 20000) }],
          details: { url: input, contentType: contentType.split(";")[0] },
        };
      }
    },
  });
}
