# Web Search Improvements Research

Status: Active pre-work; design direction approved, with final plan details still subject to user review

This document is the active evidence and decision baseline for the current implementation. Read it with `PLAN.md`. Do not read `IDEAS.DEFERRED.md` unless the user explicitly asks to revisit deferred work.

Lifecycle:

1. Keep this document aligned with approved decisions.
2. Use `PLAN.md` as the executable implementation sequence.
3. After implementation and verification, delete `RESEARCH.md`, `PLAN.md`, and the temporary planning section in `AGENTS.md`.

## Mission

SearXNG upstream failures can currently appear as successful empty searches. The extension must distinguish real emptiness from operational failure, support an ordered choice of SearXNG and externally installed `ddgr`, improve static-page extraction, provide bounded structured outcomes and provenance, and prevent agents from flooding search backends or their own context.

## Current state

The runtime remains a single `index.ts`:

- `search_web` combines search and URL loading through an `action` field;
- search calls one SearXNG instance and treats an empty result array as `No results found`;
- page extraction removes HTML with regular expressions;
- `grep_url_content` returns empty text for no matches;
- the page cache is process-local, unbounded, and lazily expires entries;
- fetches and subprocesses have no complete timeout/cancellation policy;
- tool execution arguments use the old order and do not forward Pi's `AbortSignal`.

No runtime implementation, dependency, or public interface has changed during research.

## Approved product decisions

### Public tools

Use three focused tools:

1. `search_web` searches only.
2. `read_url_content` fetches and returns bounded normalized document content.
3. `grep_url_content` finds bounded targeted matches in the same normalized snapshot service.

The public schemas may be redesigned rather than preserving the current overloaded `action: search|load` shape. Preserve the established `search_web` and `grep_url_content` names.

All tools must prevent context bloat through conservative defaults, hard bounds, pagination where useful, explicit truncation metadata, and bounded `details`. Raw HTML must not be duplicated into tool results.

### Search backend order

Use one ordered Pi setting, merged from global and project settings with project precedence:

```json
{
  "pi-web-search": {
    "backends": ["ddgr", "searxng"]
  }
}
```

- Default order is `ddgr,searxng`.
- Users may choose one backend or reorder the list.
- Unknown or duplicate names are configuration errors.
- Advance to the next configured backend only after an explicit operational error.
- A legitimate `no_results` response ends the logical search and does not trigger another backend.
- A primary-plus-secondary sequence is one logical search, and each backend may be attempted at most once.

Use package-scoped `pi-web-search` settings for new configuration. Keep `SEARXNG_URL` and `CACHE_TTL_MINUTES` as lower-priority compatibility fallbacks when their corresponding settings are absent. Direct `ddgr` use sends the caller's query and network address to DuckDuckGo; SearXNG mediates the upstream connection but can itself observe the query. Document this privacy topology.

### External `ddgr`

- Do not bundle, download, or install `ddgr`.
- Resolve it through `PATH` at execution time.
- Cache the availability/version probe for the extension process.
- When unavailable, return a friendly structured error explaining that `ddgr` must be installed on `PATH` and link to <https://github.com/jarun/ddgr>.
- Invoke it without shell interpolation, pass the query as an argv element, request bounded JSON output, avoid interactive/browser behavior, and enforce timeout/cancellation. In `ddgr` 2.2, `--json` already implies noninteractive mode and its JSON path emits no color escapes, so extra prompt/color flags are unnecessary.
- Interpret exit code, stdout, and stderr together.

Installed-version evidence: `ddgr` 2.2 can catch an HTTP failure, print `[]`, exit `0`, and put the real error on stderr. Therefore `[]` plus failure or block evidence is an error; `[]` with clean stderr is `no_results` unless other evidence proves failure. Do not claim a rate limit without HTTP or backend diagnostic evidence.

### SearXNG

- Preserve configurable `SEARXNG_URL` behavior.
- Add bounded timeout and cancellation.
- Validate HTTP status, content type, JSON shape, and normalized fields.
- Inspect engine diagnostics such as `unresponsive_engines`.
- Results plus engine failures produce `ok` with warnings.
- No results plus supported engine-failure evidence produce an error.
- An empty response without failure evidence remains `no_results`.

### Search throttling

- Check the search cache and coalesce identical in-flight requests before consuming limiter capacity.
- Permit one outbound logical search to start every 10 seconds in each extension process by default.
- Make the interval configurable.
- A blocked search fails immediately with structured local `rate_limited`, `retryable: true`, and `retryAfterMs`.
- Do not wait, queue, automatically retry, or use another backend to bypass the local limiter.
- Store only the last-dispatch timestamp, not raw queries, in limiter state.
- URL reads and targeted document extraction do not consume search-query capacity.

This is process-local, not global. Pi subagents run as separate RPC processes.

### Error contract

Expected operational failures return stable structured `status: "error"` outcomes so provenance and retry guidance remain visible. Only unexpected implementation or invariant failures throw and set Pi's protocol-level `isError` flag.

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

Errors include a concise message, `retryable`, and `retryAfterMs` when known.

### Structured placement

Put essential status, results, errors, warnings, bounds, and provenance in model-visible `content`. Store the complete corresponding bounded object in `details` for rendering and session inspection. Search snippets are discovery aids rather than citations; guidance should ask agents to read a source before citing it.

### Document service and extraction

`read_url_content` and `grep_url_content` share one service and one normalized snapshot model:

- accept supported HTTP(S) URLs only;
- record requested URL, final URL, content type, title when available, fetch time, cache status/age, byte counts, content hash, extractor identity, warnings, and truncation state;
- enforce cancellation, timeout, redirect handling, and download bounds;
- preserve plain text, Markdown, and JSON through content-type-specific paths;
- parse HTML with `linkedom`;
- remove scripts, styles, templates, `noscript`, and non-content elements;
- select deterministically from an explicit selector or `main`, `[role="main"]`, `article`, then `body`;
- convert HTML using `node-html-markdown`;
- preserve headings, paragraphs, lists, links, tables, and fenced code;
- normalize line endings and excessive blank lines without flattening structure;
- warn when static extraction appears incomplete and recommend Playwright for JavaScript-dependent pages.

The initial extraction path is deterministic and Node-only.

### Snapshots, matching, and cursors

- Cache bounded normalized snapshots and source metadata together in process memory.
- Use bounded LRU/TTL behavior and coalesce identical in-flight fetches.
- Cache successful documents and searches, not operational errors.
- Bind cursors to the exact content hash, extractor/options identity, and cached snapshot.
- Never continue a cursor against silently refetched content.
- Return `cursor_expired` when the original snapshot is unavailable.
- Literal case-insensitive matching remains the default for `grep_url_content`.
- Match results include exact bounded quotes, heading breadcrumbs, and normalized line/offset locators.
- Coalesce overlapping context windows.
- No matches return explicit `status: "no_match"`, never empty output.

### Subagent guidance

Retrieval remains deterministic; the extension does not invoke a model. Tool guidance and the README should say, in setup-independent terms, that when subagents are available agents should use a type suited to web research for broad, multi-page, or context-heavy investigation. For page summarization, delegate the URL and summary objective before fetching so the subagent owns retrieval and returns a bounded evidence report. A configured type may be named `research`, but no particular name or subagent extension is required.

Keep this as a mild workflow nudge, not a large embedded procedure or repetitive success warning.

## Output-bound principles

All three tools must remain below Pi's global 50 KB/2000-line ceiling, but their normal defaults should be substantially smaller.

- Bound result counts and every external string before formatting.
- Bound both `content` and `details`.
- Bound fetched response bytes before extraction.
- Paginate normalized documents and match sets through snapshot-bound cursors.
- Report total/returned counts or bytes and whether more data exists.
- Never emit unbounded stderr, raw HTML, diagnostics, or backend-native objects.
- Keep default rendering compact; expanded rendering must remain bounded.

Exact defaults and hard limits belong in the approved plan and fixture tests. User-facing defaults and caps are configurable through global/project `pi-web-search` settings, while Pi's 50 KB/2,000-line protocol ceiling remains a non-configurable final boundary.

## Candidate implementation structure

```text
index.ts
src/
  config.ts
  contracts.ts
  format.ts
  bounds.ts
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
    cursor.ts
  tools/
    search-web.ts
    read-url-content.ts
    grep-url-content.ts
test/
  fixtures/
  *.test.ts
```

Update package publishing files and `tsconfig.json` includes so the child package remains independently installable.

## Verification baseline

### Recorded fixtures

Search fixtures cover:

- SearXNG success, empty, partial-engine failure, failure evidence, malformed JSON, timeout, and HTTP errors;
- `ddgr` success, clean empty JSON, missing executable, non-zero exit, timeout, block/rate-limit stderr, malformed output, and exit-0 failure stderr;
- safe argv handling for quotes, shell metacharacters, and Unicode;
- ordered backend behavior and no fallback after `no_results`;
- first search allowed, interval rejection with `retryAfterMs`, boundary allowance, cache hit, identical in-flight coalescing, and cancellation.

Document fixtures cover:

- technical HTML, article HTML, malformed HTML, huge single-line HTML, redirects, plain text, Markdown, and JSON;
- dynamic-app shell warning;
- fetch and output byte bounds;
- stable snapshot pagination and expired cursors;
- exact grep quotes/locators, overlapping contexts, no-match status, and bounded output.

### Commands and integration

For completed work:

```bash
# packages/pi-web-search
npx tsc --noEmit
npx prettier --write index.ts package.json

# superproject root
pnpm --filter @arcanemachine/pi-web-search test
pnpm --filter @arcanemachine/pi-web-search build
```

Also format every added TypeScript and Markdown file, run fixture tests, exercise both document tools against a deterministic local HTTP server, and manually verify both configured search backends. Verify behavior against the running Pi extension before calling the implementation complete.

## Rollout and rollback baseline

- Keep backend order configurable for immediate rollback, for example `"pi-web-search": { "backends": ["searxng"] }`.
- Do not push unless asked.
- Commit child-package changes before the superproject submodule pointer.
- After verified implementation, remove temporary research/plan artifacts and their `AGENTS.md` pointer.
