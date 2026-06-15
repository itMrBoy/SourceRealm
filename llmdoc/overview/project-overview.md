# Project Overview

SourceRealm turns a local repository into a game-like source-reading course.

The backend scans the target repository, generates a course outline, generates task-based levels, stores everything as JSON, and serves it to a browser frontend. The frontend presents a pixel-style map, interactive levels, code browsing, XP, ratings, badges, and certificate flow.

## Main Runtime Loop

1. User enters a local repository path on the Home screen.
2. `POST /api/projects` validates the path with `RepoScanner.open`.
3. `ProjectStore` creates or reuses a project directory under the data root.
4. `LevelGenerator` maps the course, then generates each level.
5. The frontend listens to `/api/projects/:id/events` and updates generation progress.
6. Map screen opens playable levels and checks whether the repository has changed.
7. Level screen loads level JSON plus reference freshness and runs task interactions.
8. Settlement posts level result and receives updated progress/new badges.

## Main Packages

- Shared: data schemas and pure rules.
- Server: local API, generation, update, storage, providers.
- Web: screens, stores, code browser, task UI, game runtime.

## Local Storage Model

The app intentionally avoids a database. JSON files under the data root are the source of truth for generated course state and progress. By default the data root is `.sourcerealm/` under the launch directory so users can inspect or edit it in the project folder; `SOURCEREALM_HOME` can still override it. This makes manual inspection and backup simple, but requires careful atomic writes and schema validation.
