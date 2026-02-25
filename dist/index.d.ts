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
export default function (pi: ExtensionAPI): void;
