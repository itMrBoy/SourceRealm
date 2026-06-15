# Reflection: Level checkpoints and directory picker

## Task

Implemented Home/main-menu navigation, unfinished level checkpoint save/restore, read-only previous-question review, and a backend-driven directory picker with manual path fallback.

## What mattered

- Progress is the shared contract for both durable completions and unfinished level checkpoints, so schema changes must be synchronized across shared, server, and web.
- Checkpoints must not behave like completions: they should not grant XP, badges, or write `completedLevels`.
- Level completion must clear the matching checkpoint to prevent stale resumed state after a successful settlement.
- `sendBeacon` uses POST, not PUT, so the backend needs a POST-compatible checkpoint save route when supporting page-close best-effort persistence.
- Directory picking needs a test-injectable backend abstraction; tests should not open real OS dialogs.
- Frontend state can still hold pre-migration progress objects during hot reload or after old API reads. Any new optional persisted field should be normalized in the store and guarded at direct read sites.
- Restoring a saved checkpoint cannot rely only on the existing in-memory Zustand progress. Re-entering a level should refresh the backend project snapshot first, otherwise a successful write can still look lost if the current screen has stale progress.
- Do not swallow explicit save failures and navigate anyway. A failed checkpoint save should show an error and keep the player in the level so "保存离开" never becomes a silent discard.
- Answer history should record wrong answers too, because previous-question review and checkpoint restore need the same visible state after a miss as after a correct answer.
- When a new frontend call reports 404 "未找到" immediately after adding a backend route, first suspect a stale running backend process. The server `dev` script runs `tsx src/cli.ts --no-open` and is not a file watcher, so route changes require restarting the backend.

## Validation note

`pnpm test`, server `tsc --noEmit`, and web build all passed after the implementation. A new API test originally depended on async generation and was flaky in the full suite; direct ProjectStore setup is better for checkpoint endpoint tests.

Follow-up validation after the restore bug report: web build, server `tsc --noEmit`, and the checkpoint API test all passed after making level entry refresh backend progress and surfacing save failures.
Follow-up validation after the screenshot report: web build and server `tsc --noEmit` passed after moving toast feedback to the page center and making the 404 save failure hint point to backend restart.
