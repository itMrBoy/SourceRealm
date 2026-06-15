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
- `treasure-hunt` - instruction, hint, target ref.
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

`Progress` stores total XP, completed level results, badges, and read files.

Repeated completion does not duplicate XP. The server only adds a positive XP delta if the new result is worth more than the previous result.

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
