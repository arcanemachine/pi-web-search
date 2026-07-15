# Agent Instructions

## Workflow

Commit when a task is completed.

## Active planning handoff (temporary)

Before implementing the current web-search improvements, read `RESEARCH.md` and `PLAN.md`. `RESEARCH.md` records the approved design baseline; `PLAN.md` is the executable plan and remains subject to user approval until its status says otherwise.

Artifact lifecycle:

1. Keep `RESEARCH.md` aligned with approved decisions.
2. Keep `PLAN.md` executable and current during implementation.
3. After implementation and verification, remove `RESEARCH.md`, `PLAN.md`, and this temporary section before completing the work.

## Deferred ideas

`IDEAS.DEFERRED.md` is intentionally outside the active workflow. Do not read, raise, research, or plan anything from it unless the user explicitly asks to revisit deferred work.

## Pre-commit

Run the child package's complete, independently installable validation:

```bash
npm run typecheck
npm run format
npm test
```

The package scripts cover `index.ts`, all TypeScript under `src/` and `test/`, and the active Markdown planning files.

## Commit Style

Match existing commits:

- `Add URL content grep tool`
- `Cache page results`
- `Rename package from pi-search to pi-web-search`
