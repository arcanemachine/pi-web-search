# pi-web-search

Bounded, failure-aware web search and static-document retrieval for Pi.

## Tools

### `search_web`

Searches the configured backend order only.

```ts
{
  query: string;
  limit?: number;
  region?: string;
  safeSearch?: "on" | "off";
  timeRange?: "day" | "week" | "month" | "year";
  forceRefresh?: boolean;
}
```

The default order is external `ddgr`, then SearXNG. The next backend is tried only after an evidenced operational error. Legitimate `no_results` and local rate limiting never trigger fallback. `forceRefresh` bypasses completed cache entries, not the limiter.

Search snippets support discovery rather than citation. Read the source before citing it.

### `read_url_content`

Fetches an HTTP(S) URL, creates a bounded normalized snapshot, and returns one stable page.

```ts
{
  url: string;
  mode?: "main" | "full";
  selector?: string;
  maxChars?: number;
  cursor?: string;
  forceRefresh?: boolean;
}
```

HTML is parsed without executing scripts and converted to Markdown. Plain text, Markdown, XML text, and JSON use native normalization. Main-mode extraction selects an explicit CSS selector or deterministically prefers `main`, `[role="main"]`, `article`, then `body`.

### `grep_url_content`

Finds literal text in the same normalized snapshots used by `read_url_content`.

```ts
{
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
```

Matches include exact bounded quotes, heading breadcrumbs, line numbers, and normalized character offsets. Overlapping context windows are coalesced. No matches return explicit `status: "no_match"`.

Document cursors are opaque, authenticated, process-local, and bound to the operation, options, position, and exact cached snapshot. Expired or evicted snapshots return `cursor_expired`; cursors never silently continue against refetched content. A cursor cannot be combined with `forceRefresh`.

## Requirements and privacy

- [`ddgr`](https://github.com/jarun/ddgr) must be installed separately on `PATH` to use that backend. This package never bundles, downloads, or installs it.
- Direct `ddgr` use sends the query and caller network address to DuckDuckGo.
- SearXNG mediates upstream connections but can observe the query. Its default URL is `http://127.0.0.1:8080`.
- Document tools send the requested URL and caller network address to the destination server and any permitted HTTP redirects.

## Configuration

Set a `pi-web-search` object in global `~/.pi/agent/settings.json` or project `.pi/settings.json`. Objects are merged by property, with project values taking precedence.

```json
{
  "pi-web-search": {
    "backends": ["ddgr", "searxng"],
    "searxngUrl": "http://127.0.0.1:8080",
    "searchTimeoutMs": 10000,
    "searchCacheTtlSeconds": 120,
    "searchRateLimitPerMinute": 10,
    "searchRateLimitBurst": 3,
    "searchMaxResults": 5,
    "searchMaxLimitResults": 10,
    "searchMaxQueryChars": 500,
    "searchMaxTitleChars": 300,
    "searchMaxUrlChars": 2048,
    "searchMaxSnippetChars": 1000,
    "searchMaxOutputBytes": 24576,
    "searchCacheMaxEntries": 100,
    "searchCacheMaxBytes": 2097152,
    "documentTimeoutMs": 15000,
    "documentCacheTtlSeconds": 300,
    "documentMaxDownloadBytes": 5242880,
    "documentMaxNormalizedBytes": 2097152,
    "documentCacheMaxEntries": 50,
    "documentCacheMaxBytes": 10485760,
    "readMaxChars": 12000,
    "readMaxLimitChars": 40000,
    "grepMaxQueryChars": 500,
    "grepMaxContextLines": 20,
    "grepMaxMatches": 20,
    "grepMaxLimitMatches": 100,
    "grepMaxChars": 12000,
    "grepMaxLimitChars": 40000
  }
}
```

The `*MaxResults`, `*MaxChars`, and corresponding `*MaxLimit*` properties configure defaults and hard caps for model-requested values. Invalid, duplicate, non-finite, negative, inconsistent, unknown, or unreasonable settings fail with a configuration error rather than being guessed.

`SEARXNG_URL` and `CACHE_TTL_MINUTES` remain lower-priority compatibility fallbacks when the corresponding settings are absent. No other environment-variable configuration is used.

## Guardrails and outcomes

- Search uses a process-local token bucket with a sustained default rate of 10 logical outbound searches per minute and a burst capacity of 3. Tokens refill continuously, so this is an average rate rather than a strict rolling-window limit. Cache hits and identical in-flight callers are exempt. Pi subagents use separate processes and therefore separate buckets.
- Search and document caches are process-local TTL/LRU caches bounded by entry count and bytes. Expected operational errors are not cached.
- Document fetches accept HTTP(S) only, reject embedded credentials, follow at most five redirects, stream at most 5 MiB by default, and enforce timeout/cancellation.
- Normalized snapshots default to a 2 MiB configured byte cap and always enforce a 50,000-line internal safety cap. Incomplete snapshots carry explicit warnings.
- Static extraction warns when a page appears to be a client-rendered shell; use Playwright or another JavaScript-capable browser in that case.
- Model-visible `content` and structured `details` are independently bounded below Pi's 50 KB/2,000-line protocol ceiling. Raw HTML, backend-native payloads, unbounded diagnostics, and full cached snapshots are never returned.

Expected outcomes use structured statuses:

- `ok`
- `no_results`
- `no_match`
- `error`

Operational errors include stable codes such as `invalid_request`, `backend_unavailable`, `rate_limited`, `timeout`, `blocked`, `fetch_failed`, `backend_failed`, `parse_failed`, and `cursor_expired`, plus retry guidance when known. Unexpected invariant failures remain protocol-level errors.

## Research workflow

When subagents are available, prefer a type suited to web research for broad, multi-page, or context-heavy investigation. For page summarization, delegate the URL and objective before fetching so that subagent owns retrieval and returns a bounded evidence report. The extension itself is deterministic and never invokes an LLM.
