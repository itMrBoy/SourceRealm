# Server API And Generation

Primary entrypoint: `packages/server/src/app.ts`.

## App Construction

`buildApp` creates a Fastify app with CORS enabled for local Vite development. When `packages/web/dist/index.html` exists, it also serves the built web app and falls back to `index.html` for non-API routes.

## Core API

- `POST /api/projects` - import or reuse a repository path, create metadata/progress if needed, start generation if incomplete.
- `GET /api/projects` - list known project metadata from data root.
- `GET /api/provider` - detect and report current provider.
- `GET /api/projects/:id` - return meta, course, and progress.
- `POST /api/projects/:id/generate` - reset failed/generating outlines to pending and resume generation.
- `GET /api/projects/:id/events` - SSE stream for generator/updater events.
- `GET /api/projects/:id/levels/:levelId` - return level plus per-task reference freshness.
- `GET /api/projects/:id/file?path=...` - read a source file from the imported repository.
- `GET /api/projects/:id/tree` - return file tree.
- `POST /api/projects/:id/progress/level` - submit level completion and merge progress.
- `PUT /api/projects/:id/progress/level-run` - save an unfinished in-level checkpoint.
- `POST /api/projects/:id/progress/level-run` - same save operation, kept for `sendBeacon` / page-close best effort saves.
- `DELETE /api/projects/:id/progress/level-run/:levelId` - discard one unfinished level checkpoint.
- `POST /api/projects/:id/progress/file-read` - record a read source file.
- `POST /api/system/pick-directory` - open the local OS directory picker and return the selected absolute path, or `null` on cancel.

Incremental update endpoints are covered in `llmdoc/architecture/incremental-update.md`.

## Generation Flow

`LevelGenerator.run`:

1. Reads project meta and existing course.
2. If no course exists, writes generation status `mapping`, calls `mapCourse`, and writes `course.json`.
3. Emits a `course` SSE event.
4. Iterates chapter outlines.
5. For non-ready outlines, writes status `generating`, calls `generateLevel`, writes `levels/<id>.json`, sets outline `ready`, and emits `level`.
6. On per-level failure, marks outline `failed` and emits `level-failed`.
7. On completion, writes generation status `done` and emits `done`.

Generation retry (`POST /api/projects/:id/generate`) is idempotent while a generator is already active. When retrying an incomplete course, `failed` and leftover `generating` outlines are reset to `pending`; `ready` levels remain reusable and should not be regenerated.

`mapCourse` sends the file tree and README excerpt to the provider, validates against a zod draft schema, filters files to known paths, and creates pending outlines.

`generateLevel` sends numbered file content for the outline files, validates draft tasks, verifies all refs by reading actual code ranges, backfills `contentHash`, and writes a ready `Level`.

## Provider Flow

`detectProvider` chooses:

1. `ClaudeCliProvider` if `claude --version` succeeds.
2. `AnthropicApiProvider` if `ANTHROPIC_API_KEY` exists.
3. Otherwise throws a setup error.

`generateWithRetry` retries schema-invalid output twice, appending the validation error to the next prompt.

## Storage

`ProjectStore` validates every read/write through shared schemas. Writes are atomic at the file level: write temp JSON, then rename.

Writes are also serialized per target path before the temp-file rename. This avoids overlapping writes to the same JSON file during generation, progress saves, or level promotion.

On Windows, temp-file rename can fail transiently when replacing an existing JSON file. `ProjectStore` retries `EPERM`, `EBUSY`, and `EACCES` with short backoff, removes the temp file on failure, and then rethrows if the rename never succeeds.

Project ids are the first 12 hex chars of SHA-256 over the resolved repository path.

The default data root is `.sourcerealm/` under the launch directory so local JSON state stays near the app for manual inspection. `SOURCEREALM_HOME` still overrides the root for isolation or custom storage.

Progress writes are also used for unfinished checkpoints. Completion submission removes the matching `levelRuns[levelId]` before writing progress so a completed level never resumes from stale in-level state.

## System Directory Picker

`pickDirectory` is injectable through `buildApp` for tests. The default implementation opens a Windows FolderBrowserDialog through PowerShell/Shell APIs, with best-effort macOS/Linux fallbacks. The frontend keeps manual path input as the reliable fallback when the OS picker is unavailable or cancelled.
