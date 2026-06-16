# Working Agreement

Use docs first for orientation, then code for truth.

When touching behavior, preserve the visible product contract:

- Importing a local repo starts or resumes generation.
- Levels are playable as soon as they are ready.
- Source references are validated with file, line range, and content hash.
- Stale source references should not crash the level; they degrade/skipped as implemented.
- Incremental update must not erase existing progress.

Editing rules:

- Keep changes scoped to the relevant package.
- Keep shared model changes synchronized across server and web.
- Treat `packages/shared` as the contract layer.
- Pitfall: `@sourcerealm/shared`'s package.json `exports` points at `./src/index.ts` (source consumption, no `dist`), and `packages/server` dev runs `tsx src/cli.ts` (no watch). A **running** backend will not hot-reload changes to shared. After editing any shared zod schema, **restart the backend** — a stale schema silently strips new POST-body fields (Zod strips unknown keys by default, e.g. a freshly added `answeredHistory`), which looks like "code changed but data did not persist" rather than a logic bug.
- If changing update behavior, update both backend semantics and map/level UI expectations.
- If changing package names, update manifests, imports, scripts, README, and tests together.

Validation:

- Run targeted Vitest tests for changed shared/server logic.
- Run `pnpm test` for cross-cutting schema, scoring, API, generator, or updater changes.
- For frontend behavior, run typecheck/build if package scripts are available or add targeted manual verification notes.

Temporary notes belong in `.llmdoc-tmp/investigations/`; stable conclusions belong in `llmdoc/`.
