# Agent Instructions

## Workflow

Commit when a task is completed.

## Deferred ideas

`IDEAS.DEFERRED.md` is intentionally outside the active workflow. Do not read, raise, research, or plan anything from it unless the user explicitly asks to revisit deferred work.

## Pre-commit

Run the child package's complete, independently installable validation:

```bash
npm run typecheck
npm run format
npm test
```

The package scripts cover `index.ts`, all TypeScript under `src/` and `test/`, and the maintained package Markdown files.

## Commit Style

Match existing commits:

- `Add URL content grep tool`
- `Cache page results`
- `Rename package from pi-search to pi-web-search`
