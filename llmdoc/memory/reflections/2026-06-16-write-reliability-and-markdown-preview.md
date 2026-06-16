# Reflection: Write Reliability And Markdown Preview

## Context

Commit `314e18f` fixed two user-visible pain points: Windows generation could fail around repeated JSON writes, and README-style Markdown files were hard to read in the code browser.

## What Changed

- `ProjectStore` now serializes writes per target JSON file and retries transient Windows `rename` failures (`EPERM`, `EBUSY`, `EACCES`) before surfacing an error.
- `runWithConcurrency` now stops scheduling new work after the first uncaught worker error, waits for already-started workers to settle, and then rethrows.
- Generation retry now treats both `failed` and leftover `generating` outlines as resumable `pending` work while preserving `ready` levels.
- `CodeBrowser` now keeps raw file content alongside highlighted source so Markdown files can switch between source and rendered preview.

## Durable Lessons

- Windows JSON persistence failures in this repo should be evaluated as a storage/concurrency interaction, not only as an external file-lock symptom.
- Per-target write serialization belongs in `ProjectStore`, because `course.json`, `project.json`, `progress.json`, and promoted level files all share the same atomic-write risk profile.
- Markdown preview should stay inside `CodeBrowser` as a view mode for `.md` files only. Source view remains the default so line-based highlighting and treasure-hunt interactions remain stable.
- Dependency additions for frontend rendering must use pnpm and be verified with `pnpm --filter @sourcerealm/web build`.

## Promotion Candidates

- `llmdoc/architecture/server-api-and-generation.md` should describe the storage write queue, transient rename retry, and generation retry semantics.
- `llmdoc/architecture/frontend-runtime.md` should describe the Markdown source/preview toggle and its relationship to line-based source interactions.
