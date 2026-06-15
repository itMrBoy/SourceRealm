# Incremental Update

Primary file: `packages/server/src/updater.ts`.

## Check

`GET /api/projects/:id/update-check` calls `checkForUpdates`.

If the project is not git-backed or has no anchor commit, it returns unchanged. Otherwise it compares stored `anchorCommit` to current `HEAD`. When they differ, `diffSince` summarizes changed files with:

- `modified`
- `deleted`
- `added`

## Diff Parsing

`diffSince` runs:

```bash
git diff --name-status --find-renames <anchor>..HEAD
```

Status handling:

- `M`, `T` -> modified
- `A` -> added
- `D` -> deleted
- `C` -> added new path
- `R` -> deleted old path plus added new path

## Impact Analysis

`analyzeImpact` receives a map of `levelId -> referenced files`.

Rules:

- All referenced files deleted -> `obsolete`
- Any referenced file deleted or modified -> `stale`
- Added file count >= `NEW_FILES_THRESHOLD` (currently 3) -> append new levels

## Run Pipeline

`CourseUpdater.run`:

1. Clears `levels-next`.
2. Writes meta generation status `generating`.
3. Computes diff and impact.
4. Marks obsolete levels in both pending level JSON and course outline.
5. Revises stale levels with LLM and verified refs.
6. If enough files were added, asks LLM for append-only outlines and generates their levels.
7. Writes pending new/revised/obsolete level JSON into `levels-next`.
8. Promotes `levels-next/*.json` into `levels/`.
9. Writes updated course.
10. Advances `anchorCommit` to current HEAD and writes generation status `done`.

On top-level failure, `levels-next` is removed and meta status becomes `error`.

## Important Semantics

- `progress.json` is not touched during update.
- If a stale level revision fails, the old level JSON remains playable and the outline is marked `stale`.
- The map treats `stale` as playable and shows an extra warning badge.
- Obsolete levels are not playable, but historical completed status is still rendered.
- The updater advances the anchor even if individual stale revisions fail and are marked `stale`.
