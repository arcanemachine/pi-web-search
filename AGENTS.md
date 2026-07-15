# Agent Instructions

## Workflow

Commit when a task is completed.

## Active research handoff (temporary)

Before planning or implementing the current web-search improvements, read `RESEARCH.md`. It records confirmed decisions, evidence, candidate architecture, and unresolved questions.

Artifact lifecycle:

1. During research, keep `RESEARCH.md` current.
2. Once the user approves scope and decisions, create an executable `PLAN.md` that references `RESEARCH.md`.
3. After implementation and verification, remove `RESEARCH.md`, `PLAN.md`, and this temporary section before completing the work.

## Pre-commit

```bash
npx tsc --noEmit
npx prettier --write index.ts package.json
```

## Commit Style

Match existing commits:

- `Add URL content grep tool`
- `Cache page results`
- `Rename package from pi-search to pi-web-search`
