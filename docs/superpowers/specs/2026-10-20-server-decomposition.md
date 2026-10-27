# Server decomposition

Date: 2026-10-20
Status: implemented; review findings resolved, gates green.
Finding: audit #4 (P1), `src/server.ts` mixes entry, HTTP plumbing, shutdown, and every route.

## Problem

`src/server.ts` is 661 lines and holds five unrelated concerns: the TanStack Start server entry, JSON/error response plumbing, the process shutdown hook, shared path resolution, and ~30 route handlers across seven resource groups. Every new endpoint edits the same file, so unrelated changes collide, and the file cannot be reviewed a section at a time. The route bodies are also untested: no suite drives the dispatcher, so a move is indistinguishable from a behavior change.

## Scope and exclusions

In scope: `src/server.ts` and new modules under `src/server/routes/` plus `src/server/http.ts` and `src/server/shutdown.ts`.

Excluded: changing any route's path, method, status code, body, or ordering guarantees; adding authentication or the `Origin`/`Sec-Fetch-Site` guard (finding #8); changing `apiV1`, `taskStore`, `agentRuns`, or any handler's business logic. `src/server.ts` keeps the default export with the same signature.

## Requirements and acceptance criteria

MOD-01 HTTP plumbing is a module. `jsonResponse`, `errorResponse`, and the 404/409/400 error mapper move verbatim to `src/server/http.ts`, with the same status mapping and the same `console.error(describeError(...))` side effect (the mapper keeps the name `routeError`). Check: `src/server/routes/routes.test.ts` asserts the JSON content type, the no-store cache header, the JSON body shape, and one mapped status per error class.

MOD-02 Route contract. `src/server/routes/types.ts` defines `RouteContext` (`request`, `url`, `path`) and `RouteHandler` (`(ctx) => Response | Promise<Response> | null`). A module returns `null` when the path or method is not its own, and a `Response` otherwise. Check: a wrong-method request reaches the fallback.

MOD-03..08 One module per resource group, each exporting `handle(ctx)`:
- `routes/tasks.ts` — providers, task list/create, task detail, verifications, workspace and merge, task terminals, task runs (list/preview/start), run review/merge.
- `routes/terminals.ts` — terminal list, reconcile, running, recover, stop.
- `routes/sessions.ts` — run acknowledge, session list/create, events (with the long-poll helper), stop, follow-up, default model.
- `routes/projects.ts` — projects, project records, project profiles (list/drafts/refresh), project revisions.
- `routes/roles.ts` — roles, one role, teams (list/plan).
- `routes/environment.ts` — dev servers (list/start/stop), verification browser (goto/act/screenshot).

Each module is a mechanical move: the route blocks are copied byte-identical from the pre-split file, wrapped by `const { request, path } = ctx;`, and keep their relative order. Shared path resolution (`resolveWorkdir`) lives in `routes/shared.ts`. Check: every route is asserted once at the dispatcher level, so a forgotten block surfaces as a 404 where a 200 is expected.

MOD-09 Dispatcher. `src/server/routes/index.ts` exports `handleApi(request)`: it returns `null` for a non-`/api/` path, tries the modules in the order `tasks, terminals, sessions, projects, roles, environment`, and otherwise returns the existing `{ error: "not found" }` 404. The module order is safe because the route sets are disjoint; that invariant is asserted. Check: an unknown `/api/` path is a 404 JSON body and a non-API path is `null`.

MOD-10 Shutdown is a module. `ShutdownDeps`, `runShutdown`, `shutdownResources`, and `registerShutdownHooks` move to `src/server/shutdown.ts` unchanged, including the in-flight memo that clears when it settles. `src/server.ts` re-exports `shutdownResources` so existing importers do not change. Check: `browser.test.ts` continues to pass unchanged, and `shutdownResources` is still idempotent while in flight.

MOD-11 Entry is small. `src/server.ts` keeps only the error-capture import, the TanStack Start entry lookup, the default `fetch` export, and the shutdown registration, and is under 120 lines. Check: `wc -l` on the file.

MOD-12 Behavior is unchanged. All existing gates pass, and the dispatcher suite reaches every route in MOD-03..08 whose handler does not require a live provider, a real browser, or a git workspace; those handlers are covered by their own suites and by the route-set comparison below. Check: the suite asserts a status and a body for each reached route, plus the two fallbacks.

Route set invariant. The modules must contain exactly the pre-split file's 22 static method+path pairs (18 distinct paths) and 17 `RegExp` path matchers, with no duplicate, so a forgotten block or a double-registered route fails the check rather than silently changing behavior. `src/server/routes/routeScan.test.ts` asserts the golden lists against the module sources, and `scripts/generate-route-table.ts` uses the same scanner so the committed route table cannot silently drift.

## Data and lifecycle

No data changes. No new state, timers, or processes: the split is structural. `registerShutdownHooks()` still runs exactly once at module import of `src/server.ts`, in the same process.

## Verification plan

- `bun run test` (existing suites plus `src/server/routes/routes.test.ts`), `bunx tsc --noEmit`, `bun run build`, `bun run scripts/verify-terminal.ts`.
- `src/server/routes/routes.test.ts` sets `SABER_DATA_DIR` to a temp directory before the first store access, drives `handleApi` with `Request` objects, and cleans up after.

## Completion evidence

Date: 2026-10-20. Gates: `bun run test` 30 files / 228 passed / 1 skipped; `bunx tsc --noEmit` exit 0; `bun run build` exit 0; `bun run scripts/verify-terminal.ts` (10 Rust tests, 24 TS tests) exit 0. `src/server.ts` went from 661 lines to 49.

- MOD-01..02: `src/server/http.ts` (20 lines) holds `jsonResponse`, `errorResponse`, and `routeError` (the old `profileError`, same regular expressions and same `console.error(describeError(...))` side effect); `routes/types.ts` (7) holds `RouteContext` and `RouteHandler`. The suite asserts content type, `cache-control: no-store`, the JSON body, and one mapped status per error class.
- MOD-03..08: `routes/tasks.ts` (152), `routes/terminals.ts` (53), `routes/sessions.ts` (126), `routes/projects.ts` (91), `routes/roles.ts` (64), `routes/environment.ts` (81), plus `routes/shared.ts` (12) for `resolveWorkdir`. Each is a byte-identical move of its blocks: the route set is exactly 22 static method+path pairs on 18 distinct paths and 17 `RegExp` matchers, each appearing once. `routes/environment.ts` keeps the dev-server stop route's idempotent 200 from the previous slice.
- MOD-09: `routes/index.ts` (31 lines) gates on `/api/`, runs the modules in the original single-file order, and returns the original `{ error: "not found" }` 404 when no module claims the path. The suite proves the chain reaches the last module (`/api/dev-servers` 200) and that a non-API path is `null`.
- MOD-10: `server/shutdown.ts` (63 lines) is an unchanged move; `src/server.ts` re-exports `shutdownResources` so `browser.test.ts` needed no edit.
- MOD-11: `src/server.ts` is 49 lines (was 661) and keeps only the error-capture import, the TanStack Start entry lookup, the `fetch` export, and the shutdown registration.
- MOD-12: `routes/routes.test.ts` (245 lines, 16 tests) drives `handleApi` with real `Request` objects against a temp `SABER_DATA_DIR` and asserts a status and a body for each group, including the 428/409 task preconditions, the 405 for a revisions `GET`, the 400 validation paths, and specific 404 bodies so a deleted route cannot hide behind the dispatcher fallback. `routes/routeScan.test.ts` (89 lines, 4 tests) asserts the golden route set against the module sources.

## Review record

Two independent reviews (correctness, red team) ran on the first commit. No route body changed semantically; both confirmed the 22+17 route set and a 82-probe differential of old `handleApi` versus the dispatcher showed zero differences.

Fixed from review:
- Four dispatcher assertions expected a bare 404, which the fallback also returns, so deleting those routes would have stayed green. They now assert the handler's own body (`Task not found`, `Terminal session not found`, `Request could not be completed`), the follow-up route asserts its 400 `task is required`, and the verifications `POST` 400 was added.
- `scripts/generate-route-table.ts` scanned `src/server.ts` for `async function handleApi`, which the split deleted, so running it would have overwritten the committed table with "Found 0 routes". It now scans `src/server/routes/*.ts` through `src/server/routes/routeScan.ts`, throws on zero, and the regenerated table is 39 rows: the 22 exact pairs plus 17 matchers. The old 53-row table had invented a `PATCH /api/terminals/:id` row by reading the next block's method into the previous matcher's span; the scanner no longer guesses methods for regex routes and records `*` instead.
- The route-set invariant was only a manual comparison; `routeScan.test.ts` now makes it a gate.
- The providers test spawned real `opencode`/`codex`/`claude` auth checks (up to 8s each); `providerStatus` is mocked to keep the gate deterministic and the dispatcher suite at ~1.5s.
- `RouteContext.method` was dead; removed. The suite also clears the specialist-teams singleton alongside the store so a future `isolate: false` run cannot reuse a closed database.

Decisions: module order is irrelevant while route sets are disjoint, so the original order was kept to make a future overlap obvious; a wrong-method request is still a 404 because no module claims it, exactly as the single file behaved; and the git/browser-backed handlers are exercised by their existing suites rather than the dispatcher suite, because reaching them would spawn real work.

Remaining work: the dispatch chain is a linear scan of six modules with no per-path prefix index; that is deliberate at 30 routes and becomes a routing table if the route count grows. `roles.ts` owns `/api/tasks/:id/teams*` while `tasks.ts` owns the other `/api/tasks/:id/*` paths, so a future broad matcher in `tasks.ts` could shadow it; the golden test proves presence, not precedence. `server.ts` still depends on `@tanstack/react-start/server-entry` through a dynamic import, so its entry lookup is not unit-tested. `interventions: 0`.
