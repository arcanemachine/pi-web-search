# Web Search Improvements Research

Status: Active research handoff; not an approved implementation plan

This document preserves research for a future agent because the investigation spans multiple sessions. `AGENTS.md` points here so it is read before package work begins.

Lifecycle:

1. Keep this file current during research.
2. After the user approves scope and unresolved decisions, create `PLAN.md` with an executable sequence that references this file.
3. After implementation and verification, delete `RESEARCH.md`, `PLAN.md`, and the temporary pointer in `AGENTS.md`.

## Handoff snapshot

- This handoff changes documentation only. No extension source, dependency, configuration, or runtime behavior has changed.
- The future agent must read this file, review the eight unresolved decisions with the user, and obtain explicit approval before creating an implementation plan.
- After approval, create `PLAN.md` with scoped steps, tests, rollout/rollback criteria, and a pointer back to this evidence.
- Do not implement directly from the candidate workstreams below; they organize research rather than represent accepted scope.
- Local research checkouts under `/workspace/tmp/_git/` and ephemeral checkouts under `/tmp/` are not project dependencies or tracked artifacts.
- Highest-priority problem: SearXNG upstream rate limiting can appear as an empty successful search.
- Most important `ddgr` finding: version 2.2 can emit `[]` with exit code `0` while reporting an HTTP failure on stderr, so an adapter must interpret all three channels together.
- Recommended local extraction baseline: Node-only `linkedom` plus `node-html-markdown`, behind a replaceable extractor contract.
- Recommended summary workflow: delegate the URL and objective to a subagent before fetching; do not hide LLM calls inside this extension.
- The extension must enforce conservative search-query throttling and mildly guide agents away from unnecessary repeated searches.

## Context

The extension currently:

- sends search requests directly to one SearXNG instance;
- can mistake an upstream-engine failure for a legitimate empty result;
- has no search timeout, retry policy, fallback, cache, or outbound-query throttling;
- strips HTML with regular expressions, which collapses many modern documentation pages into unusable lines;
- returns empty output when URL grep finds no matches;
- exposes little fetch, cache, or source provenance.

The immediate blocker is search reliability under SearXNG upstream rate limiting. The longer-term goal is a backend-independent search and document-extraction extension.

## Confirmed decisions

- Keep SearXNG as a configurable backend.
- Add `ddgr` as another configurable backend.
- Do not bundle or install `ddgr`.
- Resolve `ddgr` through `PATH` at execution time and return a clear error when unavailable.
- Preserve the existing `search_web` and `grep_url_content` tool names.
- Improve structured statuses and provenance alongside the backend work.
- Prefer a Node-only initial extraction path rather than adding a Python runtime dependency.
- Keep Firecrawl out of the initial scope; its official Pi extension can coexist for heavier scraping needs.
- Use a subagent workflow for page summarization rather than embedding model calls inside the web-search extension.
- Enforce search-query rate limiting inside the extension so an agent cannot rapidly flood the configured search backend.
- Add mild, professional tool guidance encouraging focused queries, reuse of existing results, and avoidance of unnecessary repeated searches; do not emit a routine nudge on every successful call.

## Recommended decisions requiring review

1. Keep SearXNG as the default until the backend evaluation passes; then consider making `ddgr` the default.
2. Fall back only after an explicit backend error. Do not silently fall back after a legitimate `no_results` response.
3. Do not automatically retry rate-limited searches. A retry can worsen throttling and duplicate a query.
4. Use `linkedom` for DOM parsing and `node-html-markdown` for deterministic Markdown conversion in the first extraction upgrade.
5. Consider Defuddle later as an optional `readable` extraction mode, not as the only parser for technical documentation.
6. Put essential structured data in model-visible tool `content` and duplicate the complete object in `details` for rendering and session inspection.
7. Decide whether cross-process disk caching is worth its privacy, locking, and cleanup costs; subagents run as separate Pi RPC processes.
8. Keep Crawl4AI out of the initial Node-only scope. If browser-backed extraction later needs a unified tool contract, evaluate it as an optional externally managed `DocumentBackend`; do not bundle or install its Python, browser, or service stack.

## Non-goals

- Bundling or automatically installing external executables.
- Evading CAPTCHAs or upstream rate limits.
- Treating search snippets as authoritative citations.
- Replacing Playwright for JavaScript-dependent pages.
- Adding a hosted extraction service or sending fetched content to third parties.
- Cross-source fact checking, legal interpretation, or automatic evidence-quality judgments in the initial work.

## Storage and caching research

The current `Map` cache is memory-only and effectively unbounded: expired entries are ignored during lookup but distinct expired URLs are not proactively evicted.

Recommended default is a bounded, ephemeral hybrid cache:

- Search results: in-memory LRU, short TTL, entry/byte bounds, and no persistent query history.
- Hot normalized documents: in-memory LRU.
- Raw HTML and large normalized snapshots: optional spillover to a private OS temporary directory.
- In-flight requests: coalesce identical concurrent fetches so one upstream request serves all waiters.
- Errors: do not cache initially; cache successful searches and document snapshots only.

Cache identity should include all inputs that can change meaning:

- search backend plus normalized query options;
- requested/final URL and fetched-content hash;
- extractor name and version;
- extraction mode and options.

Store source metadata with the snapshot: requested/final URL, content type, fetched time, expiry, ETag/Last-Modified when available, byte length, and content hash. Use atomic writes, hashed filenames, restrictive permissions, TTL cleanup, LRU bounds, and explicit `forceRefresh`.

A persistent cache under `XDG_CACHE_HOME` could later allow separate subagent processes to reuse snapshots, but it retains browsing history and requires cross-process locking. Keep it opt-in if added. The simpler summary workflow is to delegate the URL before the main agent fetches it, letting the subagent own the fetch and summary.

No database is needed initially. A database should be justified only if persistent indexing, cross-process concurrency, or large cache management becomes a demonstrated requirement.

## Search request throttling research

Prompt guidance is advisory and cannot prevent flooding by itself. The search service needs an enforced limiter before it dispatches a logical query to a backend. URL loads and targeted document extraction are separate operations and should not consume search-query capacity.

Approved initial direction:

- Check the search cache first and coalesce identical in-flight requests, so reuse does not consume limiter capacity.
- Permit one outbound logical search to start every 10 seconds within each extension process. A primary-plus-fallback sequence remains one logical search, and each backend may still be attempted at most once.
- When the interval has not elapsed, fail fast with a structured local `rate_limited` outcome, `retryable: true`, and `retryAfterMs`. Do not sleep inside the tool, automatically retry, or invoke a fallback to bypass the local guardrail.
- Make the interval configurable, with 10 seconds as the default.
- Do not store raw queries in limiter state. Only the last-dispatch timestamp is required.
- Put the behavioral reminder in `search_web` prompt guidance rather than appending repetitive warnings to successful results. Candidate wording: “Use search_web conservatively: make focused queries, reuse relevant results, and avoid repeated or speculative searches when one query will suffice.”

A limiter held in extension memory protects one Pi process only. Pi subagents use separate RPC processes, so several agents can collectively exceed that limit. Cross-process coordination is not required for the initial implementation. It may be added if a safe implementation is trivial, but must not expand the first scope with locking, stale-lock recovery, persistent state, or query-history storage.

## Candidate architecture

Keep tool registration thin and move behavior into testable modules:

```text
index.ts
src/
  config.ts
  contracts.ts
  format.ts
  search/
    backend.ts
    ddgr.ts
    limiter.ts
    searxng.ts
    service.ts
  documents/
    cache.ts
    fetch.ts
    markdown.ts
    match.ts
    service.ts
test/
  fixtures/
  *.test.ts
```

Update `package.json` publishing files and `tsconfig.json` includes so the package remains independently installable.

Document handling needs two abstraction levels:

```ts
interface DocumentExtractor {
  readonly name: string;
  extract(
    input: FetchedDocument,
    options: ExtractOptions,
    signal?: AbortSignal,
  ): Promise<NormalizedDocument>;
}

interface DocumentBackend {
  readonly name: string;
  load(
    request: DocumentRequest,
    signal?: AbortSignal,
  ): Promise<DocumentOutcome>;
}
```

The local backend composes Node `fetch` with a `DocumentExtractor`. A service such as Firecrawl owns fetching/rendering/extraction together and therefore belongs at the higher `DocumentBackend` level, not behind the raw-HTML extractor interface.

### Search backend contract

```ts
interface SearchBackend {
  readonly name: string;
  search(request: SearchRequest, signal?: AbortSignal): Promise<SearchOutcome>;
}

interface SearchRequest {
  query: string;
  limit: number;
  region?: string;
  safeSearch?: "on" | "moderate" | "off";
  timeRange?: "day" | "week" | "month" | "year";
}
```

Every backend normalizes its native output into the same result fields:

```ts
interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
}
```

Backend-specific fields stay in diagnostics and must not leak into the stable result schema.

### Stable outcomes

Search statuses:

- `ok`
- `no_results`
- `error`

Targeted extraction statuses:

- `ok`
- `no_match`
- `error`

Initial error codes:

- `invalid_request`
- `backend_unavailable`
- `rate_limited`
- `timeout`
- `blocked`
- `fetch_failed`
- `backend_failed`
- `parse_failed`
- `cursor_expired`

Errors include `message`, `retryable`, and `retryAfterMs` when known. Expected operational errors should return structured `status: "error"` results so provenance is retained. Unexpected implementation errors may still throw.

## Subagent page-summary workflow

Do not make the web extension call an LLM internally. Keep retrieval deterministic and let Pi orchestrate summarization:

1. Spawn a subagent with the URL, summary objective, desired evidence, and output bound.
2. The subagent calls `search_web` load and/or `grep_url_content` itself.
3. It returns a summary with exact supporting quotes, headings, source URL, snapshot time, and uncertainty.
4. The parent receives only the bounded report rather than the whole page.

Pi subagents run as separate `pi --mode rpc --no-session` processes. An in-memory cache is therefore not shared. Delegate before fetching to avoid duplicate work, or add an explicitly approved cross-process disk cache later.

Possible future convenience should be implemented as prompt/skill orchestration, not as a hidden model call inside `pi-web-search`. This preserves model choice, cost visibility, cancellation, and separation between evidence retrieval and interpretation.

## Firecrawl research

The official `@firecrawl/pi-firecrawl` extension already exposes separate Pi tools for search, scrape, map, crawl, batch scrape, and structured extraction. It uses the official SDK, requires `FIRECRAWL_API_KEY`, supports a custom/self-hosted API URL, and exposes server-side cache age through Firecrawl's `maxAge` option.

Firecrawl is useful for JavaScript rendering, blocked sites, PDFs, actions, proxy modes, and large crawl jobs. Its self-hosted stack is substantially heavier, involving Docker services, Redis queues, and Playwright components. Keep it as a companion extension rather than duplicating it in the initial local backend. Reconsider only if a unified tool contract becomes more valuable than keeping the integrations separate.

Local checkout: `/workspace/tmp/_git/pi-firecrawl`.

## Crawl4AI research

Crawl4AI is a Python web crawler and extraction system rather than a lightweight HTML parser. The inspected snapshot was repository commit `7e801521428ee12509994d39151006f64055ebe3` (`v0.9.2`). The shallow research checkout under `/tmp/` is ephemeral and is not a dependency or tracked artifact.

### Capabilities and interfaces

- The package requires Python 3.10 or newer. Core dependencies include Playwright, Patchright, browser-stealth tooling, `lxml`, BeautifulSoup, SQLite support, NumPy, and a pinned LiteLLM fork. `crawl4ai-setup` installs browser and OS dependencies. This conflicts with the confirmed Node-first initial direction even when no LLM feature is used.
- Browser-backed crawling supports JavaScript execution, wait conditions, sessions, deep crawling, screenshots, PDFs, redirects, response headers, and anti-bot/block detection. Results expose `success`, `error_message`, status, requested/redirected URL data, Markdown, HTML, media, links, and structured extraction output.
- Deterministic use does not require an LLM. It provides raw and filtered Markdown, link citations, heuristic pruning, BM25 filtering, and CSS-, XPath-, or regex-based JSON extraction. LLM extraction and filtering are optional behaviors, although the LiteLLM fork remains a core installation dependency.
- Integration surfaces include the Python API, the `crwl` CLI, and a self-hosted Docker HTTP/MCP server. The CLI accepts a URL as an argv element and can emit a full crawl-result JSON object or raw/filtered Markdown. The server exposes crawl, Markdown, HTML, screenshot, PDF, streaming, and job endpoints.
- The Docker path is a service deployment, not a small library fallback. Its checked-in guide asks for at least 4 GB RAM, uses a browser pool and Redis-backed infrastructure, and recommends a 1 GB shared-memory allocation. The hosted cloud API was still described as closed beta in the inspected README.

### Storage, privacy, and operational behavior

Crawl4AI caching is persistent by default. The in-process implementation stores URL metadata in `~/.crawl4ai/crawl4ai.db` and content-addressed HTML, Markdown, screenshots, and other data under `~/.crawl4ai/`; it also stores logs, browser profiles, robots data, and feature-specific caches there. `CacheMode` supports enabled, disabled, read-only, write-only, and bypass modes, and `CRAWL4_AI_BASE_DIRECTORY` can relocate storage. An adapter would need to choose bypass/disabled mode or an isolated private directory explicitly rather than inherit persistent browsing history and unreviewed cleanup behavior.

The multi-URL API offers bounded concurrency, streaming, memory-adaptive dispatch, page and batch timeouts, and optional rate-limit retries. Those retry defaults are not suitable evidence for changing this extension's separate decision not to retry rate-limited search queries. A Pi integration would still need to prove that aborting a subprocess or HTTP stream promptly closes browser work and releases server jobs.

The local library keeps crawled data on the caller's machine unless optional LLM providers or other configured services are used. The cloud service has a different privacy topology: its published policy says submitted URLs/keywords, configuration, timestamps, job status, and result-object links are recorded, with results commonly retained for 30 days and operational logs commonly retained for 90 days.

### Licensing, security, and maturity cautions

Repository metadata declares Apache-2.0, but the checked-in `LICENSE` appends a separate prominent-attribution requirement. That extra text should be reviewed explicitly before bundling or redistributing Crawl4AI; the proposed external-only disposition avoids making it part of this package.

The project is active and widely used, but its package classifier remains Beta and the checked-in documentation is inconsistent: some pages describe older Docker versions or call Docker experimental while the current release documents a hardened server. The Docker API also had recent critical RCE, SSRF, authentication, file-write, and XSS fixes. Any future service adapter should pin and fixture-test an exact version, require the secure-by-default `v0.9.0`-or-newer posture, use loopback or TLS plus authentication, and treat URLs and extracted content as untrusted.

### Recommended disposition

Do not add Crawl4AI to the initial implementation. It duplicates the ordinary static-page path with a much larger Python/browser footprint and would violate the user's preference to avoid Python cross-contamination. Keep the deterministic Node extractor for normal static pages and continue recommending Playwright when a page requires JavaScript.

If a later unified `DocumentBackend` becomes valuable, Crawl4AI is a credible optional browser-backed backend for JavaScript-heavy pages, structured site-specific extraction, or multi-page crawling. Prefer an explicitly configured, externally managed Docker service for repeated use because it isolates dependencies and amortizes browser startup; a PATH-resolved `crwl` adapter is possible for occasional local use but must not install Crawl4AI, must isolate or disable its persistent cache, and must interpret the full JSON outcome rather than Markdown alone. This occupies the same architectural tier as Firecrawl, not the raw-HTML `DocumentExtractor` tier. No official Pi extension was found during this investigation, unlike Firecrawl.

Primary sources:

- Repository and README: <https://github.com/unclecode/crawl4ai>
- Package metadata and dependencies: <https://github.com/unclecode/crawl4ai/blob/main/pyproject.toml>
- Markdown generation: <https://docs.crawl4ai.com/core/markdown-generation/>
- Deterministic extraction: <https://docs.crawl4ai.com/extraction/no-llm-strategies/>
- Cache modes: <https://docs.crawl4ai.com/core/cache-modes/>
- Self-hosting: <https://docs.crawl4ai.com/core/self-hosting/>
- Docker security migration: <https://github.com/unclecode/crawl4ai/blob/main/deploy/docker/MIGRATION.md>

## Candidate workstreams

The numbered items below organize possible work. They are not an approved sequence or scope; the future `PLAN.md` must be based on explicit user decisions.

## Item 01 (contracts-and-tests)

Create the internal contracts, configuration parser, formatters, and test harness before changing backend behavior.

### Work

- Extract tool-independent types and result formatting.
- Add runtime validation for external JSON rather than using `any`.
- Correct tool execution argument names and pass Pi's `AbortSignal` through all abort-aware operations.
- Add a TypeScript-capable test runner using Node's test API and `tsx`, unless an equally small existing project convention is identified.
- Preserve the current public input shape while allowing optional additions.

### Acceptance

- Both tools return non-empty, explicit status text for all expected outcomes.
- Result objects stored in `details` match the model-visible content.
- Fixtures cover valid, empty, malformed, and failed responses.

## Item 02 (search-backends)

Introduce SearXNG and `ddgr` adapters behind the shared contract.

### SearXNG adapter

- Keep `SEARXNG_URL` compatibility.
- Add a bounded timeout and forward cancellation.
- Validate the response status, content type, and JSON shape.
- Normalize title, URL, and snippet fields.
- Inspect SearXNG engine diagnostics such as `unresponsive_engines` when present.
- If results exist but engines failed, return `ok` with warnings.
- If no results exist and engine diagnostics show failure, return an error rather than `no_results`.
- Classify `rate_limited` only when HTTP status or backend diagnostics support that conclusion; otherwise use `backend_failed`.

SearXNG cannot always prove why a response is empty. An empty result with no failure diagnostics remains `no_results` and should not be overstated as a rate limit.

### `ddgr` adapter

- Check availability on first `ddgr` use by executing `ddgr --version` through `pi.exec` with argv and a timeout.
- Cache the availability/version result for the extension lifetime.
- Never construct a shell command or interpolate the query into shell syntax.
- Invoke non-interactive JSON output and pass the query as an argv element.
- Parse the JSON array into the shared result schema:
  - `title` -> `title`
  - `url` -> `url`
  - `abstract` -> `snippet`
- Treat non-zero exit, timeout, malformed JSON, CAPTCHA/block indicators, and missing executable as distinct outcomes where evidence permits.
- Do not log raw queries or full stderr by default.
- Include `ddgr` version in diagnostics, not normal result prose.

The installed `ddgr` is `/workspace/local/bin/ddgr`, version 2.2. Source inspection found an important ambiguity: its HTTP layer catches request errors and returns no page; non-interactive JSON mode can then print `[]` and exit `0` while the HTTP error is written to stderr. The adapter must interpret stdout, stderr, and exit status together. For example, `[]` plus rate-limit stderr is an error, while `[]` with clean stderr is `no_results` unless other block evidence exists.

An empty valid JSON array remains intrinsically ambiguous when stderr is clean; `ddgr` may not provide enough evidence to distinguish every HTTP-200 block page from a real empty result.

### Configuration

Proposed environment variables:

```text
WEB_SEARCH_BACKEND=searxng|ddgr
WEB_SEARCH_FALLBACK=none|searxng|ddgr
WEB_SEARCH_TIMEOUT_MS=10000
WEB_SEARCH_CACHE_TTL_SECONDS=120
WEB_SEARCH_MIN_SEARCH_INTERVAL_MS=10000
```

Keep the existing page cache setting compatible while introducing clearer document-specific settings later.

### Fallback

- Attempt the configured primary backend once.
- Use the configured fallback only for explicit operational errors.
- Do not fall back for `no_results` by default.
- Report the backend that actually produced results and any preceding backend failure.
- Prevent configuration loops and duplicate backend attempts.

### Acceptance

- Missing `ddgr` produces `backend_unavailable` with installation guidance.
- A signaled SearXNG engine failure is not rendered as “No results found.”
- Backend selection does not change the normalized result schema.
- Queries containing quotes, shell metacharacters, or Unicode are passed safely.
- A second logical search within the configured minimum interval produces a structured `rate_limited` outcome with `retryAfterMs` and does not dispatch or fall back.
- Cache hits and callers sharing identical in-flight work do not consume additional limiter capacity.

## Item 03 (structured-search)

Upgrade the search tool response and add conservative quality-of-life controls.

### Inputs

Keep `action` and `input`. Add optional search fields without changing current defaults:

- `limit` (default `5`, bounded)
- `region`
- `safeSearch`
- `timeRange`
- `forceRefresh`

Use a Google-compatible string-enum schema as required by Pi's extension API.

### Output

Return a compact structured object containing:

- `status`
- `query`
- normalized `results`
- `backend`
- `fetchedAt`
- cache hit/miss and age
- duration
- warnings
- error data when applicable

Search snippets are discovery aids, not citations. Tool guidance should tell the model to load or extract a result before citing a claim. It should also mildly encourage focused, conservative query use without adding a repetitive warning to normal results.

### Search throttling

- Enforce the per-process minimum interval before backend dispatch, defaulting to 10 seconds.
- Return the local limit source and `retryAfterMs` in the structured outcome so it cannot be confused with backend throttling.
- Do not automatically retry, wait, queue a backlog, or use fallback to evade the local limit.
- Keep cross-process enforcement out of the initial scope unless it is demonstrably trivial and does not introduce persistent coordination machinery.

### Search cache

- Key by backend plus normalized request options.
- Cache successful searches briefly to reduce duplicate upstream requests.
- Do not cache backend errors initially.
- Bind provenance to the actual fetch time, not the later cache-read time.
- Support `forceRefresh`.

## Item 04 (document-fetch)

Separate fetching from extraction and create a reusable document snapshot.

### Snapshot metadata

```ts
interface Source {
  requestedUrl: string;
  finalUrl: string;
  title?: string;
  contentType: string;
  fetchedAt: string;
  cache: {
    status: "hit" | "miss";
    ageMs?: number;
  };
}
```

### Fetch behavior

- Accept only supported HTTP(S) URLs.
- Forward cancellation and enforce a timeout.
- Record the final redirect URL and response content type.
- Bound downloaded bytes and clearly report truncation or oversize failure.
- Preserve plain text, Markdown, and JSON through content-type-specific paths.
- Do not run page scripts.
- Detect likely incomplete client-rendered pages and emit a warning recommending Playwright; do not present partial extraction as complete.
- Cache the normalized snapshot and source metadata together.

## Item 05 (markdown-extraction)

Replace regular-expression tag removal with deterministic DOM-aware Markdown extraction.

### Initial in-process pipeline

1. Parse HTML with `linkedom`.
2. Remove scripts, styles, templates, `noscript`, and other non-content elements.
3. Select an explicit caller selector when provided; otherwise select the strongest available content root (`main`, `[role="main"]`, `article`, then `body`). When several candidates exist, choose deterministically and record the selector decision.
4. Convert the selected HTML with `node-html-markdown`.
5. Normalize line endings and excessive blank lines without flattening block structure.
6. Build a heading index from the normalized Markdown.
7. Store offsets against that normalized cached snapshot.

This should preserve headings, paragraphs, lists, links, tables, and fenced code much better than the current regex pipeline.

### Why not shell out for extraction

- In-process parsing avoids another external runtime prerequisite.
- It retains DOM and heading context needed for locators.
- It avoids temporary-file and subprocess overhead for every page.
- It supports Pi cancellation and structured failures directly.
- Shell `grep` adds little value for case-insensitive literal matching and makes snapshot provenance harder to preserve.

### Optional future extraction modes

- `main`: deterministic main-content selection; recommended default.
- `full`: normalized body conversion when navigation/context is intentionally needed.
- `readable`: article-oriented extraction, potentially using Defuddle.

If Defuddle is evaluated, disable its third-party asynchronous fallbacks (`useAsync: false`) by default. Its own documentation calls it a work in progress, so it should be fixture-tested against technical documentation before becoming a default.

External tools remain possible future adapters:

- Trafilatura: Apache-2.0, Python 3.10+, article/main-text extraction, metadata, Markdown, links, tables, and precision/recall modes. Its CLI accepts HTML on stdin, but that path has no clean source-URL argument for relative-link/metadata resolution. Extraction failure may produce empty stdout without a non-zero exit, so an adapter must inspect stderr and treat empty output explicitly. Keep it as research rather than an initial dependency. Local checkout: `/workspace/tmp/_git/trafilatura`.
- Pandoc: strong deterministic format conversion, but not main-content extraction and adds a large external dependency.
- Lynx/W3M: useful rendered text, but lose Markdown structure and source locators.

## Item 06 (targeted-extraction)

Upgrade `grep_url_content` without replacing its familiar use case.

### Inputs

Keep `url`, `query`, `beforeLines`, and `afterLines`. Add optional:

- `maxMatches`
- `maxChars`
- `caseSensitive`
- `selector`
- `includeSubsections`
- `forceRefresh`
- `cursor`

Literal matching remains the default. Regex matching should be a separate explicit option if added later.

### Match objects

Each match contains:

- exact quote from the normalized snapshot;
- heading breadcrumb path;
- normalized start/end offsets;
- normalized start/end lines.

Coalesce overlapping context windows so repeated nearby matches do not duplicate large blocks.

### Pagination and truncation

- Bound all tool output below Pi's global 50 KB/2000-line limits.
- Return `nextCursor` only when more content or matches exist.
- Bind cursors to one cached snapshot; never silently continue against a refetched document.
- Return `cursor_expired` if that snapshot is unavailable.
- If a full normalized snapshot is written to a temporary file for truncation recovery, report the exact path and lifecycle.

### Acceptance

- No match returns explicit `status: "no_match"`, never empty tool output.
- Large single-line documentation becomes usable Markdown with meaningful headings and lines.
- Repeated extraction from cache reports the original snapshot time and current cache age.
- Match quotes and offsets reproduce content from the same normalized snapshot.

## Item 07 (evaluation-and-rollout)

Evaluate reliability before changing the default backend.

### Recorded fixtures

- SearXNG success, empty, partial-engine failure, rate-limit evidence, malformed JSON, and HTTP errors.
- `ddgr` success, empty JSON, missing executable, non-zero exit, timeout, block-like stderr, and malformed output.
- HTML documentation, article, malformed HTML, huge single-line HTML, redirect, plain text, Markdown, and JSON.
- Dynamic-app shell with insufficient static content.
- First search allowed, second search inside the minimum interval rejected with the correct `retryAfterMs`, search allowed at the interval boundary, cache hit, identical in-flight coalescing, and cancellation behavior.
- Cross-process behavior only if coordination is included without expanding scope.

### Shadow query suite

Compare SearXNG and `ddgr` using:

- official-site and navigational queries;
- version-specific technical documentation;
- exact phrases;
- errors and stack traces;
- niche topics;
- current events;
- typo queries;
- `site:` queries;
- non-English and Unicode queries;
- ambiguous terms.

Measure:

- expected authoritative result success at 1/3/5 and reciprocal rank;
- missing title/URL/snippet rate;
- duplicate and redirect URL rate;
- source diversity and obvious spam/ad rate;
- freshness for time-sensitive queries;
- p50/p95 latency, timeout rate, parse-error rate, and empty-result rate;
- bounded-concurrency and soak behavior;
- observed rate-limit/block recovery.

Do not persist raw queries in benchmark logs unless explicitly requested.

### Rollout

1. Ship the abstraction with SearXNG behavior preserved.
2. Enable `ddgr` explicitly in development.
3. Run fixtures, manual integration checks, and the shadow suite.
4. Decide whether `ddgr` becomes the default based on evidence.
5. Retain an immediate configuration rollback to SearXNG.

## Documentation updates

Update `README.md` with:

- backend selection;
- external `ddgr` requirement and PATH check;
- SearXNG configuration;
- timeout, cache, and search-throttling settings;
- stable statuses and error codes;
- the distinction between extension-local and backend-reported rate limiting;
- conservative-query prompt guidance and the scope of any cross-process guarantee;
- extraction modes and output bounds;
- privacy topology: direct `ddgr` queries expose the caller's network address and query to DuckDuckGo, while SearXNG mediates that connection but can observe the query itself.

## Verification

For each completed item:

```bash
# In packages/pi-web-search, required by AGENTS.md
npx tsc --noEmit
npx prettier --write index.ts package.json

# From the superproject root
pnpm --filter @arcanemachine/pi-web-search test
pnpm --filter @arcanemachine/pi-web-search build
```

Also format all newly added TypeScript and Markdown files, run fixture tests, exercise the tool against a local deterministic HTTP server, and manually verify both configured search backends before calling the implementation complete.

## Research notes

- `ddgr` documents JSON output, non-interactive use, region, time, safe-search, and result-count controls. It directly targets DuckDuckGo's HTML interface and is GPL-3.0: <https://github.com/jarun/ddgr>
- The installed `ddgr` source was inspected at `/workspace/local/bin/ddgr` (version 2.2).
- Defuddle provides Node DOM input, Markdown output, metadata, and main-content extraction, while warning that it is a work in progress: <https://github.com/kepano/defuddle>
- Mozilla Readability provides article extraction and metadata but requires a Node DOM implementation and is article-oriented: <https://github.com/mozilla/readability>
- `node-html-markdown` provides deterministic in-process HTML-to-Markdown conversion and preserves block-level line structure: <https://github.com/crosstype/node-html-markdown>
- Trafilatura provides CLI main-content extraction and Markdown output but requires a separate Python installation: <https://trafilatura.readthedocs.io/en/latest/usage-cli.html>. Local research checkout: `/workspace/tmp/_git/trafilatura`.
- Firecrawl's official Pi extension is <https://github.com/firecrawl/pi-firecrawl>. Local research checkout: `/workspace/tmp/_git/pi-firecrawl`.
- Firecrawl is primarily AGPL-3.0, while its SDKs and some UI components are MIT-licensed: <https://github.com/firecrawl/firecrawl>.
- Crawl4AI was inspected at commit `7e801521428ee12509994d39151006f64055ebe3` (`v0.9.2`): <https://github.com/unclecode/crawl4ai>. Its temporary checkout was created under `/tmp/` and is not expected to persist.
