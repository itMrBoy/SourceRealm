# Current State

## Implemented Surfaces

- Shared zod schemas and pure judging/scoring helpers exist.
- Fastify API supports project import/list/read, provider status, generation retry, update check, update run, SSE events, level read with freshness, source file read, file tree, level progress submission, and file-read progress.
- Server generation supports course mapping, per-level generation, schema retry, task reference verification, and content hash backfill.
- Server storage serializes per-target JSON writes and retries transient Windows rename failures during atomic writes.
- Incremental update supports modified, deleted, renamed, copied, added files, stale/obsolete levels, append threshold, `levels-next` staging, promotion, and progress preservation.
- Frontend has Home, Generating, Map, Level, Badges, and Cert screens, with Zustand stores, CodeBrowser source/Markdown preview modes, and task components for quiz, treasure-hunt, call-chain, code-fill, and code-type.
- A persistent global controls bar (`GlobalControls.tsx`) renders the top-right main-menu/badges/CRT/mute actions across all screens; opening badges from an unfinished level snapshots the run so the reward wall can offer continue/save/discard.
- Tests cover core shared logic and server integration/update behavior.

## Important Naming Risk

The repository has a live package-name mismatch:

- Root/package manifests use `sourcerealm` and `@sourcerealm/*`.
- Many source imports still use `@code-quest/shared`.
- README and some scripts still mention `@code-quest/server` and `@code-quest/web`.
- Storage env/data names use `SOURCEREALM_HOME` for overrides and default to the launch directory's `.sourcerealm/` folder (the `VITE_SOURCEREALM_*` and `SOURCEREALM_MODEL` vars follow the same prefix).

Before changing build, install, or package metadata, verify whether the goal is:

1. Keep `code-quest` as the internal package identity, or
2. Finish migration to `@sourcerealm/*`.

Do not blindly update only one side.

## Current Validation Baseline

Known test command from package scripts:

```bash
pnpm test
```

The README still shows some `npm` commands, while the root has both `pnpm-lock.yaml` and `package-lock.json`. Prefer checking the current package manager decision before dependency edits.
