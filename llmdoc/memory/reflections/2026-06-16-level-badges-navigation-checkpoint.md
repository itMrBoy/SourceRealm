# Reflection: Level badges navigation and checkpoint context

## Task

Adjusted the persistent top-right controls and reward-wall navigation around the Level screen:

- Kept the persistent global controls visible.
- Removed the duplicate Level-screen main-menu button.
- Kept a Level-screen exit button without overlapping the global controls.
- When the reward wall is opened from an unfinished level, preserved the in-progress run snapshot and made "return to map" / main-menu navigation confirm save-or-discard first.

## What mattered

- `LevelScreen` owns the live `useRun` runtime state. Navigating away to `BadgesScreen` unmounts `LevelScreen`, and its cleanup resets `useRun`, so a reward-wall detour must capture the current `SavedRun` before changing screens.
- The reward wall is normally a passive progress surface, but when it is opened from an unfinished level it temporarily becomes part of the level-run flow. In that mode it needs an explicit "continue level" action and any exit to map/home must use the same save/discard confirmation contract as Level exit.
- The temporary return snapshot belongs in top-level `store.ts` state (`badgesReturnRun`) rather than the per-level runtime store, because `useRun` is reset when the Level screen unmounts.
- Restoring from the reward wall must merge the temporary snapshot into `progress.levelRuns[levelId]` before `useRun.loadLevel()` reads progress. It should not write the backend unless the player chooses to save and leave.
- Do not subscribe `LevelScreen`'s load effect to the temporary return snapshot. Clearing `badgesReturnRun` after merge can otherwise retrigger the load effect, fetch backend progress again, and overwrite the just-merged local snapshot.
- If the player chooses "return map" or "main menu" from the reward wall while a temporary run exists, failed checkpoint saves must keep the player on the reward wall and show a toast, matching the Level exit behavior.

## Validation note

`pnpm --filter @sourcerealm/web build` passed after the layout, reward-wall checkpoint, and second-load restore fix.
