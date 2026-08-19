# Readability-Assisted HTML Normalization Plan

## Status

Ready for implementation after explicit execution approval.

This plan covers one focused change to HTML document normalization in `pi-web-search`: preserve deterministic, high-recall handling for explicitly scoped and structurally rich documents while using Mozilla Readability to clean weakly structured body-only pages.

The document summarizer described in `TODO.SUMMARIZER.md` is separate future work and is not part of this plan.

## Objective

Improve the Markdown returned by `read_url_content` and indexed by `grep_url_content` without replacing the current snapshot, paging, grep, or cache architecture.

The implementation must:

- reduce navigation, promotions, recommendations, comments, overlays, hidden SEO text, and other body-level boilerplate on weakly structured pages;
- preserve arbitrary technical-document recall when the HTML already exposes meaningful document structure;
- continue returning deterministic Markdown for selectors, full-document requests, and semantic roots;
- keep the runtime flow understandable as a short best-effort sequence rather than an extractor framework;
- continue using the existing `node-html-markdown` renderer in this phase;
- preserve the existing normalized-snapshot cache so extraction and rendering are paid only on a cache miss for a URL/mode/selector key.

## Current State

HTML normalization is implemented in `src/documents/markdown.ts`.

The current path:

1. parses static HTML with linkedom;
2. records title and client-rendered-shell indicators;
3. removes a fixed set of non-content elements;
4. selects an explicit selector, `body` for full mode, or `main`, `[role="main"]`, `article`, then `body` for main mode;
5. resolves supported links against the final URL;
6. converts the selected HTML to Markdown with `node-html-markdown`;
7. returns normalized content, extractor provenance, and warnings.

This already produces Markdown. The primary defect is the last-resort whole-body selection, not a raw-HTML response.

`DocumentService` performs fetch, normalization, UTF-8 bounding, line indexing, content hashing, and cache insertion once per normalized snapshot. `read_url_content` pages that snapshot. `grep_url_content` searches the same snapshot. The cache key includes normalized requested URL, document mode, and selector. Concurrent identical misses are coalesced.

This plan does not change those service-level responsibilities.

## Evidence and Rationale

A frozen 12-case corpus was evaluated under `/workspace/tmp/pi-web-search-extractor-comparison`. It contains controlled semantic, weakly structured, malformed, modern, and legacy fixtures plus real MDN, Python, Wikipedia, RFC 9110, Paul Graham, and Hacker News snapshots.

Material results:

- The exact current implementation completed 12/12 cases and retained all controlled required phrases.
- Current controlled forbidden-phrase leakage was 46.7%.
- Readability pipelines retained all controlled required phrases while reducing leakage to 13.3%.
- jsdom handled hostile and legacy table markup more usefully than linkedom when used with Readability.
- Defuddle and Trafilatura produced concise ordinary-page output but silently reduced RFC 9110 to a damaged section 6.4 fragment. They are not safe general extractors for these document tools.
- The benchmark-only custom Markdown serializer was much faster on large documents but flattened the Paul Graham essay and had compatibility defects. It is not production-ready.
- The existing `node-html-markdown` renderer preserves long-form prose more reliably but remains slow on very large documents and poor at layout tables. Those are separate renderer concerns.

Readability's ordinary-page omissions were mostly low-value metadata or structure: attribution, dates, duplicated introductory text, navigation controls, and some headings whose prose remained. Its RFC omission was materially different. On RFC 9110, all tested Readability/DOM/renderer combinations omitted approximately 13.4K source-text characters containing substantive sections about intermediaries, header fields, Date and Trailer, representation metadata, media types, language tags, intermediary risks, and IANA registrations.

RFC 9110 has no `main`, `[role="main"]`, or `article`, but it has extensive nested `<section>` structure. Paul Graham and Hacker News have neither semantic roots nor nested sections. A nested-section safeguard therefore preserves the technical standard without introducing byte thresholds, confidence scoring, document-type lists, or page-specific rules.

## Selected Runtime Flow

The implementation must use this selection order:

```text
explicit selector
  -> selected element

mode = full
  -> document body

mode = main
  -> main
  -> [role="main"]
  -> article
  -> structured document body when nested sections exist
  -> Readability result
  -> document body when Readability fails or returns no usable content
```

Every successful HTML branch then follows the same tail:

```text
selected/extracted HTML
  -> remove known non-content elements
  -> resolve supported links and image sources
  -> node-html-markdown
  -> normalize whitespace
  -> normalized snapshot service
  -> existing cache, paging, and grep behavior
```

This is a fixed sequence, not a registry of interchangeable strategies.

## Architecture Decisions

### 1. Use jsdom as the single HTML DOM implementation

Replace linkedom with jsdom for HTML parsing. Do not keep both DOM libraries in production.

Reasons:

- jsdom produced materially better Readability results on hostile legacy/listing markup, especially Hacker News;
- one DOM implementation is easier to reason about, type, test, and maintain than passing serialized fragments between two parsers;
- observed extraction performance is adequate for cache-miss work, while network latency and the existing Markdown renderer dominate many real requests;
- the normalized snapshot cache prevents repeated parsing and rendering for cache hits.

Static parsing must not enable script execution, resource loading, or browser hydration.

Use a bounded/silent jsdom virtual console so invalid page CSS or other jsdom diagnostics do not write uncontrolled noise to the extension process. Suppressing jsdom console diagnostics must not suppress operational errors returned by normalization itself.

### 2. Use Mozilla Readability only for weakly structured main-mode pages

Add `@mozilla/readability` and run it only when all of these are true:

- no explicit selector was supplied;
- mode is `main`;
- no `main`, `[role="main"]`, or `article` root exists;
- the document does not exhibit the structured-body safeguard described below.

Readability is a cleanup step for body-fallback candidates, not the universal extractor.

Use Readability defaults in the initial implementation. Do not add custom scores, character thresholds, class-name tuning, page-specific rules, or `isProbablyReaderable` gating without new evidence and approval.

Readability mutates its input document. Run it against a clone or an independently parsed jsdom document so a failed parse cannot destroy the deterministic body fallback. The implementation owner may choose cloning or a second jsdom parse based on the simplest reliable TypeScript implementation, provided:

- only jsdom is used;
- final URL resolution remains correct;
- scripts are not executed;
- failed or empty Readability output can still fall back to the cleaned body.

### 3. Preserve structured body-only documents

Before invoking Readability, detect whether the cleaned document contains a nested section:

```css
section section
```

If one exists, treat the body as an already structured document and skip Readability.

This is deliberately a semantic safeguard rather than a numeric heuristic. It protects sectioned standards such as RFC 9110 while allowing weak legacy prose and listing pages to use Readability.

Do not generalize this into a structure score in this phase. If the frozen corpus reveals that this exact safeguard is inadequate, stop and report the evidence rather than adding an unplanned heuristic chain.

### 4. Keep the existing Markdown renderer

Continue using `node-html-markdown` with the current options:

- fenced code style;
- `-` bullet marker;
- data images disabled;
- at most three consecutive newlines;
- native parser disabled;
- inline links enabled.

Do not implement layout-table linearization, a custom serializer, Turndown, worker-thread rendering, large-document streaming, or renderer-specific performance work in this change.

The HTML supplied by Readability must be wrapped or parsed into a complete jsdom body before link normalization and rendering. Do not rely on fragment placement behavior that can leave extracted nodes outside `document.body`.

### 5. Keep existing cache and tool contracts

Do not change:

- `DocumentService` cache keys;
- snapshot IDs or content hashes;
- cache TTL, entry, or byte semantics;
- in-flight coalescing;
- cursor encoding;
- read pagination;
- grep matching;
- public tool schemas;
- `mode: "main" | "full"` semantics;
- selector support;
- force-refresh behavior.

A cache miss still performs fetch and normalization once. A cache hit must continue avoiding fetch, DOM parsing, Readability, Markdown rendering, and line-index rebuilding.

### 6. Preserve best-effort fallback behavior

A Readability failure is not an HTML parse failure and must not make an otherwise readable document unavailable.

If Readability throws, returns `null`, produces empty HTML, or produces no usable rendered content:

- fall back to the cleaned body;
- retain a bounded diagnostic indicating main-content fallback;
- continue through the normal renderer.

The initial jsdom parse, explicit-selector validation, selector-not-found behavior, unsupported content-type behavior, JSON parsing, and Markdown-conversion failures must retain their existing operational-error classifications.

## Detailed HTML Processing Requirements

### Initial parse and metadata

For HTML and XHTML content:

1. Create a jsdom document with the final fetched URL as its base URL.
2. Do not enable script execution or remote-resource loading.
3. Capture the normalized document title before content selection.
4. Capture the original script count and client-shell marker before removing elements.
5. Preserve the existing client-rendered-shell warning logic unless jsdom compatibility requires a small mechanical adjustment.

The implementation must continue detecting the established shell markers:

- `#__next`
- `#app`
- `#root`
- `[data-reactroot]`
- `[data-react-root]`
- `[ng-version]`

### Non-content removal

Retain the current removal list unless a failing test or benchmark supplies concrete evidence that one entry must change:

- `script`
- `style`
- `template`
- `noscript`
- `iframe`
- `canvas`
- `svg`
- `form`
- `button`
- `input`
- `select`
- `textarea`
- `nav`
- `footer`
- `aside`

Apply the same removal policy to Readability output before Markdown rendering. Do not introduce broad class-name or visibility-style filtering in this phase.

Current explicit-selector behavior removes these elements before selector resolution. Preserve that behavior: a selector targeting a removed non-content element is not required to succeed.

### Explicit selector branch

When a selector is supplied:

- validate it through jsdom query selection;
- return `invalid_request` for syntactically invalid CSS selectors;
- return the established selector-not-found `parse_failed` response when no cleaned element matches;
- do not invoke Readability;
- do not let `mode` alter the selected element;
- resolve links and render the selected element only.

### Full mode branch

When no selector is supplied and mode is `full`:

- select the cleaned body, or document element only when no body exists;
- do not invoke Readability;
- preserve the existing meaning of full mode as the cleaned full document, not literal raw HTML including scripts/navigation/forms.

### Main semantic-root branch

When no selector is supplied and mode is `main`, select the first available root in this order:

1. `main`
2. `[role="main"]`
3. `article`

Use only the first matching element, consistent with current behavior. Do not invoke Readability after a semantic root is found, even if the root is small. This is the high-recall deterministic branch.

### Structured-body branch

When no semantic root exists, test for nested sections. If found:

- select the cleaned body;
- skip Readability;
- preserve the main-content-fallback diagnostic because extraction used the document body;
- identify the direct jsdom renderer path in extractor provenance.

Do not require a minimum number of sections or headings in this phase.

### Readability branch

When the page lacks a selector, semantic root, and nested sections:

- run Mozilla Readability against a safe jsdom document;
- accept only a non-empty result with non-empty content;
- prefer a non-empty normalized Readability title over the original title;
- do not add byline, excerpt, site name, language, or publication-time fields to `NormalizedDocument` in this change;
- reparse/wrap the returned HTML as a jsdom body;
- apply the fixed non-content removal list;
- resolve supported URLs against the final fetched URL;
- render through the common `node-html-markdown` path.

Readability output does not receive a `main_content_fallback` warning when accepted. Extractor provenance is sufficient to show that heuristic extraction was used.

### Final body fallback

If Readability is unusable:

- reconstruct or retain an unmutated cleaned document body;
- use the body, then the document element if necessary;
- emit the established main-content-fallback warning with wording that remains accurate for an ordinary body fallback;
- preserve client-shell warnings when their conditions are met.

### URL handling

Retain the current URL policy:

- leave fragment-only links unchanged;
- remove data image sources;
- allow absolute `http:` and `https:` URLs;
- allow `mailto:` only for links;
- remove unsupported or malformed schemes;
- resolve relative links and image sources against the final fetched URL.

Use attribute values after resolution; do not depend on jsdom property serialization implicitly making every relative URL absolute.

### Markdown fallback

Retain the current last-resort behavior after rendering:

- if Markdown is empty but selected text content is non-empty, return normalized text content;
- add the existing `markdown_fallback` warning;
- do not silently return empty content when source text was available.

## Extractor Provenance

Update HTML extractor identifiers so cached snapshot provenance distinguishes deterministic and Readability paths.

Recommended identifiers:

- `html:jsdom+node-html-markdown@2`
- `html:jsdom+readability+node-html-markdown@2`

Use the direct identifier for selector, full, semantic-root, structured-body, and final-body-fallback results. Use the Readability identifier only when accepted Readability content is rendered.

Do not encode transient package versions, benchmark names, or corpus-specific details into the extractor string.

## Dependencies and Packaging

From the superproject root, update the child package dependencies using pnpm's package filter so the standalone child manifest and root lockfile remain aligned.

Required dependency changes:

- remove `linkedom`;
- add `jsdom`;
- add `@mozilla/readability`;
- add `@types/jsdom` as a development dependency if required by the selected jsdom release and TypeScript configuration.

Use the benchmarked compatible lines as the initial candidates:

- `@mozilla/readability` 0.6.x
- `jsdom` 26.1.x

Do not add Defuddle, Trafilatura, Turndown, a browser runtime, or Python dependencies.

The child package must remain independently installable from its own `package.json`.

## Expected File Scope

### Required implementation files

- `package.json` — replace the DOM dependency and add Readability/jsdom typing dependencies.
- `src/documents/markdown.ts` — implement jsdom parsing, structured-body preservation, Readability fallback, common cleanup/rendering, provenance, and diagnostics.
- `test/document-normalization.test.ts` — cover every selection branch and material fallback.
- `README.md` — update documented main-mode behavior if the current text describes deterministic semantic/body selection.

### Superproject integration

- `/workspace/projects/pi/pnpm-lock.yaml` — dependency graph changes produced by filtered pnpm commands.
- `/workspace/projects/pi/packages/pi-web-search` — updated submodule pointer after the child commit.

### Files expected to remain unchanged

Unless implementation reveals a directly blocking contract issue, do not change:

- `src/documents/service.ts`
- `src/documents/cache.ts`
- `src/documents/types.ts`
- `src/documents/page.ts`
- `src/documents/match.ts`
- `src/tools/read-url-content.ts`
- `src/tools/grep-url-content.ts`
- `src/tools/schemas.ts`
- search backend or search tool files
- `TODO.SUMMARIZER.md`

If one of these must change, stop and explain the contract need before expanding scope.

## Code Organization

Keep this implementation small and direct.

`src/documents/markdown.ts` may remain the sole normalization module. Add small functions for responsibilities such as:

- jsdom document creation;
- fixed element removal;
- structured-body detection;
- Readability extraction;
- safe URL resolution;
- Markdown rendering.

Do not introduce:

- classes for extractor strategies;
- dependency-injection frameworks;
- plugin registries;
- confidence or scoring abstractions;
- generic pipelines intended for hypothetical future extractors;
- a second document representation.

If `markdown.ts` becomes difficult to follow after the focused change, one private `src/documents/html.ts` helper module is permitted, but splitting files is not a goal. Prefer clear local functions over a premature abstraction.

## Test Plan

Extend `test/document-normalization.test.ts` with focused inline fixtures. Tests should assert behavior and provenance rather than complete Markdown snapshots.

### Deterministic semantic root

Verify that a document with navigation and a real `main`:

- selects `main`;
- removes navigation/scripts;
- preserves headings, links, code, lists, and a data table;
- resolves relative links;
- uses the direct jsdom extractor identifier;
- does not invoke behavior attributable to Readability.

### Explicit selector

Verify:

- only the selected cleaned element is rendered;
- unrelated body content is absent;
- invalid CSS produces `invalid_request`;
- a missing selector produces the established `parse_failed` response;
- Readability is not used.

### Full mode

Verify that full mode:

- returns cleaned body content from multiple page regions;
- removes the fixed non-content elements;
- does not use Readability;
- uses direct extractor provenance.

### Weakly structured Readability page

Provide a sufficiently substantive div-based article with unrelated promotion/recommendation content and no semantic root or nested sections. Verify:

- primary paragraphs survive;
- obvious unrelated material is reduced or removed where Readability consistently does so;
- extractor provenance names Readability;
- output remains valid Markdown.

Avoid brittle assertions about every punctuation or whitespace choice made by Readability.

### Structured body-only document

Provide a body containing nested sections but no `main`, `[role="main"]`, or `article`. Verify:

- nested section content is preserved;
- Readability provenance is not used;
- body-fallback warning is present;
- headings and important technical phrases survive.

### Readability failure fallback

Use a minimal or unsuitable body for which Readability returns no usable content, or expose a narrow internal helper seam if required for deterministic testing. Verify:

- cleaned body text is preserved;
- the main-content-fallback warning is emitted;
- the direct extractor identifier is used;
- normalization does not throw solely because Readability could not extract content.

Do not add broad dependency injection solely for this test.

### Malformed HTML

Retain malformed-markup coverage under jsdom and verify useful content remains extractable.

### Client-rendered shell

Retain the existing shell warning behavior for a script-backed `#root`/`#app` page with very little static text. The presence or absence of a Readability result must not suppress the client-shell warning when the original indicators meet the established condition.

### URL safety

Ensure relative links are absolute and malformed, data, or unsupported schemes are removed according to current policy.

### Native formats

Retain current text, Markdown, JSON, XML/text-family, unsupported-content-type, and selector-on-non-HTML tests unchanged except for mechanical fixture organization.

### Service and cache regression

Existing service/tool tests must continue proving:

- one stable snapshot serves pagination;
- read and grep share normalized content;
- cache hits avoid repeat fetch/normalization work;
- force refresh and cursor expiration semantics remain intact.

Do not add duplicate cache tests unless the implementation changes those files, which is outside planned scope.

## Frozen-Corpus Verification

After package validation, exercise the updated implementation against the frozen corpus without network fetching.

Create or update a temporary candidate adapter that imports the implemented `normalizeDocument`. Do not overwrite the preserved pre-change baseline until comparison results have been recorded.

Required corpus outcomes:

- 12/12 cases produce non-empty output without adapter errors.
- Controlled required-phrase macro recall remains 100%.
- Controlled forbidden-phrase leakage materially improves from the current 46.7% baseline and should remain near the observed Readability 13.3% result.
- Explicitly inspect any controlled required loss or leakage above 20%; do not accept it mechanically.

Required outlier inspection:

### RFC 9110

Confirm the structured-body branch is used and the output retains, at minimum:

- Intermediaries;
- Header Fields;
- Date;
- Trailer;
- Representation Metadata;
- Media Type;
- Language Tags;
- Risks of Intermediaries;
- late IANA registration material;
- appendices and late document headings;
- representative tables, including Table 9 where present in the source.

Compare heading and output coverage with the exact current baseline. A substantial regression is a stop condition.

### Python pathlib

Confirm the existing `[role="main"]` path is used and important API definitions, examples, tables, portability notes, and later sections remain available.

### MDN Fetch API

Confirm the existing `main` path is used and introductory material, Interfaces, headers, Specifications, Browser compatibility, and See also content remain available to the extent preserved by the current deterministic path.

### Paul Graham

Confirm Readability is used, the full essay and notes remain present, and paragraphs are not flattened into one giant line.

### Hacker News

Confirm Readability is used and all ranked submissions remain usable with destination links and metadata. Reject a return to the six-line/giant-row damage seen in the linkedom integration.

### Hostile controlled fixtures

Confirm primary content remains while body-level promotions, comments, overlays, hidden SEO material, and unrelated recommendations are reduced. Inspect legacy/data-table preservation separately from layout-table noise.

## Performance Verification

Treat timings as directional, not as strict unit-test assertions.

Record extraction/render/total durations for the frozen corpus and compare material outliers with the established runs.

Expected characteristics:

- ordinary cache-miss pages remain in a practical subsecond range;
- cache hits do not rerun parsing or rendering;
- RFC rendering may remain several seconds because `node-html-markdown` is unchanged;
- no page should show an unexplained order-of-magnitude regression beyond known renderer behavior.

Do not add brittle wall-clock assertions to package tests.

If jsdom parsing causes a material operational regression that cannot be explained by the existing renderer, stop and report measurements before adding workers, streaming, alternate DOMs, or special cases.

## Documentation

Update `README.md` only where necessary to describe the durable user-facing behavior:

- main mode prefers explicit semantic roots;
- structured sectioned documents preserve their body;
- weakly structured pages use best-effort Readability extraction;
- full mode and selectors remain deterministic;
- JavaScript-dependent content is still not rendered.

Do not document benchmark implementation details, temporary paths, blind-review scores, or alternative extractors in the package README.

`PLAN.md` is the authority for this implementation scope. `TODO.SUMMARIZER.md` remains the authority for future child-agent summarization and must not be merged into this change.

## Implementation Sequence

1. Confirm clean child and superproject working trees and identify any unrelated state before editing.
2. Update child dependencies from the superproject root with filtered pnpm commands.
3. Replace linkedom parsing with a small jsdom document-construction helper.
4. Preserve metadata, shell detection, removal, selector, full, and semantic-root behavior.
5. Add the nested-section structured-body branch.
6. Add the Readability branch using an unmutated/independent document and a complete body wrapper for its result.
7. Add deterministic body fallback for Readability failure.
8. Unify safe URL resolution and `node-html-markdown` rendering across branches.
9. Update extractor provenance and bounded warnings.
10. Update focused normalization tests.
11. Update README behavior text if required.
12. Run package formatting, typecheck, and tests.
13. Run the frozen-corpus candidate and inspect required outliers.
14. Correct only in-scope extraction defects. Do not absorb renderer or summarizer work.
15. Review the complete child diff for scope, dependency declarations, generated files, and accidental formatting changes.
16. Commit the child package.
17. Validate from the superproject as required by project guidance.
18. Commit the root lockfile and updated submodule pointer in the superproject.

## Required Validation

Before the implementation is considered complete, run the child package's required checks:

```bash
npm run typecheck
npm run format
npm test
```

Also run:

```bash
git diff --check
```

Use package-scoped or filtered superproject commands. Do not run the destructive superproject-wide formatter.

The implementation report must state:

- changed files;
- dependency changes;
- package validation results;
- frozen-corpus counts and controlled recall/leakage;
- RFC, Python, MDN, Paul Graham, Hacker News, and hostile-fixture findings;
- any skipped verification;
- child and superproject commit status;
- whether any unrelated working-tree state remains.

## Acceptance Criteria

The work is ready for user acceptance only when all of the following are true:

1. Selector and full modes retain deterministic behavior and do not invoke Readability.
2. `main`, `[role="main"]`, and `article` roots retain deterministic behavior and do not invoke Readability.
3. Nested sectioned body documents skip Readability and preserve substantive RFC coverage.
4. Weakly structured body pages use Readability and materially reduce controlled boilerplate.
5. Readability failure safely falls back to cleaned body content.
6. All accepted HTML branches produce Markdown through the existing renderer.
7. Native non-HTML normalization is unchanged.
8. URL resolution and scheme filtering remain safe and deterministic.
9. Extractor provenance identifies direct versus Readability paths.
10. Existing snapshot, cache, cursor, pagination, and grep contracts remain unchanged.
11. All package checks pass.
12. The frozen corpus completes 12/12 cases with 100% controlled required recall.
13. Direct inspection finds no material technical-document recall regression.
14. README behavior is accurate without exposing temporary benchmark details.
15. No summarizer, custom renderer, browser rendering, or unrelated refactor is included.

## Stop Conditions

Stop implementation and return for a decision if:

- preserving RFC or comparable structured-document content requires more than the nested-section safeguard;
- jsdom cannot preserve selector/full/semantic behavior without material API changes;
- Readability requires custom scoring, page-specific rules, or another DOM implementation to meet acceptance criteria;
- the change requires modifying cache, cursor, tool schema, normalized snapshot, or grep contracts;
- acceptable Markdown requires replacing or materially modifying the renderer;
- a new runtime process, worker, browser, Python dependency, or external service appears necessary;
- controlled required recall drops below 100%;
- technical-document recall materially regresses despite the structured-body branch;
- dependency installation or standalone package behavior conflicts with the superproject's package rules;
- unrelated dirty working-tree state would be overwritten or committed.

## Explicit Non-Goals

This plan does not include:

- child-agent summarization;
- changes to `search_web` snippets or backends;
- JavaScript execution or browser rendering;
- Defuddle or Trafilatura integration;
- Markdown-renderer replacement;
- layout-table classification or linearization;
- large-document streaming or worker threads;
- persistent or cross-process caches;
- summary-result caching;
- new public tools or tool parameters;
- extraction confidence scores;
- user-configurable extractor strategies;
- page-specific compatibility rules;
- broad cleanup or refactoring outside document normalization.

These items require separate evidence, scope, and approval.
