# pi-web-search

Bounded, failure-aware web search and static-document retrieval for Pi.

## Installation

Install the public Git package globally:

```bash
pi install git:github.com/arcanemachine/pi-web-search
```

Pi clones the Git package, installs its declared JavaScript runtime dependencies, and loads the extension declared by its Pi manifest. Pi packages execute code with the user's permissions, so review the source before installing a package.

For one project only, install it locally:

```bash
pi install git:github.com/arcanemachine/pi-web-search -l
```

A global installation writes user settings under `~/.pi/agent/settings.json`. `-l` writes project settings under `.pi/settings.json`; project packages load only after the project is trusted.

To try it for one Pi invocation without saving it to settings:

```bash
pi -e git:github.com/arcanemachine/pi-web-search
```

Use these commands to inspect and manage the installation:

```bash
pi list
pi update --extensions
pi remove git:github.com/arcanemachine/pi-web-search
```

Use `-l` when removing a project-local installation. Start or restart Pi after installing a package or changing its configuration, or use `/reload` while Pi is already running.

## Dependencies at a glance

| Capability               | Requirement                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `read_url_content`       | No external executable or service; requires outbound HTTP(S).                                                             |
| `grep_url_content`       | No external executable or service; requires outbound HTTP(S).                                                             |
| `search_web` via ddgr    | `ddgr` installed separately on the `PATH` visible to Pi.                                                                  |
| `search_web` via SearXNG | A reachable SearXNG service with JSON enabled.                                                                            |
| HTML normalization       | `jsdom`, Mozilla Readability, and `node-html-markdown`, installed automatically as JavaScript package dependencies by Pi. |

You need at least one usable search backend to call `search_web`, but you do not need both. The document read and grep tools work without either search backend. This package does not install or manage ddgr or SearXNG. The default backend order is ddgr, then SearXNG.

## Choose a search backend

### ddgr only

This is the simplest service-free search setup. ddgr is an external executable that must be on the `PATH` visible to the process running Pi. It uses DuckDuckGo's HTML endpoint and can encounter transient DuckDuckGo blocking or throttling. Current upstream ddgr requires Python 3.10 or later; follow the [official installation guidance](https://github.com/jarun/ddgr) rather than relying on platform-specific commands here.

Check availability from the same environment that launches Pi:

```bash
ddgr --version
```

Configure ddgr only:

```json
{
  "pi-web-search": {
    "backends": ["ddgr"]
  }
}
```

This prevents SearXNG fallback attempts.

### SearXNG only

SearXNG is an external service that must already be installed and running; this package does not manage it. See the [official installation documentation](https://docs.searxng.org/admin/installation.html), [Search API](https://docs.searxng.org/dev/search_api.html), and [search settings](https://docs.searxng.org/admin/settings/settings_search.html#settings-search).

The package performs GET requests to `<searxngUrl>/search` with `format=json`. Enable JSON in SearXNG's settings:

```yaml
search:
  formats:
    - html
    - json
```

Installations commonly enable only HTML. Requesting an unavailable format returns HTTP 403, and many public instances disable JSON. Restart or reload SearXNG after changing its settings.

The endpoint must be reachable from the process running Pi. In a container, `127.0.0.1` refers to that container, not automatically to its host.

For the default URL, an example readiness check is:

```bash
curl -fsS \
  'http://127.0.0.1:8080/search?q=pi&format=json' \
  >/dev/null && echo "SearXNG JSON API ready"
```

If your instance uses another URL, substitute it in the check. Configure SearXNG only:

```json
{
  "pi-web-search": {
    "backends": ["searxng"],
    "searxngUrl": "http://127.0.0.1:8080"
  }
}
```

This avoids ddgr execution entirely.

### ddgr with SearXNG fallback

```json
{
  "pi-web-search": {
    "backends": ["ddgr", "searxng"],
    "searxngUrl": "http://127.0.0.1:8080"
  }
}
```

With this configuration:

1. ddgr is attempted first.
2. SearXNG is attempted only after an evidenced operational error.
3. Legitimate `no_results` does not trigger fallback.
4. Local process rate limiting does not dispatch backends.
5. Result provenance identifies attempts and the selected backend.
6. If both fail, the final backend error is returned and earlier failures appear as warnings.

## Verify the installation

Use natural Pi requests to verify each tool:

> Search the web for RFC 9110 and return three results.

This validates backend dispatch and should return bounded title, URL, and snippet results with backend provenance.

> Read `https://www.rfc-editor.org/rfc/rfc9110.html` and show the opening section.

This validates HTTP retrieval, static HTML parsing, Markdown normalization, and bounded snapshot creation.

> Find `Representation Metadata` in `https://www.rfc-editor.org/rfc/rfc9110.html`.

This validates literal matching against the normalized snapshot.

Search snippets are for discovery; read the source before citing it.

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

HTML is parsed without executing scripts and converted to Markdown. Plain text, Markdown, XML text, and JSON use native normalization. Main-mode extraction selects an explicit CSS selector or deterministically prefers `main`, `[role="main"]`, and `article`; sectioned body-only documents preserve their structured body, while weakly structured pages use best-effort Mozilla Readability extraction before falling back to the body. Full mode and selectors remain deterministic. JavaScript-dependent content is not rendered.

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

## Configuration

Configure a `pi-web-search` object in global `~/.pi/agent/settings.json` or project `.pi/settings.json`. Project properties override matching global properties, while unspecified settings retain their defaults. Configure only the overrides you intend to change. The three minimal backend examples are in [Choose a search backend](#choose-a-search-backend).

### Complete default configuration reference

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

`SEARXNG_URL` is a lower-priority compatibility fallback only when `searxngUrl` is absent from settings. `CACHE_TTL_MINUTES` is a lower-priority compatibility fallback only when `documentCacheTtlSeconds` is absent. Package settings are preferred for new configuration. No other package-specific environment configuration is used. Use `/reload` or restart Pi to apply settings changes.

## Troubleshooting

### `backend_unavailable`

This usually means ddgr is missing or is not on the `PATH` visible to Pi. Run `ddgr --version` from the environment that launches Pi, then install ddgr or remove it from the configured backend list.

### `blocked` from ddgr

DuckDuckGo can return transient blocking evidence. The known `HTTP Error 202: Accepted` response is classified as `blocked`. Do not repeatedly hammer it; wait and retry later or configure SearXNG fallback. No fixed cooldown is guaranteed.

### `fetch_failed` from SearXNG

The safe connection messages are:

- `SearXNG endpoint refused the connection`
- `SearXNG hostname could not be resolved`
- `SearXNG endpoint was unreachable`
- `SearXNG connection was reset`
- `SearXNG request failed`

Check service state, `searxngUrl`, host/container reachability, and the direct JSON API curl shown above.

### SearXNG HTTP 403 / `blocked`

HTTP 403 can mean that JSON is disabled, a reverse proxy denied the request, or access controls rejected it. Verify `json` in `search.formats` and test the direct curl; do not assume every 403 is a JSON-format problem.

### `rate_limited`

Distinguish the local process token bucket from DuckDuckGo/ddgr throttling, a SearXNG instance HTTP 429, and SearXNG engine diagnostics. Honor `retryAfterMs` when present, avoid immediate repeated calls, and inspect provenance.

### `timeout`

A backend or remote service exceeded `searchTimeoutMs`. Check service health before increasing the timeout; tune it only when the environment requires it.

### `parse_failed` from SearXNG

Possible causes include HTML instead of JSON, disabled JSON, a proxy error page, the wrong endpoint, or an unsupported payload. Test the exact `/search?...&format=json` endpoint.

### `no_results`

This is a legitimate result, not a backend failure. Fallback intentionally does not run; refine or correct the query.

### Client-rendered shell warning

Static extraction does not execute JavaScript. Use Playwright or another JavaScript-capable browser when the needed content is rendered only in the browser.

## Requirements and privacy

- [`ddgr`](https://github.com/jarun/ddgr) must be installed separately on `PATH` to use that backend. This package never bundles, downloads, or installs it.
- Direct `ddgr` use sends the query and caller network address to DuckDuckGo.
- SearXNG mediates upstream connections but can observe the query. Its default URL is `http://127.0.0.1:8080`.
- Document tools send the requested URL and caller network address to the destination server and any permitted HTTP redirects.

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
