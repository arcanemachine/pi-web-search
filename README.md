# pi-web-search

Bounded web search and static-document reading/matching for Pi.

## Usage

**Search:** `query: "search terms"`, with optional `limit`, `region`, `safeSearch`, `timeRange`, and `forceRefresh`.

`search_web` tries the configured backend order (default: `ddgr`, then SearXNG) and falls through only after an explicit operational error. Legitimate `no_results` and local rate limiting do not trigger fallback.

**Read URL content:** `url: "https://url"`, with optional `mode`, `selector`, `maxChars`, `cursor`, and `forceRefresh`.

**Grep URL content:** `url: "https://url"`, `query: "literal text"`, with optional context, match/character limits, case sensitivity, selector, cursor, and refresh controls.

Both document tools use the same bounded normalized snapshots. Cursors continue against the exact cached snapshot and return `cursor_expired` instead of silently refetching changed content. Static HTML is converted to Markdown; plain text, Markdown, and JSON use native normalization.

## Requirements

- [`ddgr`](https://github.com/jarun/ddgr) installed on `PATH` for direct DuckDuckGo search. Direct use exposes the query and caller network address to DuckDuckGo.
- SearXNG defaults to `http://127.0.0.1:8080`; configure `pi-web-search.searxngUrl` in Pi settings or keep using the lower-priority `SEARXNG_URL` compatibility fallback.

Search snippets support discovery; read the source before citing it.
