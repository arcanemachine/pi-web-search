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

### Node version managers and package installation

`pi install` clones a Git package into Pi's managed package directory and runs `npm` from that checkout. A Node version selected only by the current project's local `.tool-versions` can stop applying when npm runs in the managed checkout. With asdf, this can produce `No version is set for nodejs` and npm exit code 126 even though Pi started successfully from the original project. This is an environment and toolchain-selection issue, not a `pi-web-search` runtime dependency failure.

Before installing, verify that both commands work from a neutral directory outside the current repository:

```bash
cd /tmp
node --version
npm --version
```

Choose a Node version compatible with your installed Pi release and local package tooling. Depending on your setup, safe remedies include:

- configure an appropriate home or global asdf Node selection using the asdf version and documentation installed on your system;
- export `ASDF_NODEJS_VERSION` in the environment that launches `pi install`;
- configure Pi's top-level `npmCommand` setting to use a stable Node/npm wrapper, as supported by Pi's package-management documentation.

For a one-time asdf selection, use an installed version as the placeholder below rather than assuming a particular Node release:

```bash
ASDF_NODEJS_VERSION=<installed-node-version> \
  pi install git:github.com/arcanemachine/pi-web-search
```

After correcting the Node selection, rerun the normal installation command above and confirm the package with `pi list`. Do not edit Pi's managed checkout, copy `node_modules`, bypass npm scripts or package security, or change this package's source to work around an environment-selection problem.

## Dependencies at a glance

| Capability               | Requirement                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `read_url_content`       | No external executable or service; requires outbound HTTP(S).                                                                        |
| `grep_url_content`       | No external executable or service; requires outbound HTTP(S).                                                                        |
| `search_web` via ddgr    | `ddgr` installed separately on the `PATH` visible to Pi.                                                                             |
| `search_web` via SearXNG | A reachable SearXNG service with JSON enabled.                                                                                       |
| `search_web` via Brave   | A Brave Search API subscription key in `PI_WEB_SEARCH_BRAVE_API_KEY` and outbound HTTPS.                                             |
| HTML normalization       | `jsdom`, Mozilla Readability, and `node-html-markdown`, installed automatically as JavaScript package dependencies by Pi.            |
| `summarize_url_content`  | Optional model access through the active Pi model or configured `summarizerModel`; enabled by default; disableable by configuration. |

You need at least one usable search backend to call `search_web`, but you do not need all of them. The document read and grep tools work without any search backend. This package does not install or manage ddgr, SearXNG, or Brave credentials. The default backend order remains ddgr, then SearXNG; Brave is explicit opt-in.

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

### Brave only

Brave is an explicit opt-in backend. It requires a Brave Search API subscription key and sends queries over HTTPS to the fixed official endpoint. See the official [Web Search API documentation](https://api-dashboard.search.brave.com/api-reference/web/search/get), [API key management](https://api-dashboard.search.brave.com/documentation/guides/authentication), [rate-limit guidance](https://api-dashboard.search.brave.com/documentation/guides/rate-limiting), and [current pricing](https://brave.com/search/api/). Successful calls may consume quota or incur cost; verify the current pricing and account terms before use.

Export the key in the environment of the process running Pi:

```bash
export PI_WEB_SEARCH_BRAVE_API_KEY='your-subscription-token'
```

The key is environment-only. A `braveApiKey` property in global or project JSON settings is rejected intentionally. Reload Pi or restart it after changing the environment.

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

The default order is external `ddgr`, then SearXNG. The next backend is tried only after an evidenced operational error. Legitimate `no_results` and local rate limiting never trigger fallback. `forceRefresh` bypasses completed cache entries, not the limiter. The visible result is a numbered Markdown list of titles, URLs, snippets, backend metadata, and warnings; the structured `details` field retains the complete bounded outcome.

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

### `grep_url_content`

Finds literal text in the same normalized snapshots used by `read_url_content`. The visible result is Markdown with match counts, line ranges, headings, quoted context, cursors, and warnings; exact offsets and match objects remain in structured `details`.

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

### Complete configuration reference

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
    "grepMaxLimitChars": 40000,
    "summarizationEnabled": true,
    "summarizerThinkingLevel": "low"
  }
}
```

The `*MaxResults`, `*MaxChars`, and corresponding `*MaxLimit*` properties configure defaults and hard caps for model-requested values. `summarizationEnabled` is true by default. Setting it to false gates execution and removes only `summarize_url_content` from Pi's active tool set/system prompt after reload; the registered definition remains available. `summarizerModel` is optional and uses `provider/model` syntax; when absent, summarization falls back to the active Pi model. `summarizerThinkingLevel` is optional and accepts `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`; when omitted, provider defaults apply and the parent thinking level is never inherited. For the verified OpenAI direct-completion APIs (`openai-codex-responses`, `openai-responses`, `azure-openai-responses`, and `openai-completions`), the configured level is passed as `reasoningEffort` (`off` maps to `none` for Codex). Unsupported APIs and non-reasoning models fail before dispatch rather than silently ignoring an explicit level. Invalid, duplicate, non-finite, negative, inconsistent, unknown, or unreasonable settings fail with a configuration error rather than being guessed.

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

`SEARXNG_URL` is a lower-priority compatibility fallback only when `searxngUrl` is absent from settings. `CACHE_TTL_MINUTES` is a lower-priority compatibility fallback only when `documentCacheTtlSeconds` is absent. `PI_WEB_SEARCH_BRAVE_API_KEY` is the environment-only exception for the Brave credential; it is not accepted in JSON settings. Package settings are preferred for new configuration. No other package-specific environment configuration is used. Use `/reload` or restart Pi to apply settings changes.

## Troubleshooting

### `backend_unavailable`

For Brave, this usually means `PI_WEB_SEARCH_BRAVE_API_KEY` is missing or blank. Export it in the environment visible to Pi and reload or restart Pi. A 401 means Brave rejected the subscription token; check the key in the official Brave account console without placing it in settings.

For ddgr, this usually means ddgr is missing or is not on the `PATH` visible to Pi. Run `ddgr --version` from the environment that launches Pi, then install ddgr or remove it from the configured backend list.

### `blocked` from ddgr or Brave

DuckDuckGo can return transient blocking evidence. The known `HTTP Error 202: Accepted` response is classified as `blocked`. Brave HTTP 403 is also classified as `blocked`; check account permissions and service terms. Do not repeatedly hammer either service; wait or configure another backend. No fixed cooldown is guaranteed.

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

Distinguish the local process token bucket from DuckDuckGo/ddgr throttling, a SearXNG instance HTTP 429, SearXNG engine diagnostics, and Brave HTTP 429. Brave rate limits include `retryAfterMs` when the response supplies usable reset information. Honor `retryAfterMs` when present, avoid immediate repeated calls, and inspect provenance.

### `timeout`

A backend or remote service exceeded `searchTimeoutMs`. Check service health before increasing the timeout; tune it only when the environment requires it.

Brave query limits are also backend-local: queries over 400 Unicode characters or 50 whitespace-delimited words return `invalid_request` without truncation. A later configured backend may still be attempted.

### Brave quota, billing, or HTTP 422

Brave HTTP 422 means the API rejected the request parameters; check the query limits and current API documentation. Review your account's quota and billing terms in the official Brave console and pricing page before enabling this backend for repeated searches.

### `parse_failed` from SearXNG

Possible causes include HTML instead of JSON, disabled JSON, a proxy error page, the wrong endpoint, or an unsupported payload. Test the exact `/search?...&format=json` endpoint.

### `no_results`

This is a legitimate result, not a backend failure. Fallback intentionally does not run; refine or correct the query.

### Client-rendered shell warning

Static extraction does not execute JavaScript. Use Playwright or another JavaScript-capable browser when the needed content is rendered only in the browser.

## Requirements and privacy

- Pi `0.84.1` or newer is required. The summarizer uses Pi's isolated `ModelRegistry.complete()` API; older Pi releases are not supported.
- [`ddgr`](https://github.com/jarun/ddgr) must be installed separately on `PATH` to use that backend. This package never bundles, downloads, or installs it.
- Direct `ddgr` use sends the query and caller network address to DuckDuckGo.
- SearXNG mediates upstream connections but can observe the query. Its default URL is `http://127.0.0.1:8080`.
- Brave receives the query and network information needed to provide API results. Review Brave's current API terms and retention practices; ordinary plans should not be assumed to provide zero-data retention.
- The Brave subscription key is read only from `PI_WEB_SEARCH_BRAVE_API_KEY`, never from settings, and is not included in model-visible output. Search results may be cached locally without the key.
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

Search results are discovery aids; inspect a relevant source before relying on it. After finding a relevant single static page, prefer `summarize_url_content` when it is available and understanding, explaining, synthesizing, or evaluating that page would help complete the task. Call it directly rather than reading the page first merely to decide whether a summary would help. Use `read_url_content` for exact source text, quotations, code, commands, precise wording, manual inspection, or deliberate pagination, and use `grep_url_content` for targeted literal evidence. When subagents are available, delegate broad, multi-page, context-heavy, or cross-source research to a suitable research subagent. The read, grep, and search tools remain deterministic, while summarization is explicitly model-generated and isolated.
