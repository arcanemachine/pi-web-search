# TODO: Opt-in document summarizer

Delete this file when the summarizer is implemented and its maintained behavior is documented elsewhere.

## Goal

Add an opt-in child-agent summarization path to `read_url_content` without weakening the existing deterministic content and grep tools.

The intended workflow is:

1. Use summary output for a broad overview of an unfamiliar or long document.
2. Have the summary suggest literal terms that are relevant for verification.
3. Use `grep_url_content` for exact confirmation when the claim matters.
4. Continue to support direct bounded reading for manual inspection.

The raw document should remain in the child agent's context. The parent should receive a bounded result rather than every page the child inspected.

## Parent-facing request

Keep extraction scope separate from output behavior:

```ts
{
  url,
  mode: "main" | "full",
  output?: "content" | "summary",
  objective?: string
}
```

- `output` defaults to `"content"`.
- `objective` is optional. Without one, request a general high-level overview.
- Existing content cursors continue to apply to content output.
- `grep_url_content` remains a separate exact-evidence tool.

Do not add a separate public summarization tool unless implementation proves that the response contract cannot reasonably remain part of `read_url_content`.

## Reading policy

Add one configuration field:

```json
{
  "documentReadingPolicy": "read-only"
}
```

Allowed values:

- `read-only` — allow content output and reject summary output.
- `summary-only` — allow summary output and reject content output.
- `prefer-read` — allow both and guide the parent toward content/grep.
- `prefer-summary` — allow both and guide the parent toward summary followed by grep verification where appropriate.

Default to `read-only`, making child summarization explicitly opt-in. Invalid values must fail configuration validation. `grep_url_content` remains available under every policy.

Tool descriptions and prompt guidance must reflect the effective policy. Guidance should distinguish these cases:

- broad overview or unfamiliar document: summary
- known literal term, exact quote, or verification: grep
- small document or detailed inspection: content

## Child-agent execution

Create the normalized `DocumentSnapshot` through the existing `DocumentService` before starting the child. Bind the child to that exact snapshot; do not let it choose a URL or snapshot identifier.

The child receives only:

- the requested objective
- bounded source metadata and provenance
- access to the bound snapshot
- its time, turn, and content budgets

Use a configurable child-agent profile following the established `pi-subagent` approach:

- configurable agent/profile selection
- configured model
- configurable thinking level, with a documented inheritance/default rule
- optional extra prompt context
- recursion disabled

Preserve `pi-web-search` as an independently usable package. Reuse shared Pi mechanisms where available; do not create an undocumented runtime dependency on the sibling `pi-subagent` extension.

## Restricted child tools

Expose only three simple tools to the child:

```text
read_document
  optional continuation cursor only

grep_document
  literal query only

submit_summary
  one required result string only
```

The runner owns the snapshot identity and all limits. The child must not receive arbitrary network, filesystem, shell, project, or unrelated Pi tools. Reject every tool outside this allowlist.

`read_document` and `grep_document` should reuse the existing snapshot paging and matching behavior rather than introducing another document representation.

## Completion contract

Follow the proven simple completion-tool pattern in the adjacent agent extensions rather than designing a rich result schema.

`submit_summary` must:

- use an object schema with `additionalProperties: false`
- require exactly one string field named `result`
- trim and reject an empty result
- enforce the configured result bound
- treat an accepted tool call as authoritative
- terminate the child after successful acceptance

The child prompt should ask the single result string to contain:

1. a concise, objective-focused summary
2. relevant literal terms suitable for optional `grep_url_content` verification
3. material uncertainty or incomplete coverage

Do not split these into multiple tool fields. The reporting tool should be difficult for a weak child agent to misuse.

Relevant prior art:

- `../pi-subagent/src/index.ts`: child-only `subagent_complete`, authoritative matching tool-call capture, shutdown, model/thinking configuration, and interruption handling
- `../pi-subagent/src/index.test.ts`: completion correction/fallback, failure classification, thinking configuration, and timeout tests
- `../pi-supercompact/src/index.ts`: exact completion-call validation, tool blocking by workflow phase, bounded correction attempts, and recoverable state
- `../pi-supercompact/tests/index.test.ts`: invalid-response correction, bounded attempts, tool blocking, abort, and cleanup coverage

## Invalid completion and retries

Require `submit_summary` as the child's final action. Do not accept plain assistant prose as a successful summary.

Allow at most three correction attempts when the child:

- omits `submit_summary`
- supplies an empty or invalid result
- returns a truncated response
- returns an assistant error
- attempts a disallowed tool

Correction prompts should be short and state exactly what must be fixed. After the bounded attempts are exhausted, return an explicit operational failure. Do not silently substitute ambiguous prose.

Add a hard configurable timeout with parent abort propagation and child termination. A timeout, abort, or exhausted correction budget must settle exactly once and clean up child state. Do not automatically start a fresh child after a hard timeout in the initial implementation.

Do not cache generated summaries initially. Continue caching the normalized snapshot, so later parent grep calls can verify suggested terms without another fetch or normalization pass.

## Result and provenance

Return the accepted summary through the normal `read_url_content` outcome envelope with:

- the source snapshot's existing provenance and content hash
- the effective child agent/model information needed to explain how the summary was produced
- whether child coverage was bounded or incomplete, when known
- warnings for relevant clamping or partial-document conditions

Do not represent a child-agent summary as exact source text.

## Required tests

Cover at least:

- all reading-policy values and invalid configuration
- policy enforcement for content and summary output
- policy-specific parent prompt guidance
- snapshot reuse without a second fetch or normalization
- child access limited to its bound snapshot
- rejection of unrelated child tools
- successful `submit_summary` capture and termination
- empty, omitted, malformed, errored, and truncated completion behavior
- correction attempts capped at three
- timeout, parent abort, and one-shot cleanup
- configured agent/model/thinking selection
- summary failure without silent prose fallback
- ordinary content and grep behavior remaining unchanged

Use harness-driven tests patterned after the adjacent extensions. Add a small end-to-end child process test only if the implementation boundary makes it reliable and proportionate.

## Implementation boundary

Keep this work separate from HTML extraction and Markdown-renderer changes. The summarizer consumes the normalized snapshot those paths produce; it must not become another extractor or renderer.
