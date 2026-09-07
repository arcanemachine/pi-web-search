# pi-web-search

<p align="center">
  <img src="https://raw.githubusercontent.com/arcanemachine/pi-web-search/main/logo.jpg" alt="pi-web-search logo" width="250" />
</p>

A [Pi](https://pi.dev) extension for bounded web search and static document tools.

No package-specific configuration is required. Web search uses native DuckDuckGo by default. SearXNG and Brave are opt-in backends; configure SearXNG after DuckDuckGo when you want fallback. The extension can read static web pages, search their extracted text, and summarize them with Pi's active model by default.

> Like this extension? See [my other Pi extensions](https://github.com/arcanemachine/pi-projects).

## Requirements

- Pi 0.84.1 or later.
- Node.js 22.19.0 or later.
- Outbound HTTP(S) access for search and document tools.
- A usable Pi model is required only for page summaries.
- No separate command or Python installation for DuckDuckGo search.

## Installation

### From GitHub

Install the public Git package globally:

```bash
pi install git:github.com/arcanemachine/pi-web-search
```

Pi clones the Git package, installs its declared JavaScript runtime dependencies, and loads the extension declared by its Pi manifest. Pi packages execute code with the user's permissions, so review the source before installing a package.

### From npm

After publication:

```bash
pi install npm:@arcanemachine/pi-web-search
```

### Project-local installation

For one project only, install it locally:

```bash
pi install git:github.com/arcanemachine/pi-web-search -l
```

A global installation writes user settings under `~/.pi/agent/settings.json`. `-l` writes project settings under `.pi/settings.json`; project packages load only after the project is trusted.

### One invocation

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

| Capability                  | Requirement                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `read_url_content`          | No external executable or service; requires outbound HTTP(S).                                                                        |
| `find_text_in_url_content`  | No external executable or service; requires outbound HTTP(S).                                                                        |
| `search_web` via DuckDuckGo | Outbound HTTPS to DuckDuckGo's HTML search endpoint; no external executable or service.                                              |
| `search_web` via SearXNG    | A reachable SearXNG service with JSON enabled.                                                                                       |
| `search_web` via Brave      | A Brave Search API subscription key in `braveApiKey` settings or `BRAVE_SEARCH_API_KEY`, and outbound HTTPS.                         |
| HTML normalization          | `jsdom`, Mozilla Readability, and `node-html-markdown`, installed automatically as JavaScript package dependencies by Pi.            |
| `summarize_url_content`     | Optional model access through the active Pi model or configured `summarizerModel`; enabled by default; disableable by configuration. |

You need at least one usable search backend to call `search_web`, but you do not need all of them. The document read and text-finding tools work without any search backend. The default backend is `duckduckgo`; SearXNG and Brave are opt-in. No separate command, Python runtime, executable download, or postinstall step is required for DuckDuckGo search.

## Choose a search backend

### DuckDuckGo only

DuckDuckGo is the default, service-free search setup. The package sends a standards-compliant form POST directly to `https://html.duckduckgo.com/html`, parses ordered HTML results, and returns bounded title, URL, and snippet fields. Region, safe-search, and recency options are mapped to the endpoint request. DuckDuckGo may transiently block or rate-limit automated requests; those responses are classified as retryable operational outcomes.

Configure DuckDuckGo only:

```json
{
  "pi-web-search": {
    "backends": ["duckduckgo"]
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

This keeps the configured backend limited to SearXNG.

### Brave only

Brave is an explicit opt-in backend. It requires a Brave Search API subscription key and sends queries over HTTPS to the fixed official endpoint. See the official [Web Search API documentation](https://api-dashboard.search.brave.com/api-reference/web/search/get), [API key management](https://api-dashboard.search.brave.com/documentation/guides/authentication), [rate-limit guidance](https://api-dashboard.search.brave.com/documentation/guides/rate-limiting), and [current pricing](https://brave.com/search/api/). Successful calls may consume quota or incur cost; verify the current pricing and account terms before use.

Configure the key in global `~/.pi/agent/settings.json` or project `.pi/settings.json`:

```json
{
  "pi-web-search": {
    "backends": ["brave"],
    "braveApiKey": "your-subscription-token"
  }
}
```

For local-only credentials, global settings are generally preferable to project settings so the key is not committed with project files. Project settings override global settings. As a lower-priority alternative, export the key in the environment of the process running Pi:

```bash
export BRAVE_SEARCH_API_KEY='your-subscription-token'
```

A configured `braveApiKey` takes precedence over `BRAVE_SEARCH_API_KEY`. Reload Pi or restart it after changing settings or the environment.

Configure Brave only:

```json
{
  "pi-web-search": {
    "backends": ["brave"]
  }
}
```

A recommended key-holder configuration uses Brave first and SearXNG as an operational fallback:

```json
{
  "pi-web-search": {
    "backends": ["brave", "searxng"],
    "searxngUrl": "http://127.0.0.1:8080"
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

With this configuration:

1. DuckDuckGo is attempted first.
2. SearXNG is attempted only after an evidenced operational error.
3. Legitimate `no_results` does not trigger fallback.
4. Local process rate limiting does not dispatch backends.
5. Result provenance identifies attempts and the selected backend.
6. If both fail, the final backend error is returned and earlier failures appear as warnings.

## Verify the installation

Use natural Pi requests to verify each tool:

> Search the web for RFC 9110 and return three results.

This validates backend dispatch and should return bounded title, URL, and snippet results with backend provenance.

If Brave is configured and you accept the possible quota or cost, you can verify it explicitly:

> Using Brave Search, find the official RFC 9110 source and return two results.

Use a narrow query and check the returned backend provenance; a successful API call may consume account quota.

> Read `https://www.rfc-editor.org/rfc/rfc9110.html` and show the opening section.

This validates HTTP retrieval, static HTML parsing, Markdown normalization, and bounded snapshot creation.

> Find `Representation Metadata` in `https://www.rfc-editor.org/rfc/rfc9110.html`.

This validates literal matching against the normalized snapshot.

Search snippets are for discovery; read the source before citing it.

## Tools

All four tools return bounded, human-readable Markdown in their model-visible `content`; machine-readable outcomes remain in the structured `details` field. In Pi's interactive UI, tool rows provide compact invocation/result previews when collapsed and the complete bounded readable result when expanded. They honor Pi's global tool-output expansion setting, so the normal Pi expand/collapse controls work without a package-specific setting.

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

The default backend is `duckduckgo`. Additional backends run only when they are explicitly listed in `backends`; the next listed backend is tried only after an evidenced operational error. Legitimate `no_results` and local rate limiting never trigger fallback. `limit` applies to one initial DuckDuckGo HTML page; the backend does not paginate. `forceRefresh` bypasses completed cache entries, not the limiter. The visible result is a numbered Markdown list of titles, URLs, snippets, backend metadata, and warnings; the structured `details` field retains the complete bounded outcome.

### `read_url_content`

Fetches an HTTP(S) URL, creates a bounded normalized snapshot, and returns one stable page. The model-visible result is human-readable Markdown: normalized HTML/Markdown is shown directly, JSON is shown in a fenced `json` block, and a compact footer shows the final source URL, character range, truncation state, continuation cursor, and concise warnings. The structured `details` field retains the bounded machine-readable outcome, provenance, and exact normalized page content.

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

HTML is parsed without executing scripts and converted to Markdown. Plain text, Markdown, XML text, and JSON use native normalization. Read errors are shown as concise Markdown with a stable error code; full bounded error details remain in `details`. Main-mode extraction selects an explicit CSS selector or deterministically prefers `main`, `[role="main"]`, and `article`; sectioned body-only documents preserve their structured body, while weakly structured pages use best-effort Mozilla Readability extraction before falling back to the body. Full mode and selectors remain deterministic. JavaScript-dependent content is not rendered.

### `summarize_url_content`

Generates a bounded objective-focused answer from one normalized static document through an isolated model request. The tool remains registered even when execution is disabled, so changing `summarizationEnabled` does not change its public schema. Summarization is enabled by default; setting it to `false` removes only this tool from Pi's active tool set and system prompt after `/reload` or restart, while direct bypass calls return an explicit disabled error.

```ts
{
  url: string;
  objective?: string;
  mode?: "main" | "full";
  selector?: string;
  forceRefresh?: boolean;
}
```

Summarization is enabled by default. `summarizerModel` optionally selects a configured `provider/model`; when it is absent, the active Pi model is used. An invalid configured model never silently falls back. Successful results identify the actual provider/model and configured thinking level when present, preserve source provenance, and return only the bounded generated answer to the parent context. The model sees a bounded initial excerpt and can inspect more of the same snapshot only through private line-read and literal-grep tools. References are best-effort rather than verified citations. Generated summaries are not cached, while normalized source snapshots retain the existing document cache behavior. The visible result presents the generated prose as Markdown with concise source/model metadata; usage accounting, generation counters, references, provenance, and bounds remain in structured `details`.

### `find_text_in_url_content`

Finds literal text in the same normalized snapshots used by `read_url_content`. The visible result is Markdown with match counts, match ranges, line ranges, headings, quoted context, continuation offsets when needed, and warnings; exact offsets and match objects remain in structured `details`.

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
  offset?: number;
  forceRefresh?: boolean;
}
```

Matches include exact bounded quotes, heading breadcrumbs, line numbers, and normalized character offsets. Surrounding context defaults to zero lines before and after each match; set `beforeLines` and `afterLines` when context is useful. Overlapping context windows are coalesced. Results include all matches by default. When the result is too large for the tool-output budget, the response is marked truncated and includes `nextOffset`; call the tool again with the same arguments and set `offset` to `nextOffset`. No matches return explicit `status: "no_match"`.

Read cursors are opaque, authenticated, process-local, and bound to the exact cached snapshot. Expired or evicted read snapshots return `cursor_expired`; read cursors never silently continue against refetched content. Text-finding continuation uses a simple zero-based match offset because snapshot expiry and page changes are acceptable edge cases.

## Configuration

Configure a `pi-web-search` object in global `~/.pi/agent/settings.json` or project `.pi/settings.json`. Project properties override matching global properties, while unspecified settings retain their defaults. Configure only the overrides you intend to change. The three minimal backend examples are in [Choose a search backend](#choose-a-search-backend).

### Complete configuration reference

```json
{
  "pi-web-search": {
    "backends": ["duckduckgo"],
    "searxngUrl": "http://127.0.0.1:8080",
    "braveApiKey": "your-subscription-token",
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
    "grepMaxMatches": 1000,
    "grepMaxLimitMatches": 1000,
    "grepMaxChars": 40000,
    "grepMaxLimitChars": 40000,
    "summarizationEnabled": true,
    "summarizerModel": "provider/model",
    "summarizerThinkingLevel": "low"
  }
}
```

The `*MaxResults`, `*MaxChars`, and corresponding `*MaxLimit*` properties configure defaults and hard caps for model-requested values. Text-finding defaults are intentionally high so ordinary queries return every match; pathological results are bounded and expose a `nextOffset` continuation hint. Summarization is enabled by default. Set `summarizationEnabled` to `false` to disable execution and remove only `summarize_url_content` from Pi's active tool set and system prompt after reload; its registered definition remains available. `summarizerModel` is optional and uses `provider/model` syntax. When absent, summarization uses the active Pi model. `summarizerThinkingLevel` is optional and accepts `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. When omitted, provider defaults apply and the parent thinking level is not inherited. For the supported OpenAI direct-completion APIs (`openai-codex-responses`, `openai-responses`, `azure-openai-responses`, and `openai-completions`), the configured level is passed as `reasoningEffort`; `off` maps to `none` for Codex. Unsupported APIs and non-reasoning models fail before dispatch instead of silently ignoring an explicit level. Invalid, duplicate, non-finite, negative, inconsistent, unknown, or unreasonable settings fail with a configuration error rather than being guessed.

A readable explicit summarizer setup is:

```json
{
  "pi-web-search": {
    "summarizationEnabled": true,
    "summarizerModel": "openai-codex/gpt-5.6-luna",
    "summarizerThinkingLevel": "low"
  }
}
```

`SEARXNG_URL` is a lower-priority compatibility fallback only when `searxngUrl` is absent from settings. `CACHE_TTL_MINUTES` is a lower-priority compatibility fallback only when `documentCacheTtlSeconds` is absent. `BRAVE_SEARCH_API_KEY` is a lower-priority fallback only when `braveApiKey` is absent from settings. Package settings are preferred for new configuration. No other package-specific environment configuration is used. Use `/reload` or restart Pi to apply settings changes.

## Troubleshooting

### `backend_unavailable`

For Brave, this usually means `braveApiKey` and `BRAVE_SEARCH_API_KEY` are both missing or blank. Configure the key in settings or export it in the environment visible to Pi, then reload or restart Pi. A 401 means Brave rejected the subscription token; check the key in the official Brave account console.

### `blocked` from DuckDuckGo or Brave

DuckDuckGo can return transient blocking evidence. DuckDuckGo HTTP 202 or 403 responses, dedicated challenge pages, and other narrowly recognized blocking evidence are classified as `blocked`. Brave HTTP 403 is also classified as `blocked`; check account permissions and service terms. Do not repeatedly hammer either service; wait or configure another backend. No fixed cooldown is guaranteed.

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

Distinguish the local process token bucket from DuckDuckGo HTTP 429 throttling, a SearXNG instance HTTP 429, SearXNG engine diagnostics, and Brave HTTP 429. Brave rate limits include `retryAfterMs` when the response supplies usable reset information. Honor `retryAfterMs` when present, avoid immediate repeated calls, and inspect provenance.

### `timeout`

A backend or remote service exceeded `searchTimeoutMs`. For DuckDuckGo, the timeout covers response fetching and body reading. Check service health before increasing it; tune it only when the environment requires it.

Brave query limits are also backend-local: queries over 400 Unicode characters or 50 whitespace-delimited words return `invalid_request` without truncation. A later configured backend may still be attempted.

### Brave quota, billing, or HTTP 422

Brave HTTP 422 means the API rejected the request parameters; check the query limits and current API documentation. Review your account's quota and billing terms in the official Brave console and pricing page before enabling this backend for repeated searches.

### `parse_failed`

DuckDuckGo responses must be recognizable HTML search pages. Incompatible content types, malformed result containers, unsafe destinations, unrelated pages, and responses over 2 MiB are rejected.

For SearXNG, possible causes include HTML instead of JSON, disabled JSON, a proxy error page, the wrong endpoint, or an unsupported payload. Test the exact `/search?...&format=json` endpoint.

### `no_results`

This is a legitimate result, not a backend failure. Fallback intentionally does not run; refine or correct the query.

### Client-rendered shell warning

Static extraction does not execute JavaScript. Use Playwright or another JavaScript-capable browser when the needed content is rendered only in the browser.

## Privacy and limitations

- DuckDuckGo search requires no separate command or Python installation. It sends the query and caller network address directly to DuckDuckGo over HTTPS.
- SearXNG mediates upstream connections but can observe the query. Its default URL is `http://127.0.0.1:8080`.
- Brave receives the query and network information needed to provide API results. Review Brave's current API terms and retention practices; ordinary plans should not be assumed to provide zero-data retention.
- The Brave subscription key may be read from `braveApiKey` settings or the lower-priority `BRAVE_SEARCH_API_KEY` environment fallback, and is not included in model-visible output. Search results may be cached locally without the key.
- Document tools send the requested URL and caller network address to the destination server and any permitted HTTP redirects.
- Enabled summarization sends the normalized source content and objective to the selected model provider. Provider costs, retention, and privacy terms apply; review those terms before use. The actual provider/model is shown in successful output.
- Summarization does not create a generated-summary cache. The source snapshot may be bounded or truncated, and references are best-effort rather than verified citations.

## Guardrails and outcomes

- Search uses a process-local token bucket with a sustained default rate of 10 logical outbound searches per minute and a burst capacity of 3. Tokens refill continuously, so this is an average rate rather than a strict rolling-window limit. Cache hits and identical in-flight callers are exempt. Pi subagents use separate processes and therefore separate buckets.
- Search and document caches are process-local TTL/LRU caches bounded by entry count and bytes. Expected operational errors are not cached.
- Document fetches accept HTTP(S) only, reject embedded credentials, follow at most five redirects, stream at most 5 MiB by default, and enforce timeout/cancellation.
- Normalized snapshots default to a 2 MiB configured byte cap and always enforce a 50,000-line internal safety cap. Incomplete snapshots carry explicit warnings.
- Static extraction warns when a page appears to be a client-rendered shell; use Playwright or another JavaScript-capable browser in that case.
- Model-visible `content` and structured `details` are independently bounded below Pi's 50 KB/2,000-line protocol ceiling. Raw HTML, backend-native payloads, unbounded diagnostics, full cached snapshots, and nested summarizer messages are never returned to the parent.
- Summarization fails explicitly after bounded invalid or incomplete model behavior; it never presents partial generated prose as a successful summary.

Expected outcomes use structured statuses:

- `ok`
- `no_results`
- `no_match`
- `error`

Operational errors include stable codes such as `invalid_request`, `backend_unavailable`, `rate_limited`, `timeout`, `blocked`, `fetch_failed`, `backend_failed`, `parse_failed`, and `cursor_expired`, plus retry guidance when known. Unexpected invariant failures remain protocol-level errors.

## Research workflow

Search results are discovery aids; inspect a relevant source before relying on them. Use `summarize_url_content` for a focused explanation of one static page. Use `read_url_content` for exact text, quotations, code, commands, or deliberate pagination. Use `find_text_in_url_content` for targeted literal evidence. For broad, multi-page, or cross-source research, delegate to a suitable research subagent when available. Search, read, and text-finding stay deterministic; summarization is model-generated and isolated.

## Development

```bash
npm install
npm run format:check
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

The package is loaded from its TypeScript entrypoint. It does not need a compiled runtime artifact.

## License

MIT. See [LICENSE.md](./LICENSE.md).
