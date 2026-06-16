# Data Model Reference

Primary source: `packages/shared/src/schema.ts`.

## CodeRef

Code references identify live source by:

- `file`
- `startLine`
- `endLine`
- `contentHash`

The scanner hashes referenced text after trimming trailing whitespace per line. Freshness is true only when the current source range hashes to the stored value.

## Task Types

- `quiz` - question, options, answer indexes, refs.
- `treasure-hunt` - instruction, hint, target ref. Judged by tolerant line-set match against the target range (see Judging Semantics), not by a single click landing inside the range.
- `call-chain` - ordered items with optional refs.
- `code-fill` - ref, blank absolute line numbers, answers.
- `code-type` - ref.

Each task has `id`, `narrative`, and `explanation`.

## Course And Level

`Course` contains project title/tagline and chapters. Each chapter contains `LevelOutline` entries.

`LevelOutline.status` and `Level.status` can be:

- `pending`
- `generating`
- `ready`
- `failed`
- `stale`
- `obsolete`

Full level JSON contains tasks and the actual referenced file list.

## Project Meta

`ProjectMeta` stores:

- project id
- repository path
- display name
- git flag
- anchor commit
- creation time
- generation status (`idle`, `mapping`, `generating`, `done`, `error`)

## Progress

`Progress` stores total XP, completed level results, badges, read files, and unfinished level-run checkpoints.

Repeated completion does not duplicate XP. The server only adds a positive XP delta if the new result is worth more than the previous result, and overwrites `completedLevels[levelId]` with the latest `result` (which carries the latest history) regardless of the XP delta.

`LevelResult` carries an optional `answeredHistory?: SavedAnswer[]`, so `completedLevels` can retain per-task answer history that feeds the read-only review walkthrough for already-cleared levels. This field is **optional** for backward compatibility (older saves without it remain valid). Contrast with `SavedRun.answeredHistory`, which is **required**; the two fields share a shape but differ in semantics and must not be merged.

`levelRuns` is keyed by level id and stores unfinished in-level checkpoints. A saved run includes the current task index, hearts, combo, max combo, XP earned inside the run, answer counters, scored task count, restorable run phase, last answer result, answered-history entries for read-only "previous question" review, and `updatedAt`.

Level-run checkpoints are not completions. They do not update `completedLevels`, grant badges, or add total XP. A successful level settlement clears the checkpoint for that level.

## Scoring

Base XP:

- quiz: 10
- treasure-hunt: 15
- call-chain: 20
- code-fill: 20
- code-type: 25

Combo multiplier is `min(1 + combo * 0.1, 2)`.

Rating:

- S: accuracy 1 and max combo at least task count
- A: accuracy >= 0.9
- B: accuracy >= 0.7
- C: otherwise

## Judging Semantics

Source: `packages/shared/src/judge.ts`.

`treasure-hunt` uses tolerant exact-set judging via `judgeTreasureHunt(target, selected: { file, lines: number[] }, targetText: string[]) => { correct, overlap }`:

- `correct` requires the selection to be in the same file, cover every **core content line**, and stay within `[startLine, endLine]` (no out-of-range picks). Core content lines are the non-blank, non-heading lines of the target range. Blank lines and Markdown `#` heading lines are optional. Heading detection is `.md`-only via `/^\s*#{1,6}\s/` (leading whitespace allowed).
- When the target range is entirely blank/heading lines, required falls back to all non-blank lines so an empty required set never makes any selection correct.
- When `targetText` is empty (range content unavailable), it degrades to strict full-range matching (every line `startLine..endLine` required).
- `overlap` is true when the selection intersects `[startLine, endLine]`. The frontend uses `overlap` to decide whether a wrong answer costs a heart (see `architecture/frontend-runtime.md`).

This tolerance exists because AI-generated target boundaries often pull headings/blank lines into the range while the player naturally selects only the content list; strict per-line matching was too brittle.

`code-fill` and `code-type` completion are whitespace-insensitive: both compare via `normalizeCode` (collapse intra-line whitespace, trim line ends, drop empty lines), so completion requires only visible content to match. Trailing newlines/blank lines and intra-line whitespace length differences are ignored; empty input never counts as complete.

`code-type` accuracy/correct stays character-for-character (live progress display). Only the completion gate uses normalization. The gate must stay whitespace-insensitive because the frontend auto-submits a code-type task when its `complete` flag turns true; a stricter equality check deadlocks any expected snippet with trailing whitespace the player cannot reproduce.
