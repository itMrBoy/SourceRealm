# Frontend Runtime

Primary package: `packages/web`.

## State

`src/store.ts` is the top-level Zustand store. It tracks:

- current screen
- project id/name
- course
- progress
- selected level
- temporary reward-wall return snapshot for an unfinished level
- file tree cache
- muted/CRT settings
- update baseline
- global toast and confirm-dialog state

`src/game/run.ts` is the per-level runtime store. It tracks:

- loaded level and task freshness
- task index
- hearts, combo, max combo, XP
- answer counts and scored task count
- phase (`loading`, `narrative`, `answering`, `feedback`, `level-done`, `settled`, `failed`)
- settlement and duplicate-submit guard
- answered-history entries for read-only previous-question review

The runtime can snapshot unfinished levels into `Progress.levelRuns[levelId]` and restore from that checkpoint when re-entering the same level. Only unfinished phases are persisted; settlement clears the checkpoint through the backend completion flow.

## API Client

`src/api.ts` wraps fetch against `VITE_SOURCEREALM_API_BASE` or same-origin `/api`. SSE uses `VITE_SOURCEREALM_EVENTS_BASE` or the API base.

## Screen Flow

- `Home.tsx` lists existing projects, probes provider status, and imports a new repository path.
- Home can ask the backend to open the OS directory picker, then fills the path input. Manual path input remains the fallback and the user still explicitly clicks "start adventure".
- `Generating.tsx` subscribes to SSE and moves to the map when generation is done.
- `MapScreen.tsx` checks for repository updates on entry, renders chapter zones, computes unlock/current state, and routes into levels.
- `LevelScreen.tsx` loads level data, auto-opens the current task's first referenced file, wires treasure-hunt line clicks, manages split layout, and submits settlement.
- Level exits show a three-action confirm when an unfinished checkpoint exists: save and leave, discard progress, or continue. Page close/refresh performs a best-effort checkpoint save.
- Before entering a level, `LevelScreen.tsx` refreshes the project snapshot from the backend so checkpoint restore uses the latest persisted `progress.levelRuns`, not a stale in-memory store from the previous map/home view.
- When `LevelScreen` is reached by continuing from the reward wall, it first merges the temporary reward-wall snapshot into `progress.levelRuns[levelId]` and then calls `useRun.loadLevel()`. The load effect should read that temporary snapshot once from `useStore.getState()` and should not subscribe to it; clearing the snapshot after merge must not trigger a second backend refresh that overwrites the local restore state.
- Explicit "save and leave" must only navigate after the checkpoint save succeeds. Save failures are surfaced through toast and keep the player in the level so they do not falsely believe progress was persisted.
- `BadgesScreen.tsx` and `CertScreen.tsx` render reward/progress surfaces. If `BadgesScreen` is opened from an unfinished level through the persistent global controls, the global store carries a temporary `SavedRun` snapshot. In that mode the screen shows a "continue level" action; returning to the map or main menu must confirm save/discard/continue using the same checkpoint semantics as Level exit.

## Persistent Controls

`GlobalControls.tsx` renders the top-right persistent controls across screens. These controls are independent from screen-local navigation. Avoid duplicating a main-menu button inside `LevelScreen`; keep the Level header focused on the level title plus a local exit-to-map action, while the persistent main-menu control remains global.

Opening badges from a level should snapshot `useRun.getState().snapshot()` before changing screens and store it as `badgesReturnRun`. Opening badges from non-level screens should clear that temporary return state so the reward wall behaves like a normal progress surface.

## Global Feedback

`ToastContainer` renders non-blocking message feedback from the global store. `ConfirmDialog` renders blocking in-app confirmations and should be used instead of browser-native `window.confirm` / `alert` so pixel-style UI remains consistent.

Toast feedback is centered on the viewport, with stronger type-specific backgrounds/borders for error, warning, and success states. Use toast for important failures that should be visible even while the player stays in a level.

`ConfirmDialog` supports an optional secondary action for flows that need a destructive alternative, such as discarding an unfinished level checkpoint.

## Code Browser File Rail

`src/components/CodeBrowser.tsx` intentionally has two file zones:

- `本关文件` is the task-guidance zone. It comes from `level.files` and should stay pinned/marked so players know which files are most relevant to the current level.
- `全部文件` is the repository-context zone. It comes from `/api/projects/:id/tree`, shows the complete repository file tree, and includes level files instead of filtering them out.

The two zones share one active file state. Selecting a pinned level file should select the same file in the full tree, expand its parent directories, and scroll it into view. Selecting a file from the full tree should also update the pinned level-file active state when the file belongs to `level.files`.

Do not infer task relevance from directory co-location. Level files can span different packages or directories in a monorepo; the full tree is for location/context, while `level.files` remains the source of task relevance.

For `.md` files, the code pane exposes a view-mode toggle between source and rendered Markdown preview. Source remains the default every time a file is loaded, preserving line numbers, line highlighting, and treasure-hunt click behavior. Preview uses the raw file content with GitHub-flavored Markdown support and is limited to Markdown files.

## Level Semantics

The runtime starts each level with 3 hearts. Correct answers add XP with combo multiplier, increment combo, and advance after feedback. Wrong answers reset combo, decrement hearts, and fail the level when hearts reach zero.

Stale tasks, where the backend says refs are no longer fresh, are automatically skipped and not counted for scoring. If all tasks are skipped, the level can still settle as a C rating with 0 XP.

After settlement, the frontend refreshes project data before returning to the map.

The "previous question" feature is review-only. It uses answered-history plus the current level task list to show the previous task's prompt, result, and explanation without allowing answer edits or score rollback.
