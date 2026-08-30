# Native DuckDuckGo Search Plan

## Status and authority

This is the executable implementation plan for replacing the package's external DuckDuckGo command path with a native TypeScript backend.

The user has approved the product direction and architecture decisions recorded below. This artifact does **not** itself authorize implementation, dispatch, commit, or acceptance. Those lifecycle gates remain separate.

This file is the only planning artifact for this track. Do not modify `PLAN.md`, `TODO.SUMMARIZER.md`, `PLAN.SUMMARIZER.md`, `PLAN.BOT-DETECTION-AVOIDANCE.md`, or `IDEAS.DEFERRED.md` as part of this work.

## Objective

Make DuckDuckGo search an internally implemented capability of `pi-web-search`, with no external executable or Python requirement.

The delivered package must:

- expose the backend as `duckduckgo`;
- issue DuckDuckGo HTML search requests directly from TypeScript;
- parse machine-usable title, URL, and snippet results;
- preserve the existing `search_web` request and structured outcome contracts;
- continue to use the existing cache, limiter, fallback, cancellation, provenance, and output-bounding layers;
- remove the superseded subprocess implementation and every runtime, configuration, test, and user-facing reference to it;
- remain an independently installable package with no new package or runtime dependency.

The code should have clean internal request, parsing, and backend boundaries so later extraction into a library remains possible if actual reuse appears. Do not create a library, package, or generalized client now.

## Approved decisions

These are settled and must not be reopened during routine implementation:

1. **Native location:** Implement the capability inside `pi-web-search` in TypeScript.
2. **Backend identity:** Rename the public backend to `duckduckgo`.
3. **Compatibility:** Do not retain a compatibility alias, migration reader, deprecated configuration value, alternate code path, or legacy documentation.
4. **Core scope:** Support searching and returning usable web results. Do not reproduce a terminal application's broader feature set.
5. **Parser orientation:** Build a machine-oriented structured parser. Terminal formatting, interactivity, and presentation logic are irrelevant.
6. **Dependencies:** Use the existing platform `fetch` and existing `jsdom` dependency. Add no runtime dependency.
7. **License posture:** Independently implement the required behavior. Upstream behavior and protocol observations may inform the implementation, but do not copy or adapt nontrivial GPL-licensed source into this MIT package.
8. **Default region:** When the caller omits `region`, preserve the current effective `us-en` behavior.
9. **Reliability improvements:** Include narrow improvements that directly strengthen the core path: bounded response handling, structured HTML parsing, URL normalization, whitespace normalization, direct HTTP/block classification, malformed-page detection, timeout handling, and cancellation.
10. **Removal order:** Establish and verify the native path before deleting the superseded path. The completed change must contain only the native path.
11. **Anti-scope-creep boundary:** Ordinary request headers and conservative block detection are allowed. CAPTCHA solving, browser automation, rotating identities, proxy rotation, fingerprint manipulation, and other anti-bot work are not.

## Verified current state

### Public search contract

`src/contracts.ts` defines:

```ts
interface SearchRequest {
  query: string;
  limit?: number;
  region?: string;
  safeSearch?: "on" | "off";
  timeRange?: "day" | "week" | "month" | "year";
  forceRefresh?: boolean;
}
```

Search results use:

```ts
interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  engine?: string;
}
```

The native backend does not need a new public request or result field.

### Existing service boundaries

- `src/search/backend.ts` defines the backend interface and passes `signal` plus `timeoutMs` to each backend.
- `src/tools/search-web.ts` validates and normalizes tool input, defaults safe search to `on`, applies configured result defaults/caps, and bounds the final outcome.
- `src/search/service.ts` owns ordered dispatch, fallback, cache writes, in-flight coalescing, local rate limiting, warnings, and attempt provenance.
- `src/search/cache.ts`, `src/search/key.ts`, and `src/search/limiter.ts` already provide the necessary search-wide policy.
- `src/abort.ts` supplies the timeout/parent-cancellation pattern used by the HTTP backends.
- Operational failures are not cached. `ok` and legitimate `no_results` outcomes are cached.
- Fallback runs after an explicit backend error. Legitimate `no_results` stops the backend sequence.

The native backend must fit these boundaries rather than duplicating them.

### Behavior currently consumed from the external command

The package currently depends only on a narrow subset of behavior:

- execute a DuckDuckGo web search;
- apply region, safe-search, and recency options;
- bound returned result count;
- receive ordered title, URL, and abstract/snippet fields;
- distinguish success, legitimate emptiness, malformed output, blocking, rate limiting, timeout, cancellation, and generic backend failure.

The command adapter currently produces the package's standard outcome envelope and uses `ddgr` provenance. That identity becomes `duckduckgo`.

### DuckDuckGo HTTP evidence

The inspected implementation and a live request from this environment confirm an initial search request to:

```text
POST https://html.duckduckgo.com/html
```

with URL-encoded form fields:

```text
q=<query>
b=
df=<empty or d|w|m|y>
kf=-1
kh=1
kl=<region>
kp=<safe-search value>
k1=-1
```

A live response returned HTTP 200 HTML containing ten ordered web result structures with:

- `.links_main` result bodies;
- `.result__title` headings with linked titles;
- `.result__snippet` snippet elements containing nested markup.

Pagination state was also present, but the extension's public tool has no page/cursor contract and does not require it.

### Package and license facts

- `pi-web-search` is MIT licensed.
- The available upstream reference is GPLv3.
- `jsdom` is already a declared runtime dependency and is already used by the package.
- `package.json` contains no runtime dependency on the external command.
- The native implementation can therefore avoid dependency and lockfile changes.

## Scope

### In scope

- Native DuckDuckGo POST request construction.
- Region, safe-search, recency, and maximum-result mapping.
- Bounded HTML response reading.
- Structural extraction of ordered web results.
- Safe destination URL normalization.
- Structured HTTP, transport, timeout, blocking, parsing, and empty-result outcomes.
- Registration under `duckduckgo` and the default order `duckduckgo`, then `searxng`.
- Removal of subprocess execution plumbing used only by the superseded backend.
- Focused tests, fixture-like inline HTML, and updates to existing integration tests.
- README updates describing the native service-free backend and its limitations.
- A live smoke attempt after deterministic validation.

### Non-goals

- Instant answers.
- News search modes.
- Pagination or next/previous state.
- Browser opening or URL handlers.
- Interactive prompts or REPL behavior.
- Terminal formatting or color.
- Bang handling.
- Shell completion.
- Dedicated site-search options beyond ordinary query syntax.
- Proxy configuration specific to this backend.
- A standalone DuckDuckGo library or new package.
- A new public search tool or request field.
- Changes to Brave, SearXNG, or document-tool behavior.
- Anti-bot evasion.
- Compatibility with the removed backend name or setup.

## Target architecture

### 1. HTTP backend authority

Create `src/search/duckduckgo.ts`.

It owns:

- endpoint and ordinary request headers;
- form-body construction;
- injected `fetch` and clock dependencies;
- timeout and parent-signal handling;
- HTTP status classification;
- content-type and response-size enforcement;
- translation from parser output to `OutcomeEnvelope<SearchOutcomeData>`;
- `duckduckgo` provenance.

It must not own:

- cache policy;
- fallback policy;
- process-wide rate limiting;
- final model-visible bounds;
- DOM parsing details;
- subprocess execution.

Follow the dependency-injection shape used by `BraveBackend` and `SearxngBackend`:

```ts
interface DuckDuckGoDependencies {
  fetch: typeof globalThis.fetch;
  now(): number;
}
```

`DuckDuckGoBackend` implements `SearchBackend` and uses default dependencies only at normal runtime.

### 2. Structured parser authority

Create `src/search/duckduckgo-parser.ts`.

This module owns pure response interpretation:

- parse HTML with `JSDOM`;
- identify challenge/block evidence;
- identify a recognizable search-result page;
- find ordered result containers;
- extract title, raw destination, and snippet;
- normalize whitespace;
- normalize and validate destination URLs;
- return structured results or a narrow parser classification.

It must not import Pi APIs, perform HTTP requests, manage timeouts, know about fallback order, or format model-visible output.

A suitable internal return shape is:

```ts
type DuckDuckGoParseResult =
  | { kind: "results"; results: SearchResult[] }
  | { kind: "no_results" }
  | { kind: "blocked" }
  | { kind: "invalid"; message: string };
```

The exact internal type name is implementation discretion. The distinctions are not.

### 3. Existing orchestration authorities

Keep these responsibilities where they are:

- `src/tools/search-web.ts`: public registration, request normalization, hard caps, output bounds.
- `src/search/service.ts`: cache, limiter, coalescing, fallback, attempt provenance.
- `src/contracts.ts`: public types and stable operational error vocabulary.

Do not create another orchestration layer.

## Request contract

### Endpoint and method

```text
POST https://html.duckduckgo.com/html
Content-Type: application/x-www-form-urlencoded
```

Construct the body with `URLSearchParams`. Query input remains data in the `q` field. There is no shell, argument parser, or string-built command.

### Form mapping

| Normalized request value | Form value |
| --- | --- |
| `query` | `q=<query>` |
| fixed initial-page value | `b=` |
| no `timeRange` | `df=` |
| `day` | `df=d` |
| `week` | `df=w` |
| `month` | `df=m` |
| `year` | `df=y` |
| fixed result behavior | `kf=-1` |
| fixed HTTPS behavior | `kh=1` |
| no `region` | `kl=us-en` |
| supplied `region` | `kl=<trimmed region>` |
| safe search on | `kp=1` |
| safe search off | `kp=-2` |
| fixed ad behavior | `k1=-1` |

The tool normalizer already supplies `safeSearch: "on"` unless explicitly off. The backend should nevertheless treat an omitted value as on to keep the backend safe when tested or called directly.

### Headers

Send:

- a stable, ordinary browser `User-Agent`;
- `DNT: 1`;
- an HTML-compatible `Accept` value.

Let `fetch` set the correct form content type for `URLSearchParams`, or set the exact standards-compliant header explicitly. Do not rotate or randomize headers.

### Result limit

`limit` means the maximum returned items, not a guarantee that the backend will produce that many.

For one initial HTML page:

1. parse valid results in source order;
2. return at most `request.limit ?? 5`;
3. do not fetch additional pages to fill a larger limit;
4. leave final configured hard caps and output byte limits to the tool layer.

This intentionally keeps pagination out of scope.

## Parsing contract

### Result containers

Use ordered `.links_main` result bodies as the primary extraction unit. For each recognized container:

1. Find `.result__title a[href]`.
2. Extract the anchor's text content as the title.
3. Read the raw `href` attribute for URL normalization.
4. Find `.result__snippet` and extract its full text content, including text nested in elements such as `<b>`.
5. Permit an empty snippet when title and URL are valid.
6. Preserve source order.

Do not use display-domain text as the destination URL.

### Text normalization

For title and snippet:

- decode entities through the DOM parser;
- collapse consecutive Unicode whitespace to one ASCII space;
- trim leading and trailing whitespace;
- require a nonempty normalized title;
- let existing tool-layer character and byte bounds perform final truncation.

Do not add terminal-oriented wrapping or presentation text.

### URL normalization

Implement a pure helper in the parser module or a narrowly focused adjacent helper.

It must:

1. Resolve protocol-relative and relative links against the DuckDuckGo origin.
2. Recognize direct destination links.
3. Unwrap known DuckDuckGo redirect links carrying a destination in `uddg`.
4. Support the older redirect shape carrying a destination in `q` before an `sa` parameter when encountered.
5. Decode the destination once through standards-based URL/query parsing rather than repeated speculative decoding.
6. Require final `http:` or `https:` protocol.
7. Reject embedded username/password credentials.
8. Reject DuckDuckGo internal search/navigation links as results.
9. Preserve legitimate path, query, and fragment content.
10. Never fetch or probe the destination during search.

A recognized result container with a missing, malformed, unsafe, or internal-only destination is malformed input, not a result to return silently.

### Result-page recognition

The parser must not equate arbitrary HTML with an empty result set.

Classify as:

- `results` when recognized result containers yield a valid nonempty ordered list;
- `no_results` when the document is recognizably a DuckDuckGo search response but has no result containers and no challenge evidence;
- `blocked` when narrowly recognized challenge/anomaly elements or clearly identified unusual-traffic text are present outside ordinary results;
- `invalid` when the document is unrelated, structurally incomplete, or contains malformed result containers.

Use structural markers from the search form/results shell to recognize a genuine empty page. Define the exact markers in deterministic tests. Do not classify based only on page title or hostname-like text.

Challenge detection must inspect dedicated page-level elements or page-level messages. A normal result whose title or snippet mentions CAPTCHA, blocking, anomalies, or rate limits must remain a normal result.

## Backend outcome contract

Every backend-produced outcome must retain:

```ts
operation: "search_web"
data: { query: request.query, results: [...] }
provenance: {
  backend: "duckduckgo",
  durationMs,
  cache: { status: "miss" }
}
```

The service will add attempt history, fetched time, fallback warnings, and final cache state.

### Success

- Valid nonempty parsed results: `status: "ok"`.
- Recognized genuine empty page: `status: "no_results"`.
- Keep summaries concise and backend-specific.

### HTTP status classification

Classify before reading/parsing a normal response body:

| HTTP response | Operational result |
| --- | --- |
| `202` | `blocked`, retryable |
| `403` | `blocked`, retryable |
| `429` | `rate_limited`, retryable, with usable `retryAfterMs` when supplied |
| `500`–`599` | `backend_failed`, retryable |
| other non-success | `backend_failed`, non-retryable unless concrete evidence supports retry |

Use the existing `Retry-After` parsing pattern from `SearxngBackend`: accept nonnegative seconds or an HTTP date, then clamp to a nonnegative millisecond delay.

Do not include raw response bodies or arbitrary server diagnostics in summaries.

### Transport errors

Map known fetch/cause codes to safe messages in the same style as the other HTTP backends:

- refused connection;
- hostname resolution failure;
- unreachable network/host;
- reset connection;
- generic request failure.

Use `fetch_failed`, retryable. Do not surface raw thrown messages, URLs containing unexpected data, or nested error objects.

### Timeout and cancellation

Use `createAbortScope(context.signal, context.timeoutMs)` around fetch and body reading.

- Parent abort: rethrow the parent reason so tool cancellation is preserved.
- Backend timeout: return retryable `timeout`.
- Always clean up listeners and timer in `finally`.

### Content handling

Use a 2 MiB response ceiling, matching the existing HTTP search backends.

- Reject a finite `Content-Length` above the ceiling before body reading.
- Measure actual UTF-8 body bytes after reading and reject overflow.
- Overflow is `parse_failed`, non-retryable.
- Accept HTML and XHTML content types.
- A present incompatible content type is `parse_failed`.
- A missing content type may proceed to parsing but must satisfy structural recognition.
- A parser `blocked` classification becomes retryable `blocked`.
- A parser `invalid` classification becomes non-retryable `parse_failed`.

## Integration and removal

### Public backend identity

In `src/contracts.ts`:

```ts
export type SearchBackendName = "duckduckgo" | "searxng" | "brave";
```

Do not include the removed identifier anywhere in this union.

In `src/config.ts`:

- default to `["duckduckgo", "searxng"]`;
- accept only `duckduckgo`, `searxng`, and `brave`;
- reject unknown values normally;
- add no migration or special legacy error path.

### Tool registration

In `src/tools/search-web.ts`:

- register `DuckDuckGoBackend` under `duckduckgo`;
- inject the existing `fetch` and `now` dependencies;
- remove `ExecResult`, command-executor types, `execute`, and `pi.exec` wiring used only for the external process;
- leave request normalization, descriptions, prompt guidance, and output bounding unchanged except for backend-name text.

### Shared payload validation

`src/search/validation.ts` currently contains command-JSON validation alongside Brave and SearXNG validation.

- Remove the superseded command payload parser.
- Keep Brave and SearXNG parsing behavior unchanged.
- Put native HTML parsing in `duckduckgo-parser.ts`; do not make the shared JSON validator own DOM behavior.
- Share a small URL-safety helper only if doing so is mechanically narrow and does not risk changing Brave or SearXNG behavior. Duplication of a few validation lines is preferable to an unrelated refactor.

### Deletion

After the native backend and its tests pass in integrated form:

- delete `src/search/ddgr.ts`;
- delete `test/ddgr.test.ts` after equivalent native coverage exists;
- remove the old payload-validation tests;
- remove all command-executor test doubles and tool dependencies;
- remove all user-facing installation, PATH, Python, command version, and external-executable troubleshooting material;
- remove all old backend identifiers in configs, examples, summaries, provenance expectations, and tests.

Do not leave a dead module, commented implementation, compatibility branch, deprecated type, alias, or historical explanation in runtime code or README.

The plan may retain historical evidence because it is the execution authority. The delivered runtime, tests, package metadata, and README must not.

## Exact file scope

### Create

- `src/search/duckduckgo.ts`
- `src/search/duckduckgo-parser.ts`
- `test/duckduckgo.test.ts`
- `test/duckduckgo-parser.test.ts`

The implementation owner may combine parser and backend tests if that materially improves clarity without weakening coverage. Keep production HTTP and parser modules separate.

### Delete

- `src/search/ddgr.ts`
- `test/ddgr.test.ts`

### Modify

- `src/contracts.ts`
- `src/config.ts`
- `src/search/validation.ts`
- `src/tools/search-web.ts`
- `test/config.test.ts`
- `test/payload-validation.test.ts`
- `test/search-service.test.ts`
- `test/search-tool.test.ts`
- `README.md`

Other files may be changed only when typecheck or tests show a direct backend-name reference within this approved scope. Report each additional file and the exact reason. Do not modify document implementation, unrelated plans, sibling packages, the root package manifest, or the root lockfile.

`package.json` should not require a content change. If implementation appears to require one, stop and explain why before adding a dependency or changing packaging.

## Test requirements

### Parser tests

Use small deterministic HTML strings or fixtures. Cover:

1. One direct result with title, URL, and snippet.
2. Multiple results preserve document order.
3. Nested elements and entities contribute correctly to text content.
4. Unicode and repeated whitespace normalize deterministically.
5. Missing snippet yields an empty snippet.
6. Direct absolute HTTP and HTTPS destinations.
7. Protocol-relative and relative redirect links.
8. `uddg` destination unwrapping.
9. Older `q`/`sa` destination unwrapping.
10. Query strings and fragments survive normalization.
11. Non-HTTP schemes are rejected.
12. Embedded credentials are rejected.
13. Internal search/navigation links are rejected.
14. Missing/blank title is malformed.
15. Missing/malformed URL is malformed.
16. Recognized empty search HTML becomes `no_results`.
17. Unrelated or incomplete HTML becomes invalid.
18. Dedicated challenge HTML becomes blocked.
19. Ordinary result text mentioning a challenge term is not a false block.
20. Result limiting preserves the first N source-ordered results.

Do not copy a large upstream response or licensed parser fixture. Keep fixtures minimal and purpose-built from observed public markup structure.

### Backend tests

With injected `fetch`, verify:

1. Exact endpoint and POST method.
2. Form content type.
3. Query remains one encoded `q` field despite quotes, option-like prefixes, shell metacharacters, newlines, and Unicode.
4. Omitted region sends `us-en`.
5. Supplied region is preserved.
6. Safe search on/off maps to `1`/`-2`.
7. Each recency value maps to `d`/`w`/`m`/`y`; omission sends empty `df`.
8. Fixed form fields are present.
9. Stable ordinary headers are present.
10. Valid HTML returns bounded `ok` data and `duckduckgo` provenance.
11. Recognized empty HTML returns `no_results`.
12. HTTP 202 and 403 return retryable `blocked`.
13. HTTP 429 returns retryable `rate_limited` and parses usable retry guidance.
14. HTTP 5xx and other failures map as specified.
15. Known transport error causes map to safe messages.
16. Unknown thrown details are not exposed.
17. Incompatible content type is rejected.
18. Declared and actual response sizes above 2 MiB are rejected.
19. Parser invalid/block classifications translate correctly.
20. Backend timeout covers fetch and body reading.
21. Parent cancellation propagates its reason.

### Existing integration behavior

Update existing tests to use `duckduckgo`, while preserving proof that:

- fallback occurs only after an operational error;
- legitimate `no_results` does not fall through;
- local rate limiting dispatches no backend;
- cache hits occur before limiting/dispatch;
- identical in-flight calls coalesce;
- `forceRefresh` bypasses completed cache entries but not limiting;
- operational errors are not cached;
- provenance and warnings identify backend attempts;
- model-visible results and details remain bounded;
- Brave and SearXNG still work unchanged.

The registered-tool test must exercise a native DuckDuckGo response without any command executor dependency.

## Documentation and packaging

Rewrite `README.md` so users see a native `duckduckgo` backend:

- dependency table: outbound HTTPS only, no external executable;
- default order: `duckduckgo`, then `searxng`;
- backend configuration examples: `duckduckgo`;
- fallback example: `duckduckgo` to `searxng`;
- troubleshooting: direct blocking/rate limiting/timeout/parse behavior;
- privacy: the query and caller network information go directly to DuckDuckGo;
- requirements: no separate command or Python installation;
- limitations: HTML endpoint availability and transient blocking are not guaranteed.

Do not include migration instructions, old configuration names, or historical notes.

No new package dependency, lockfile change, bundled executable, postinstall step, download step, or separate license file is expected.

## Implementation sequence

1. Add the focused parser and deterministic parser tests.
2. Add the native HTTP backend and deterministic backend tests.
3. Change backend identity, configuration, and tool registration to `duckduckgo`.
4. Update service/tool/config tests and remove command-payload tests.
5. Run targeted native tests and typecheck while the old files are still available for direct comparison only.
6. Delete the superseded backend, its tests, and command-execution plumbing.
7. Rewrite README sections and examples.
8. Run complete package validation.
9. Run a targeted old-reference search excluding this plan artifact.
10. Attempt a bounded live native smoke search.
11. Inspect the entire child-repository diff before review or commit.

The final change should be presented as one coherent replacement, not as a compatibility migration.

## Validation

From `packages/pi-web-search`, run the package's required independent checks:

```bash
npm run typecheck
npm run format
npm test
git diff --check
```

`npm run format` writes package files. Inspect its diff and ensure it changed only intentional files. Do not run the superproject-wide formatter.

Run focused tests during development, but focused tests do not replace the full package suite.

### Reference removal check

Search the package case-insensitively for the removed executable/backend name while excluding:

- this plan artifact;
- prohibited planning artifacts;
- `.git`;
- `node_modules`;
- generated/untracked build output.

The final runtime source, tests, README, and package metadata must return no matches.

Also confirm there is no remaining `pi.exec`, command-executor type, PATH probe, version probe, or subprocess-only dependency injection in the search tool unless another approved feature genuinely uses it.

### Live smoke acceptance surface

When outbound networking is available, invoke the native backend or registered `search_web` tool with one narrow query and a small limit.

Acceptable evidence:

- `status: "ok"` with bounded title/URL/snippet results and `provenance.backend: "duckduckgo"`; or
- an accurately classified operational result caused by live service blocking/rate limiting.

A live operational block does not invalidate deterministic request/parser tests, but it must be reported faithfully. Do not retry aggressively.

No subprocess should be invoked during the smoke test.

## Stop conditions

Stop and return for a decision if:

- the endpoint requires a materially different public request contract;
- fulfilling the core path requires pagination;
- a new runtime dependency or package appears necessary;
- implementation would copy/adapt nontrivial GPL source;
- safe URL handling would require non-HTTP schemes or embedded credentials;
- challenge handling would require anti-bot evasion;
- genuine empty results cannot be distinguished deterministically from malformed/block pages;
- cache, fallback, limiter, provenance, or outcome contracts would need material changes;
- Brave, SearXNG, or document behavior would need modification;
- changes outside the exact package/file scope become necessary;
- verification exposes unrelated dirty changes that cannot be isolated.

## Completion criteria

Implementation is complete only when:

- DuckDuckGo search runs through native TypeScript `fetch` and HTML parsing;
- no external command, Python runtime, PATH lookup, or version probe is required;
- the only public backend identity is `duckduckgo`;
- the default backend order is `duckduckgo`, then `searxng`;
- query, region, safe-search, recency, and limit behavior have deterministic coverage;
- results are ordered, machine-structured, whitespace-normalized, and URL-safe;
- response size, HTTP failures, transport failures, blocking, rate limiting, timeout, cancellation, malformed HTML, and genuine emptiness have structured coverage;
- existing cache, limiter, fallback, provenance, output-bounding, Brave, and SearXNG tests remain green;
- superseded source, tests, execution plumbing, configuration identifiers, README text, and package references are removed;
- no new dependency or package was introduced;
- typecheck, formatting, full tests, diff check, and reference-removal check pass;
- live smoke evidence is recorded or an environment limitation is reported;
- the child repository diff contains only intentional work for this track.
