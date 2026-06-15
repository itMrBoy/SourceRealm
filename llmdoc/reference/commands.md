# Commands Reference

This repository is managed with pnpm. Do not use npm for dependency installation or package updates.

Check package-name state before relying on commands. Root scripts currently target `@sourcerealm/*`, while README/scripts may still contain old `@code-quest/*` references.

## Root Scripts

```bash
pnpm test
pnpm --parallel --filter @sourcerealm/web --filter @sourcerealm/server dev
pnpm --filter @sourcerealm/web build
pnpm --filter @sourcerealm/server dev
```

## Useful Targeted Commands

```bash
pnpm test packages/shared/test/judge.test.ts
pnpm test packages/server/test/app.test.ts
pnpm test packages/server/test/updater.test.ts
```

## Dependency Edits

Use pnpm workspace commands for dependency changes:

```bash
pnpm add --filter @sourcerealm/web <package>
pnpm add --filter @sourcerealm/server <package>
```

Internal workspace dependencies should be written with `workspace:*`, for example:

```json
"@sourcerealm/shared": "workspace:*"
```

Using `"*"` for an internal package can make pnpm try to fetch `@sourcerealm/shared` from the npm registry during dependency installation.

## Environment

```bash
SOURCEREALM_HOME=/tmp/source-realm-data
PORT=4977
ANTHROPIC_API_KEY=...
SOURCEREALM_MODEL=...
VITE_SOURCEREALM_API_BASE=http://localhost:4977/api
VITE_SOURCEREALM_EVENTS_BASE=http://localhost:4977/api
```

Provider behavior:

- Claude CLI is preferred when `claude` is available.
- Anthropic API is used when `ANTHROPIC_API_KEY` is set.

Storage behavior:

- Default data root is `.sourcerealm/` under the launch directory (`INIT_CWD` from pnpm when available, otherwise `process.cwd()`).
- Tests typically override `SOURCEREALM_HOME` for isolation.
