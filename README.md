# pi-web-search

Bounded, failure-aware web search and static-document retrieval for Pi.

## Installation

Install the public Git package globally:

```bash
pi install git:github.com/arcanemachine/pi-web-search
```

For one project only, add `-l` to the install command. To try it for one invocation without saving it, use:

```bash
pi -e git:github.com/arcanemachine/pi-web-search
```

Pi installs the declared JavaScript dependencies and loads the extension from its package manifest. Review package source before installing an extension because it executes with the user's permissions. Use `pi list`, `pi update --extensions`, and `pi remove` to manage an installation. Reload or restart Pi after changing package settings.

## Dependencies at a glance

| Capability                                | Requirement                                                                            |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| `search_web` via `duckduckgo`             | Outbound HTTPS to DuckDuckGo's HTML search endpoint; no external executable or service |
| `search_web` via `searxng`                | A reachable SearXNG service with JSON enabled                                          |
| `search_web` via `brave`                  | A Brave Search API key in `PI_WEB_SEARCH_BRAVE_API_KEY` and outbound HTTPS             |
| `read_url_content` and `grep_url_content` | Outbound HTTP(S) to requested pages                                                    |
| HTML normalization                        | The package's declared `jsdom`, Mozilla Readability, and Markdown dependencies         |

The default order is `duckduckgo`, then `searxng`; Brave is explicit opt-in. You need at least one usable search backend to call `search_web`. No separate command, Python runtime, executable download, or postinstall step is required for DuckDuckGo search.

## Choose a search backend

### DuckDuckGo

DuckDuckGo is the default, service-free backend. The package sends a standards-compliant form POST directly to `https://html.duckduckgo.com/html`, parses ordered HTML results, and returns bounded title, URL, and snippet fields. Region, safe-search, and recency options are mapped to the endpoint request. DuckDuckGo may transiently block or rate-limit automated requests; those responses are classified as retryable operational outcomes.

Configure DuckDuckGo only:

```json
{
  "pi-web-search": {
    "backends": ["duckduckgo"]
  }
}
```

### SearXNG only

SearXNG is an external service that this package does not install or manage. The package requests `<searxngUrl>/search` with `format=json`. Enable JSON in SearXNG settings:

```yaml
search:
  formats:
    - html
    - json
```

Configure it only:

```json
{
  "pi-web-search": {
    "backends": ["searxng"],
    "searxngUrl": "http://127.0.0.1:8080"
  }
}
```

The endpoint must be reachable from the process running Pi. In a container, `127.0.0.1` refers to that container. Public instances may disable JSON or apply access controls.

### Brave only

Brave is an explicit opt-in backend. Export the subscription key in the environment of the process running Pi:

```bash
export PI_WEB_SEARCH_BRAVE_API_KEY='your-subscription-token'
```

The key is environment-only and is never accepted in package JSON settings or returned in model-visible output. Review Brave's current API terms, quota, pricing, and retention practices before use.

```json
{
  "pi-web-search": {
    "backends": ["brave"]
  }
}
```

### DuckDuckGo with SearXNG fallback

```json
{
  "pi-web-search": {
    "backends": ["duckduckgo", "searxng"],
    "searxngUrl": "http://127.0.0.1:8080"
  }
}
```

With this configuration, DuckDuckGo is attempted first and SearXNG is attempted only after an operational error. Legitimate `no_results`, cache hits, and local rate limiting do not trigger fallback. Provenance records attempts and the selected backend.

## Tools

### `search_web`

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

Searches the configured backend order. `limit` is bounded by configuration and applies to one initial DuckDuckGo page; the backend does not paginate. `forceRefresh` bypasses completed cache entries, not the process-local limiter. Search snippets are discovery aids; read sources before citing them.

### `read_url_content`

Fetches an HTTP(S) URL, parses static HTML without executing scripts, and returns a bounded normalized snapshot. Plain text, Markdown, XML text, and JSON use deterministic native normalization. Main mode prefers an explicit selector, `main`, `[role="main"]`, and `article`; full mode and selectors remain deterministic. JavaScript-rendered content is not fetched by a browser.

### `grep_url_content`

Finds literal text in the same normalized snapshots used by `read_url_content`. Matches include bounded quotes, line numbers, normalized offsets, and heading breadcrumbs. No matches return `status: "no_match"`.

## Configuration

Configure a `pi-web-search` object in global `~/.pi/agent/settings.json` or project `.pi/settings.json`. Project properties override matching global properties.

```json
{
  "pi-web-search": {
    "backends": ["duckduckgo", "searxng"],
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

The `*MaxResults`, `*MaxChars`, and corresponding `*MaxLimit*` properties configure defaults and hard caps. Invalid, duplicate, non-finite, negative, inconsistent, unknown, or unreasonable settings fail with a configuration error. `SEARXNG_URL` remains a lower-priority fallback when `searxngUrl` is absent, and `CACHE_TTL_MINUTES` remains a lower-priority fallback for document cache TTL. Use `/reload` or restart Pi to apply settings changes.

## Troubleshooting

### `blocked`

DuckDuckGo can return HTTP 202 or 403, dedicated challenge pages, or other narrowly recognized blocking evidence. Brave HTTP 403 and SearXNG access denials are also classified as blocked. Wait, use the configured fallback, or try a later search; do not repeatedly retry a blocked service.

### `rate_limited`

This can come from the local process token bucket, DuckDuckGo HTTP 429, SearXNG engine diagnostics or HTTP 429, or Brave HTTP 429. Honor `error.retryAfterMs` when supplied and avoid immediate repeated calls.

### `fetch_failed`

Check outbound network access, DNS, and service health. Errors expose stable safe messages rather than raw URLs, thrown details, or nested error objects.

### `timeout`

A backend or remote service exceeded `searchTimeoutMs`; the timeout covers both response fetching and body reading. Check service health before increasing it.

### `parse_failed`

DuckDuckGo responses must be recognizable HTML search pages. Incompatible content types, malformed result containers, unsafe destinations, unrelated pages, and responses over 2 MiB are rejected. SearXNG JSON and Brave JSON have equivalent bounded parsing checks.

### `no_results`

This is a legitimate empty search and does not trigger fallback. Refine or correct the query.

Static document extraction does not execute JavaScript. Use a JavaScript-capable browser separately when a page's needed content is rendered only in the browser.

## Requirements, privacy, and limitations

- DuckDuckGo search requires no separate command or Python installation. It sends the query and caller network information directly to DuckDuckGo over HTTPS.
- SearXNG can observe queries and mediates upstream connections. Its default URL is `http://127.0.0.1:8080`.
- Brave receives the query and network information needed to provide API results. The API key is read only from `PI_WEB_SEARCH_BRAVE_API_KEY`.
- Document tools send requested URLs and caller network information to destination servers and permitted HTTP redirects.
- Search responses are parsed as one initial HTML page. Pagination, instant answers, news-specific modes, interactive prompts, and browser rendering are outside this package.
- HTML endpoint availability and transient blocking are not guaranteed. Configure SearXNG or Brave as an operational fallback when reliability requirements call for it.

## Guardrails and outcomes

Search uses a process-local token bucket with a sustained default rate of 10 logical outbound searches per minute and burst capacity of 3. Cache hits and identical in-flight callers are exempt. Search and document caches are process-local TTL/LRU caches bounded by entry count and bytes; expected operational errors are not cached.

Document fetches accept HTTP(S) only, reject embedded credentials, follow at most five redirects, stream at most 5 MiB by default, and enforce timeout and cancellation. Model-visible content and structured details are independently bounded below Pi's protocol limits. Raw HTML, backend-native payloads, and unbounded diagnostics are never returned.

Expected outcomes use structured statuses:

- `ok`
- `no_results`
- `no_match`
- `error`

Operational errors include stable codes such as `invalid_request`, `backend_unavailable`, `rate_limited`, `timeout`, `blocked`, `fetch_failed`, `backend_failed`, `parse_failed`, and `cursor_expired`, with retry guidance when known.

## Research workflow

When subagents are available, prefer a suitable research subagent for broad, multi-page, or context-heavy investigation. For page summarization, delegate the URL and objective before fetching so the subagent owns retrieval and returns a bounded evidence report. The extension itself is deterministic and never invokes an LLM.
