# Reflection: code-type complete uses whitespace-insensitive comparison

## Task

Fixed an unwinnable state in `judgeCodeType()` (`packages/shared/src/judge.ts`) where the
`complete` flag never turned true for some expected snippets:

- Old logic: `complete: typed === expected` (strict character-for-character equality).
- New logic: `complete: typed.length > 0 && normalizeCode(typed) === normalizeCode(expected)`.
- `normalizeCode()` collapses intra-line whitespace, trims line ends, and drops empty lines
  (`split('\n')` -> `replace(/\s+/g,' ').trim()` -> `filter(Boolean)` -> `join('\n')`). This is the
  same helper used by `judgeCodeFill()`.
- Added a `judge.test.ts` case "complete 忽略空白差异" covering: trailing newlines/blank lines still
  complete, differing leading indent and intra-line whitespace length still complete, words run
  together (missing separator) not complete, visibly different content not complete, empty input not
  complete.

## What mattered

- `code-type` completion must reuse `normalizeCode` for a whitespace-insensitive comparison, exactly
  like `code-fill`, while still requiring the visible content to match and rejecting empty input.
- `correct`/`accuracy` (character-for-character) and `complete` (whitespace-insensitive) are two
  different semantics and must not be mixed: live progress uses character-for-character; the
  completion gate uses normalization.
- The bug surfaces because `CodeTypeTask.tsx` (line 94) auto-submits the task when `stats.complete`
  becomes true. Any UI that auto-triggers submission from a judge boolean is extremely sensitive to
  that judge's boundary conditions; an over-strict equality check creates an unwinnable deadlock when
  the expected snippet has trailing newlines/blank lines or intra-line whitespace length the player
  cannot reproduce exactly.

## Validation note

Ran `packages/shared/test/judge.test.ts` with vitest from the repo root: 7 passed.

## Promotion candidates

- Worth a short note in `llmdoc/reference/data-model.md` (task scoring section): code-type/code-fill
  completion is whitespace-insensitive via `normalizeCode`, while accuracy stays character-for-character.
