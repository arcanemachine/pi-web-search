# Web Search Improvements Plan

Status: Approved and executable

Implementation progress: Phase 0 and Phase 1 are implemented and verified with package formatting, strict typecheck/build, 47 Node tests, package dry-run inspection, cancellation/registration smoke tests, and a no-model-call Pi RPC load. The non-persistent focused gate passed for `ddgr`: 6/6 categories succeeded, expected authoritative domains appeared within rank 3 for 6/6, and no malformed fields or obvious-spam heuristic hits appeared. The configured SearXNG produced evidence-backed `rate_limited` errors for 6/6 rather than false emptiness, so the approved default remains `ddgr,searxng`. Phase 2 has not started.

Reference: `RESEARCH.md` is the approved evidence and design baseline. Do not read or incorporate `IDEAS.DEFERRED.md` unless the user explicitly asks to revisit deferred work.

## Goal

Deliver a backend-ordered, failure-aware, rate-limited web search tool plus bounded shared static-document reading and matching tools. Completion requires verified runtime behavior in Pi, not only passing static checks.

## Approved scope

The public schemas, configurable output budgets, and focused `ddgr` evaluation gate are approved. Do not push changes unless asked.

## Public interface

### `search_web`

Purpose: search the configured backend order only.

Inputs:

```ts
{
  query: string;
  limit?: number; // configured default 5, configured hard cap 10
  region?: string;
  safeSearch?: "on" | "off"; // default "on"
  timeRange?: "day" | "week" | "month" | "year";
  forceRefresh?: boolean; // default false
}
```

Bounds (shown with approved defaults; upper values are configurable):

- query: 1..500 characters after trimming;
- title: at most 300 characters per result;
- URL: at most 2,048 characters per result;
- snippet: at most 1,000 characters per result;
- configured defaults allow at most 10 results and 24 KB of model-visible content;
- user settings may adjust defaults and hard caps, but output remains below Pi's 50 KB/2,000-line protocol ceiling;
- warnings and diagnostics are independently bounded.

### `read_url_content`

Purpose: fetch one supported URL, normalize it deterministically, and return one bounded page from a stable snapshot.

Inputs:

```ts
{
  url: string;
  mode?: "main" | "full"; // default "main"
  selector?: string;
  maxChars?: number; // configured default 12,000, configured hard cap 40,000
  cursor?: string;
  forceRefresh?: boolean; // default false; invalid with cursor
}
```

Behavior:

- return normalized Markdown for HTML and normalized native text for plain text, Markdown, and JSON;
- return source metadata, warnings, returned/total character counts, and `nextCursor` only when more content exists;
- bind cursors to the exact cached snapshot and extraction options;
- reject a cursor combined with conflicting URL/options or `forceRefresh`;
- return structured `cursor_expired` rather than silently refetching;
- apply configured default and hard-cap budgets to both `content` and `details`, always below Pi's global ceiling.

### `grep_url_content`

Purpose: find literal text in the same stable normalized snapshots used by `read_url_content`.

Inputs:

```ts
{
  url: string;
  query: string;
  beforeLines?: number; // default 1, configured hard cap 20
  afterLines?: number; // default 1, configured hard cap 20
  maxMatches?: number; // configured default 20, configured hard cap 100
  maxChars?: number; // configured default 12,000, configured hard cap 40,000
  caseSensitive?: boolean; // default false
  selector?: string;
  cursor?: string;
  forceRefresh?: boolean; // default false; invalid with cursor
}
```

Behavior:

- literal matching only in the initial implementation;
- coalesce overlapping context windows;
- return bounded exact quotes, heading breadcrumbs, normalized lines/offsets, counts, and `nextCursor` when more matches exist;
- return explicit `no_match`, never empty tool content;
- use the same cursor and output-bound rules as `read_url_content`.

### Generalized subagent nudge

Add concise `promptGuidelines` and README guidance:

- use a subagent type suited to web research, when available, for broad, multi-page, or context-heavy investigation;
- for page summarization, pass the URL and objective to that subagent before fetching so it owns retrieval and returns a bounded report;
- do not require a particular profile name or subagent implementation;
- do not invoke an LLM from the retrieval extension.

## Configuration

Follow the settings style used by sibling extensions such as `pi-read`: merge global `~/.pi/agent/settings.json` with project `.pi/settings.json`, with project values taking precedence. Use a package-scoped `pi-web-search` object and camel-case properties.

Initial defaults:

```json
{
  "pi-web-search": {
    "backends": ["ddgr", "searxng"],
    "searxngUrl": "http://127.0.0.1:8080",
    "searchTimeoutMs": 10000,
    "searchCacheTtlSeconds": 120,
    "searchMinIntervalMs": 10000,
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

Configuration behavior:

- merge global and project objects by property rather than replacing the entire object;
- refresh effective configuration on session start/reload and build tool descriptions from the effective defaults and caps;
- trim and normalize the ordered backend list;
- reject empty, unknown, duplicate, non-finite, negative, internally inconsistent, or unreasonable values with a clear configuration error;
- clamp model-requested values to the configured hard caps and state when clamping occurred;
- keep Pi's 50 KB/2,000-line output ceiling as a non-configurable final safety boundary;
- preserve the existing `SEARXNG_URL` and `CACHE_TTL_MINUTES` variables as lower-priority compatibility fallbacks when their corresponding settings are absent; do not introduce new environment-variable configuration;
- avoid logging raw queries or URLs by default.

## Phase 0 — Foundations and tests

1. Split the extension into the modules described in `RESEARCH.md` while keeping `index.ts` as a thin registrar.
2. Add shared contracts for requests, outcomes, errors, provenance, bounds, cache state, and diagnostics.
3. Add strict runtime validation for backend-native and network data; do not use `any` for external payloads.
4. Correct Pi tool signatures to `(toolCallId, params, signal, onUpdate, ctx)` and forward cancellation.
5. Add formatters that produce bounded model-visible text plus the corresponding bounded `details` object.
6. Add a small TypeScript test setup using Node's test API and `tsx` unless an equally small existing package convention is found.
7. Update `package.json` publishing files, scripts, dependencies, and `tsconfig.json` includes so the package remains independently installable.

Acceptance:

- schemas reject invalid bounds and unsupported combinations;
- every expected outcome has non-empty content;
- formatter fixtures prove both `content` and serialized `details` stay within their tool budgets;
- unexpected invariant failures remain distinguishable from structured operational errors.

## Phase 1 — Search correctness

### Ordered service

1. Load the merged `pi-web-search.backends` setting, defaulting to `["ddgr", "searxng"]`.
2. Attempt each backend at most once and only advance after an explicit operational error.
3. Stop on `ok` or legitimate `no_results`.
4. Report the backend producing the terminal outcome plus bounded preceding-attempt warnings.

### `ddgr` adapter

1. Probe `ddgr --version` on first `ddgr` use and cache the result.
2. If missing, return `backend_unavailable` with PATH guidance and <https://github.com/jarun/ddgr>.
3. Invoke with argv, never a constructed shell command:
   - `--json` for noninteractive JSON output;
   - `--num` with the bounded requested result count;
   - `--reg`, `--time`, and `--unsafe` only when required by normalized options;
   - `--` before the query argument when supported by the verified executable.
4. Do not add redundant interactive, browser, URL-expansion, reverse-order, color, or user-agent-disabling flags. In `ddgr` 2.2 the JSON path is already noninteractive and emits no color escapes.
5. Apply the extension timeout and `AbortSignal` because `ddgr` 2.2 does not set an HTTP timeout internally.
6. Inspect code, stdout, and bounded stderr together. Recognize exit-0 failure stderr before classifying `[]` as `no_results`.
7. Normalize only validated title, URL, abstract, and supported metadata.

### SearXNG adapter

1. Build URLs with the URL API and preserve `SEARXNG_URL`.
2. Apply timeout and cancellation.
3. Validate status, content type, JSON shape, results, and engine diagnostics.
4. Distinguish `no_results`, partial success with warnings, supported rate-limit evidence, and generic backend failure without overstating evidence.

### Limiter, search cache, and in-flight work

1. Normalize the search cache key from backend order and all semantic options.
2. Check the bounded cache and identical in-flight map before the limiter. `forceRefresh` bypasses a completed cache entry but still consumes limiter capacity; it never bypasses the guardrail.
3. Enforce one process-local logical dispatch every 10 seconds by default.
4. Return immediate local `rate_limited` with exact `retryAfterMs`; never sleep, retry, or fall through to another backend.
5. Add bounded LRU/TTL search caching and remove settled in-flight entries in `finally` paths.
6. Do not cache errors or store raw queries in limiter state.

### Search tool

1. Register the new strict `search_web` schema.
2. Add conservative-query guidance and citation guidance.
3. Return structured bounded results, backend provenance, fetch/cache timing, warnings, and errors.

Acceptance:

- all recorded search fixtures pass;
- quotes, shell metacharacters, leading dashes, and Unicode stay one inert query argument;
- missing `ddgr` falls through only when another backend is configured and reports a bounded warning;
- clean `[]` and failure-signaled `[]` are distinct;
- SearXNG engine failure cannot appear as successful emptiness when diagnostics support failure;
- cache hits and identical in-flight callers do not consume limiter capacity;
- cancellation terminates fetch/subprocess work promptly.

## Phase 1 evaluation gate

Before releasing `ddgr` as the first default backend:

1. Run recorded fixtures for both adapters.
2. Run a focused, non-persistent comparison set covering official-site navigation, versioned technical docs, exact errors, `site:` queries, current information, and Unicode.
3. Compare useful authoritative results at ranks 1/3/5, empty/error rate, malformed fields, obvious spam, and latency.
4. Exercise bounded sequential searches without violating conservative query limits.
5. Record only aggregate outcomes; do not persist raw query history.
6. If `ddgr` fails the focused gate, retain the abstraction but change the default order to `searxng,ddgr` before release.

Rollback at any time by configuring `"pi-web-search": { "backends": ["searxng"] }`.

## Phase 2 — Shared document snapshots

### Fetch and cache

1. Accept HTTP(S) only and reject embedded credentials and unsupported schemes.
2. Apply redirect, timeout, cancellation, and 5 MiB download limits while streaming rather than buffering an unbounded body.
3. Record requested/final URL, status, content type, byte counts, validators, fetch time, and content hash.
4. Preserve supported non-HTML content without DOM conversion.
5. Coalesce identical in-flight fetches and cache only successful bounded normalized snapshots.
6. Use process-local LRU/TTL bounds by both entry count and bytes.

### HTML normalization

1. Add runtime dependencies through the superproject package workflow: `linkedom` and `node-html-markdown`.
2. Parse without executing scripts.
3. Remove non-content elements and select the requested or deterministic content root.
4. Convert to Markdown and normalize structure without flattening code, lists, tables, or headings.
5. Build heading and line indexes against the final normalized snapshot.
6. Detect likely client-rendered shells conservatively and warn that Playwright may be needed.
7. Cap the normalized snapshot retained in memory and surface explicit incomplete/oversize outcomes.

### Cursor service

1. Issue opaque process-local cursors containing or referencing snapshot identity, operation, options, and next position.
2. Validate cursor shape and operation before use.
3. Never expose raw cached content or sensitive configuration in cursors.
4. Return `cursor_expired` when the snapshot has been evicted or expired.

### `read_url_content`

1. Register the strict schema and use the shared document service.
2. Page on normalized character boundaries without corrupting Unicode.
3. Prefer sensible heading/paragraph boundaries when they fit within the requested budget.
4. Return bounded content, source provenance, warnings, and continuation metadata.

### `grep_url_content`

1. Register the strict schema and use the same snapshots.
2. Perform literal case-sensitive or insensitive matching without shelling out.
3. Build exact bounded match records and coalesce overlapping windows.
4. Paginate by match position against the same snapshot.
5. Return explicit `no_match` and bounded counts/provenance.

Acceptance:

- all recorded document fixtures pass;
- a single huge line cannot exceed output budgets;
- repeated reads report original snapshot time and current cache age;
- read and grep share the same content hash for equivalent options;
- cursors cannot silently move to new content;
- match quotes and locators reproduce the normalized snapshot;
- raw HTML and unbounded page content never enter `content` or `details`.

## Phase 3 — Documentation, runtime verification, and cleanup

1. Update README with tool schemas, global/project `pi-web-search` settings, configurable defaults and hard caps, ordered backends, external `ddgr` requirement/link, SearXNG compatibility, privacy topology, timeouts, limiter scope, output bounds, structured statuses, and generalized subagent guidance.
2. Document that snippets support discovery rather than citation.
3. Run formatting, type checking, tests, build, and `git diff --check`.
4. Run both document tools against a deterministic local server.
5. Manually exercise configured SearXNG and `ddgr` paths, including missing/failure states.
6. Load the extension in running Pi and observe all three tools, cancellation, structured failures, cache provenance, limiter behavior, pagination, and rendering.
7. Present verification evidence and any deviations to the user.
8. After verified acceptance, delete `RESEARCH.md`, `PLAN.md`, and the temporary active-planning section in `AGENTS.md`. Keep the guarded deferred-ideas instruction and file.

## Commit sequence

1. Phase 0 and phase 1 search implementation after their tests and focused evaluation pass.
2. Phase 2 document implementation after its fixtures and local integration tests pass.
3. Documentation, verified runtime behavior, and temporary-artifact cleanup.

Use child-first and superproject-pointer-second order for every completed child checkpoint. Do not push unless asked.
