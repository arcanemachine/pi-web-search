# Agent Instructions

## Workflow

Commit when a task is completed.

## Deferred ideas

`IDEAS.DEFERRED.md` is intentionally outside the active workflow. Do not read, raise, research, or plan anything from it unless the user explicitly asks to revisit deferred work.

## Verification

Run before completion:

```bash
npm run format:check
npm run typecheck
npm run test
npm run build
npm pack --dry-run
```

The package scripts cover `index.ts`, all TypeScript under `src/` and `test/`, and the maintained package Markdown files.

## Commit Style

Match existing commits:

- `Add URL content grep tool`
- `Cache page results`
- `Rename package from pi-search to pi-web-search`
