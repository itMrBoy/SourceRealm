# Project Basics

SourceRealm is a local web app that turns a local code repository into a pixel-style source-reading game.

User flow:

1. Import a local repository path.
2. The server scans the repository and asks an AI provider to map a course.
3. Levels are generated and written to local JSON files.
4. The browser shows a world map and lets the user complete task-based levels.
5. When the imported repository changes, git diff drives an incremental update.

Workspace layout:

- `packages/shared` - zod schemas, TypeScript types, task judging, scoring, badge helpers.
- `packages/server` - Fastify API, repo scanner, JSON store, LLM providers, generator, updater, CLI.
- `packages/web` - React/Vite frontend, app store, API client, screens, game runtime, task components.
- `docs/superpowers` - original design and implementation plans.
- `llmdoc` - stable project memory for future agents.
- `.llmdoc-tmp` - temporary investigation notes.

Runtime data:

- Default data root: `.sourcerealm/` under the launch directory (uses `INIT_CWD` when pnpm provides it, otherwise `process.cwd()`)
- Override: `SOURCEREALM_HOME`
- Per-project state: `project.json`, `course.json`, `levels/*.json`, `progress.json`, and temporary `levels-next/` during updates.

AI provider order:

1. Claude CLI via `claude -p --input-format text --output-format json`
2. Anthropic API when `ANTHROPIC_API_KEY` is set

The app is local-only in the first version. There is no public deployment, auth, multi-user mode, git URL clone, zip upload, or mobile-specific scope.
