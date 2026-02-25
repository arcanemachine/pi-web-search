/**
 * Web Search Extension
 *
 * Provides a /search tool to search the web, and /grep_url_content to search
 * for specific content within a web page. Requires SearXNG to be running
 * (default: http://127.0.0.1:8080)
 *
 * Usage:
 * - /search: Search the web using SearXNG
 * - /grep_url_content: Fetch a URL and grep for specific content
 * - Set SEARXNG_URL environment variable if your SearXNG instance is at a different URL
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const GrepUrlContentParams = Type.Object({
  url: Type.String({ description: "The URL to fetch" }),
  query: Type.String({ description: "The search query to grep for" }),
});

export default function(pi: ExtensionAPI) {
  pi.registerTool({
    name: "grep_url_content",
    label: "Grep URL Content",
    description: "Fetch a web page and grep for specific content, returning matching lines with 2 lines of context before and after each match",
    parameters: GrepUrlContentParams,

    async execute(_toolCallId, params, _onUpdate, _ctx, _signal) {
      const url = params.url as string;
      const query = params.query as string;

      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; pi-agent/1.0)" },
      });

      if (!res.ok) {
        throw new Error(`Failed to load page: ${res.status} ${res.statusText}`);
      }

      const contentType = res.headers.get("content-type") || "";
      
      // Handle HTML pages
      if (contentType.includes("text/html") || url.endsWith(".html")) {
        const html = await res.text();
        let text = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\n\s*\n/g, "\n\n");
        
        return { content: [{ type: "text" as const, text: grepWithContext(text, query) }], details: { url, query } };
      }
      
      // Handle plain text or other content types directly
      const textContent = await res.text();
      return { content: [{ type: "text" as const, text: grepWithContext(textContent, query) }], details: { url, query } };
    },
  });
}

function grepWithContext(text: string, query: string): string {
  const lines = text.split("\n");
  const contextLines = 2;
  const matches: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(query.toLowerCase())) {
      const start = Math.max(0, i - contextLines);
      const end = Math.min(lines.length, i + contextLines + 1);
      for (let j = start; j < end; j++) {
        matches.push(lines[j]);
      }
    }
  }
  
  return matches.join("\n");
}
