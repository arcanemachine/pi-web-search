# Summarizer Follow-up Implementation Plan

## Lifecycle

Temporary executable follow-up plan. Delete this file after the work is implemented, verified, documented in maintained sources, accepted as required, and ready for commit. Do not create a replacement TODO.

This file does not replace the existing `PLAN.SUMMARIZER.md`; it records the user-approved post-implementation changes that currently supersede several decisions in that original plan. Reconcile the maintained plan during closeout before deleting this follow-up.

## Current State

The initial `summarize_url_content` implementation is already integrated, but not committed, in the child repository's main checkout.

Current verified behavior includes:

- `summarize_url_content` uses isolated `ctx.modelRegistry.complete()` requests;
- a configured `summarizerModel` is used exactly, with active-model fallback only when no model is configured;
- the actual provider/model is returned in generation metadata and visible output;
- normalized snapshots are reused while generated summaries are not cached;
- nested inspection is restricted to snapshot-bound `read_document` and `grep_document`;
- bounded failures do not return partial generated prose as success;
- the minimum supported Pi version is `0.84.1`;
- the integrated root lockfile contains only the approved `pi-web-search` Pi version update;
- deterministic main-checkout validation passed with 140 tests;
- a controlled live smoke test passed with `openai-codex/gpt-5.6-luna`;
- `TODO.SUMMARIZER.md` is already deleted and must remain deleted;
- stronger agent-driven research guidance is already present in the working tree: agents should prefer summarization when semantic understanding of one page is needed, use read for exact source, use grep for literal evidence, and avoid reading first merely to decide whether to summarize.

The working tree also contains unrelated state that must remain untouched, including the untracked bot-detection plan and the unrelated modified `packages/pi-model-switcher` submodule.

## User-Approved Follow-up Changes

Implement all three changes below as one coherent summarizer follow-up.

### 1. Summarization enabled by default

Change `summarizationEnabled` from default `false` to default `true`.

When effective configuration is true:

- `summarize_url_content` is active and appears in the active tool set/system prompt;
- its strong semantic-consumption guidance applies;
- direct execution uses the existing configured/active model behavior.

When effective configuration is false:

- retain the registered tool definition internally so reloads can reactivate it without rebuilding extension architecture;
- remove `summarize_url_content` from Pi's active tool set using the current active list plus/minus this one tool;
- therefore remove the tool and its own prompt guidance from the effective system prompt;
- preserve every unrelated active or inactive tool choice;
- a direct programmatic call, if one bypasses active-tool selection, still returns the existing explicit disabled failure;
- `/reload` or restart is the supported way to apply the uncommon toggle, and system-prompt/prompt-cache invalidation from that toggle is an accepted compromise.

Do not make enablement a public tool parameter.

Guidance in still-active tools must be conditional enough not to direct an agent toward an unavailable tool. Use wording such as “when `summarize_url_content` is available” or “when summarization is enabled” in read/search/grep guidance. Keep the strong default preference when the summarizer is available.

### 2. Configurable summarizer thinking level

Add this optional package setting:

```json
{
  "pi-web-search": {
    "summarizerThinkingLevel": "low"
  }
}
```

Accepted values:

- `off`
- `minimal`
- `low`
- `medium`
- `high`
- `xhigh`
- `max`

Behavior:

- the setting is configuration-only and is not exposed as a `summarize_url_content` argument;
- when absent, preserve current provider/model default behavior by omitting an explicit thinking option;
- when present, apply it only to isolated nested summarizer model calls;
- never inherit or silently copy the parent session thinking level;
- do not silently ignore an explicitly configured level;
- include the effective configured level in successful generation metadata and visible maintained documentation;
- preserve usage accounting, including reasoning tokens reported by the provider.

The current approved implementation target is the direct-completion API and the configured Luna/OpenAI-Codex path. Map Pi-style levels to raw direct-completion `reasoningEffort` for model APIs that explicitly support reasoning effort, including:

- `openai-codex-responses`;
- `openai-responses`;
- `azure-openai-responses`;
- `openai-completions`;
- another API only if its installed Pi `0.84.1` type/runtime implementation demonstrably accepts the same reasoning-effort option.

Mapping:

- on OpenAI Codex Responses, `off` maps to `reasoningEffort: "none"`;
- on other supported effort APIs, `off` omits reasoning effort;
- all non-off levels map to the same-named reasoning effort;
- let the installed Pi provider implementation apply the model's `thinkingLevelMap` where it already does so;
- if a non-off level is configured for a model whose metadata says it is non-reasoning, return a clear bounded availability/configuration failure before provider dispatch;
- if a level is configured for an unsupported raw model API, return a clear bounded failure before provider dispatch instead of ignoring it or adding an unapproved provider-specific approximation.

Do not replicate Pi's provider-specific simple-stream policy matrix, add thinking token-budget settings, import `@earendil-works/pi-ai` as a direct runtime dependency, access private `ModelRegistry` fields, introduce an `AgentSession`, or switch away from the approved direct-completion mechanism. If Luna cannot receive the exact configured effort through `ModelRegistry.complete()` and the verified `reasoningEffort` option, stop and report the incompatibility.

Recommended user example:

```json
{
  "pi-web-search": {
    "summarizationEnabled": true,
    "summarizerModel": "openai-codex/gpt-5.6-luna",
    "summarizerThinkingLevel": "low"
  }
}
```

Even though enablement defaults true, retain it in a full explicit example for readability.

### 3. Human-readable Markdown for `read_url_content`

The current successful `read_url_content` model-visible `content` is a pretty-printed JSON envelope. This makes normalized content appear as an escaped JSON string and is unnecessarily difficult for humans and agents to read.

Change only the model-visible/display `content` for `read_url_content` to human-readable Markdown. Preserve structured `details` as the bounded machine-readable outcome envelope.

#### Successful reads

The primary visible body must be the normalized source itself, not a JSON serialization containing `data.content`.

Rendering rules:

- normalized HTML and Markdown content should render directly as Markdown;
- JSON content should be rendered in a fenced `json` block so indentation and syntax remain readable;
- plain text should be rendered directly when safe and readable or in a fenced `text` block when fencing is needed to preserve structure;
- XML or other code-like native content may use an appropriate fenced block based on normalized content type;
- choose a fence longer than any matching fence run in the source so source content cannot prematurely close it;
- do not synthetically escape newlines into `\n` sequences;
- do not add line numbers to every source line;
- avoid duplicating a title heading when the normalized source already contains it.

After the source, add a compact Markdown metadata footer sufficient for continued agent operation. Include only useful fields:

- final source URL;
- returned normalized character range and total;
- whether the source/page is truncated;
- `nextCursor` when continuation is available;
- concise warnings when present.

Do not dump the full provenance/details envelope into visible Markdown. Full structured provenance remains in `details`.

The cursor must remain model-visible; otherwise an agent cannot continue a long exact read from ordinary tool content.

#### Read errors

Render a concise human-readable Markdown error in `content`, for example:

```markdown
**read_url_content failed:** <safe message>

Error code: `invalid_request`
```

Keep the full bounded structured error in `details`. Never include unsafe raw provider/network exception text.

#### Output bounds

Preserve all existing protocol bounds.

- Build structured details with the existing document outcome formatter.
- Replace only the visible `content` after structured details have been successfully bounded.
- Measure the final rendered Markdown bytes, including fences and metadata.
- If it exceeds `DOCUMENT_OUTPUT_BUDGET`, reduce the page content through the existing page-budget loop and rerender; do not byte-truncate a Markdown fence or cursor footer into invalid/incomplete output.
- Continue to fail with an invariant error if even minimum source content plus required metadata cannot fit.
- Do not change cursor semantics, source cache behavior, snapshot keys, page boundaries, normalized content, or `details` contracts.

This follow-up is scoped to `read_url_content`. Do not opportunistically redesign the visible output of search, grep, or summarize tools. A future consistency pass may be considered separately if the read result proves useful.

## Required Source Changes

Expected files:

- `src/config.ts`
  - default summarization to true;
  - add `SummarizerThinkingLevel` type or equivalent;
  - add optional `summarizerThinkingLevel` to configuration;
  - validate the exact enum and precedence;
  - preserve unknown-key rejection.

- `src/contracts.ts`
  - add optional thinking-level metadata to `SummaryGeneration`;
  - avoid unrelated outcome changes.

- `src/tools/document-tools.ts`
  - synchronize only `summarize_url_content` membership in Pi's active tool list after registration/config refresh;
  - preserve all unrelated active tools.

- `src/tools/summarize-url-content.ts`
  - map configured thinking level for supported direct-completion APIs;
  - fail explicitly for unsupported/non-reasoning models when needed;
  - pass options to every nested completion turn consistently;
  - report configured thinking level in generation metadata;
  - keep schema and nested tools unchanged;
  - make read/summarize guidance conditional on availability where necessary.

- `src/tools/read-url-content.ts`
  - render successful/error visible content as bounded Markdown;
  - keep structured details and cursor behavior unchanged;
  - make summarizer guidance conditional on availability.

- `src/tools/grep-url-content.ts` and `src/tools/search-web.ts`
  - only the minimal “when available/enabled” wording needed for the disabled-tool case;
  - preserve the already-approved strong agent-driven summarization preference.

- `src/tools/document-shared.ts`
  - add a small focused formatter/helper only if it keeps read formatting clear;
  - do not change generic document details semantics for grep/summarize.

- `README.md`
  - state summarization defaults enabled;
  - explain that disabling removes it from the active system prompt after reload;
  - document `summarizerThinkingLevel`, accepted values, omission behavior, supported API limitation, and example;
  - show human-readable read output behavior and distinguish visible Markdown from structured details;
  - preserve privacy/cost guidance and strong agent-driven consumption policy.

- `PLAN.SUMMARIZER.md`
  - reconcile original superseded decisions: default disabled, invariant active-tool membership, no `setActiveTools`, and lack of thinking-level configuration;
  - record the final accepted post-implementation behavior;
  - do not retain transient session names or chatter.

- tests described below.

- `PLAN.SUMMARIZER.FOLLOWUP.md`
  - delete only at closeout after maintained sources contain the final decisions and validation is complete.

`TODO.SUMMARIZER.md` must remain absent.

## Deterministic Test Requirements

### Configuration

Test:

- `summarizationEnabled` defaults true;
- global/project override to false works;
- every accepted thinking level parses;
- invalid, blank, non-string, and unknown levels fail configuration validation;
- omitted level remains undefined;
- model and thinking settings merge independently through existing precedence.

### Active tool and system-prompt behavior

Extend controller harnesses with realistic `getActiveTools()` and `setActiveTools()` behavior.

Test:

- enabled default leaves/adds `summarize_url_content` active;
- disabled effective configuration removes only `summarize_url_content`;
- read, grep, search, built-ins, and unrelated extension tools retain their existing active/inactive choices;
- re-enabling adds the summarizer exactly once;
- repeated registration/reload is idempotent;
- the public summarizer definition/schema remains registered even while inactive;
- disabled direct execution still returns the bounded disabled error;
- active guidance says to prefer summarization;
- still-active read/search/grep guidance says “when available/enabled” and does not unconditionally direct the agent to an inactive tool.

Do not test prompt-cache internals. Active-tool membership/system-prompt inputs are the deterministic acceptance surface.

### Thinking level

Use the fake model registry; do not call a provider.

Test:

- omitted level sends no `reasoningEffort`;
- Luna/OpenAI-Codex `low` sends `reasoningEffort: "low"` on every nested model turn;
- Codex `off` sends `reasoningEffort: "none"`;
- configured level appears in generation metadata;
- configured level applies to configured-model and active-model fallback paths;
- unsupported raw API fails before `complete()`;
- non-reasoning model plus non-off level fails before `complete()`;
- no fallback or silent omission occurs;
- existing usage/reasoning-token accumulation remains correct.

### Human-readable read output

Test successful reads for:

- normalized HTML/Markdown appears as actual Markdown, not JSON-escaped `data.content`;
- native JSON appears in a valid fenced `json` block with real newlines;
- source containing backtick/tilde fences cannot close the chosen wrapper early;
- plain text remains readable;
- compact footer includes source URL and character range;
- `nextCursor` is visible when present and can still be used for continuation;
- no cursor is shown when none exists;
- warnings are bounded and human-readable;
- serialized `details` retain the existing data, provenance, bounds, and format fields;
- visible Markdown and serialized details both remain below 48 KiB;
- huge Unicode/single-line content triggers page-budget reduction rather than broken Markdown truncation;
- an error produces concise Markdown content and unchanged structured error details.

Existing read/grep snapshot sharing, cursor authentication, force refresh, cancellation, and pagination tests must remain green.

## Validation Sequence

Run in the integrated child main checkout:

```bash
npm run typecheck
npm run format
npm test
git diff --check
```

Then inspect:

- child status and diff scope;
- root lockfile remains unchanged by this dependency-free follow-up;
- unrelated bot-detection plan and model-switcher state remain untouched;
- no generated package lock or runtime data is tracked;
- no live provider call occurred during deterministic implementation.

A targeted Luna live test of `summarizerThinkingLevel` requires separate explicit approval because it consumes quota. State the exact model and possible cost before requesting that approval. Do not silently reuse the earlier live-test approval.

## Stop Conditions

Stop and return to the user if:

- Pi `0.84.1` cannot deactivate/reactivate only the summarizer without clobbering unrelated active tools;
- registered-tool replacement or reload semantics cannot reliably reflect the effective enabled setting;
- Luna does not receive `reasoningEffort` through the approved direct-completion API;
- implementing thinking levels requires a direct `@earendil-works/pi-ai` runtime dependency, private runtime access, `AgentSession`, RPC, subprocess, or a copied provider policy matrix;
- an unsupported provider would silently ignore the configured level;
- Markdown visible output cannot retain model-visible cursor continuation while staying bounded;
- structured `details`, snapshot, cursor, or cache contracts must change;
- another dependency/version/lockfile change is required;
- unrelated feature files would need modification.

## Completion and Cleanup

When implementation and deterministic validation are complete:

1. Present changed files, exact behavior, and verification evidence.
2. Request separate authorization for a Luna live thinking-level test if still needed.
3. Obtain user-facing acceptance or an explicit waiver before commit.
4. Reconcile maintained `PLAN.SUMMARIZER.md` and README with final accepted behavior.
5. Delete this `PLAN.SUMMARIZER.FOLLOWUP.md` file.
6. Run final diff/validation after deletion.
7. Do not commit without explicit authority.
8. Do not remove the summarizer worktree until changes are confirmed present and verified on main and the user explicitly authorizes teardown.
