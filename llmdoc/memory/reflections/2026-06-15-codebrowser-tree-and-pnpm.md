# Reflection: CodeBrowser Tree View And pnpm Workspace Dependencies

## Context

The CodeBrowser left rail was changed from a flat file list into a two-zone browser: level files stay pinned as task guidance, while the full repository tree shows every file in its directory context. Level files also remain visible in the full tree with special highlighting and synchronized active state.

## What Went Wrong

- I initially tried `npm install` after `pnpm add` timed out, but the project is managed with pnpm and the user explicitly corrected this.
- `pnpm add --filter @sourcerealm/web ...` first failed because local workspace dependencies used `"*"` for `@sourcerealm/shared`, which made pnpm try the npm registry instead of linking the local package.
- The interrupted npm command wrote transient dependency entries into `package-lock.json`; these had to be removed from the unstaged diff while preserving pre-existing staged changes.

## Durable Lessons

- For this repo, use pnpm for dependency operations. Do not use npm to add or install packages.
- Internal workspace package dependencies should use `workspace:*` when editing manifests, especially before adding external packages with pnpm.
- When an install command is interrupted, inspect both package manager lockfiles before continuing; clean only the accidental unstaged changes and do not revert unrelated staged work.

## Promotion Candidates

- `llmdoc/reference/commands.md` should state that dependency work uses pnpm and internal workspace references use `workspace:*`.
- `llmdoc/architecture/frontend-runtime.md` should document CodeBrowser's two-zone file browsing semantics so future UI changes preserve the "task guidance vs full repository context" split.
