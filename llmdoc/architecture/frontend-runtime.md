# Frontend Runtime

Primary package: `packages/web`.

## State

`src/store.ts` is the top-level Zustand store. It tracks:

- current screen
- project id/name
- course
- progress
- selected level
- file tree cache
- muted/CRT settings
- update baseline

`src/game/run.ts` is the per-level runtime store. It tracks:

- loaded level and task freshness
- task index
- hearts, combo, max combo, XP
- answer counts and scored task count
- phase (`loading`, `narrative`, `answering`, `feedback`, `level-done`, `settled`, `failed`)
- settlement and duplicate-submit guard

## API Client

`src/api.ts` wraps fetch against `VITE_SOURCEREALM_API_BASE` or same-origin `/api`. SSE uses `VITE_SOURCEREALM_EVENTS_BASE` or the API base.

## Screen Flow

- `Home.tsx` lists existing projects, probes provider status, and imports a new repository path.
- `Generating.tsx` subscribes to SSE and moves to the map when generation is done.
- `MapScreen.tsx` checks for repository updates on entry, renders chapter zones, computes unlock/current state, and routes into levels.
- `LevelScreen.tsx` loads level data, auto-opens the current task's first referenced file, wires treasure-hunt line clicks, manages split layout, and submits settlement.
- `BadgesScreen.tsx` and `CertScreen.tsx` render reward/progress surfaces.

## Code Browser File Rail

`src/components/CodeBrowser.tsx` intentionally has two file zones:

- `本关文件` is the task-guidance zone. It comes from `level.files` and should stay pinned/marked so players know which files are most relevant to the current level.
- `全部文件` is the repository-context zone. It comes from `/api/projects/:id/tree`, shows the complete repository file tree, and includes level files instead of filtering them out.

The two zones share one active file state. Selecting a pinned level file should select the same file in the full tree, expand its parent directories, and scroll it into view. Selecting a file from the full tree should also update the pinned level-file active state when the file belongs to `level.files`.

Do not infer task relevance from directory co-location. Level files can span different packages or directories in a monorepo; the full tree is for location/context, while `level.files` remains the source of task relevance.

## Level Semantics

The runtime starts each level with 3 hearts. Correct answers add XP with combo multiplier, increment combo, and advance after feedback. Wrong answers reset combo, decrement hearts, and fail the level when hearts reach zero.

Stale tasks, where the backend says refs are no longer fresh, are automatically skipped and not counted for scoring. If all tasks are skipped, the level can still settle as a C rating with 0 XP.

After settlement, the frontend refreshes project data before returning to the map.
