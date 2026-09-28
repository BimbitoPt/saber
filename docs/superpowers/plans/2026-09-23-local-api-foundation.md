# Local API Foundation Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline. The user asked to build and explicitly disallowed subagent delegation. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a stable, authenticated, loopback-only, read/review `/api/v1` contract while preserving Saber’s existing UI and terminal behavior.

**Architecture:** New API adapter modules validate `/api/v1` requests and map existing application services into stable DTOs. Authentication and network-origin protections run before resource handlers. The current unversioned API remains the UI compatibility surface; Tauri sidecar packaging is a separate follow-up.

**Tech Stack:** Bun, TypeScript, TanStack Start/Nitro, Node filesystem/crypto APIs, SQLite-backed existing services, Vitest, OpenAPI 3.1.

## Global Constraints

- Keep Saber a local-only modular monolith; do not add microservices, Docker services, or a database container.
- First CLI capabilities are read/review only; no API task/run/verification/workspace/terminal mutations.
- Require a private per-install bearer token and loopback transport.
- Keep raw PTY spawn/input/resize/output on the Tauri bridge, never the HTTP API.
- Preserve immutable run snapshots and task/run/terminal ownership boundaries.
- Keep port 8082 strict in development and bind it to loopback.
- Never edit generated `src/routeTree.gen.*` or `src-tauri/gen/**`.
- Use Bun for package management and scripts. Run `bun run test`, `bun run build`, and browser smoke.

---

## File map

| File | Responsibility |
| --- | --- |
| `src/server/apiV1.ts` | v1 routing, auth-before-handler, DTO projection, response envelopes, bounds and errors |
| `src/server/apiV1.test.ts` | Contract, auth, read-only, bounds, and redaction tests |
| `src/server/apiToken.ts` | Private token lifecycle and constant-time verification |
| `src/server/apiToken.test.ts` | Token generation/reuse and authorization behavior |
| `src/server/openapi.ts` | Checked-in TypeScript OpenAPI 3.1 document exported by the API |
| `src/server.ts` | Delegate `/api/v1/*` to adapter before legacy `/api/*` handling |
| `vite.config.ts` | Restrict development listener to loopback while retaining port 8082 strictness |
| `docs/architecture/saber-api-and-platform.md` | Update implementation status and actual route/runtime decisions |
| `docs/superpowers/specs/2026-09-23-local-api-foundation.md` | Record completion evidence against LAPI IDs |

No database migration is expected. If an existing service cannot provide a required projection, add a read-only method to that service and cover it with a focused test rather than querying SQLite from an HTTP handler.

## Task 1: Token lifecycle and auth primitive — LAPI-03

**Files:** create `src/server/apiToken.ts`, `src/server/apiToken.test.ts`.

**Interfaces:**

```ts
export function getOrCreateApiToken(options?: { dataDir?: string }): string;
export function hasValidBearerToken(header: string | null, expected: string): boolean;
```

Token file location is `<SABER_DATA_DIR or %USERPROFILE%/.saber>/api-token`. Generate at least 32 random bytes encoded as base64url. Use exclusive creation so concurrent starts do not replace the first token; reread the winner on `EEXIST`. Ensure directory creation uses user-private permissions on POSIX and inherits the current user profile ACL on Windows. Never log the token. Compare equal-length UTF-8 buffers with `timingSafeEqual`.

- [x] Write tests for new token entropy/format, stable reuse across calls, and concurrent create race preserving one value.
- [x] Write tests for missing/malformed/wrong/correct `Bearer` header.
- [x] Run the token test before implementation and observe the expected missing-module failure; rerun after implementation.
- [x] Create a 32-byte token in a private temporary file and link it atomically into the per-user `.saber` data directory; use `SABER_DATA_DIR` override.
- [x] Rerun focused tests. On Windows, inspect token ACL manually and record the result in the spec receipt; do not claim stronger ACL guarantees than observed.

## Task 2: DTO projections and OpenAPI contract — LAPI-01, LAPI-02

**Files:** create `src/server/openapi.ts`, extend `src/server/apiV1.ts`, add tests in `src/server/apiV1.test.ts`.

**Interfaces:**

```ts
export const openApiDocument: Readonly<Record<string, unknown>>;
export async function handleApiV1(request: Request): Promise<Response | null>;
```

Define read routes: `GET /api/v1/health`, `/openapi.json`, `/providers`, `/tasks`, `/tasks/{taskId}`, `/tasks/{taskId}/runs`, `/runs/{runId}`, `/runs/{runId}/events?after=&limit=`, `/tasks/{taskId}/verifications`, `/tasks/{taskId}/workspace`. Keep health minimal and allow it unauthenticated; authenticate the OpenAPI document and all resource reads. Use `{data:...}`, with collection `{items,nextCursor}`. Return stable DTOs with ISO timestamps and explicit enums. Exclude raw local paths, executable paths, native provider session IDs, environment data, DB internals, and raw event payloads that could expose secrets. Workspace review must return only review metadata and changed-file summary; do not expose full diff contents or absolute paths in this initial read API.

- [x] Add tests for task/run scoping, event sequence ordering and cursor continuation, verification, provider readiness, and workspace review projections using temporary task-store fixtures.
- [x] Add schema assertions that DTOs exclude internal fields and timestamps are valid ISO-8601 UTC.
- [x] Add OpenAPI 3.1 with documented methods, paths, bounds, response envelopes, status codes, and error schema; compare documented operations with actual handler routes in tests.
- [x] Implement DTO mappers that call existing stores/services (`getTaskStore`, provider readiness, `GitWorkspaceService.review`) and never write state.
- [x] Add bounded offset/sequence cursors (default 50, maximum 100) and deterministic event ordering. Invalid cursors return `400 cursor_invalid`; invalid limits return `400 validation_error`.
- [x] Run focused contract tests and inspect the live `/api/v1/openapi.json` document and authenticated task pagination.

## Task 3: Versioned router, auth gate, and safe errors — LAPI-01, LAPI-03, LAPI-05

**Files:** modify `src/server/apiV1.ts`, `src/server.ts`; extend `src/server/apiV1.test.ts`.

All `/api/v1/*` requests pass through loopback Host/Origin validation, body/query bounds, and auth before a resource handler. Allowed unauthenticated readiness is exactly `GET /api/v1/health`; health reveals only status and API version. Reads are no-store and JSON responses are capped at 2 MiB. Unknown routes return `404`; methods not allowed return `405` plus `Allow`. Return `{error:{code,message,requestId}}`; never expose thrown exception text.

- [x] Add tests that every resource route rejects missing bearer credentials with identical generic `401` bodies; malformed and incorrect bearer variants are also covered.
- [x] Add tests for minimal health, unknown route, unsupported method/Allow, accepted same-origin and rejected unexpected Origin, hostile Host, malformed cursor, oversized query/body/page response, no wildcard CORS, and no-store.
- [x] Add a sentinel-secret test that throws an internal exception and proves the secret/path is absent from response and captured logger output.
- [x] Delegate `/api/v1` requests from `src/server.ts` to `handleApiV1` before current `/api/*` handling; leave legacy routes unchanged.
- [x] Convert internal failures to generic `internal_error` responses with opaque request IDs and safe logs that contain no request headers or exception details.
- [x] Run focused tests and the full existing server test suite.

## Task 4: Bind development server to loopback — LAPI-04

**Files:** modify `vite.config.ts`, update `src/server/apiV1.test.ts` if config behavior is unit-testable.

- [x] Change Vite host from `"::"` to `"127.0.0.1"`, preserving port `8082` and `strictPort: true`.
- [x] Run `bun run dev` and verify it binds only to loopback and still serves the UI at `http://localhost:8082/`.
- [x] Send requests with same-origin loopback Host/Origin and hostile LAN Host/Origin; handler tests show only approved requests succeed.
- [x] Record the actual Windows listener and token ACL observations; Linux/macOS are untested.

## Task 5: Regression, docs, and spec receipt — LAPI-06, LAPI-07

**Files:** update architecture document, API spec completion evidence, and implementation plan checkboxes.

- [x] Run `bun run test` and resolve regressions in the changed slice: 82 tests passed across 15 files.
- [x] Run `bun run build`; it completed successfully.
- [x] Smoke-test the task board in the browser and verify existing task API responses. Tauri PTY behavior is unchanged and uses the earlier M2 Windows receipt.
- [x] Inspect all documented `/api/v1` methods; only GET is exposed. Inspect the live OpenAPI document.
- [x] Update architecture status/routes/security details to match implementation and retain the sidecar as an explicitly outstanding slice.
- [x] Record evidence by LAPI ID, commands, manual Windows checks, platform coverage, and remaining limitations in the spec.

## Self-review against the spec

- LAPI-01: Tasks 2–3 define all routes, stable errors, method rejection, and OpenAPI contract tests.
- LAPI-02: Task 2 defines task/run/event/verification/provider/workspace read projections and cursor behavior.
- LAPI-03: Task 1 provides the token; Task 3 applies it to every protected route; Task 4/manual checks confirm transport; the private bootstrap path is limited to future CLI config because this slice has no CLI consumer.
- LAPI-04: Tasks 3–4 cover Host/Origin checks, loopback listener, no wildcard CORS, and strict 8082 smoke.
- LAPI-05: Task 3 covers bounded input and output sizes, safe envelopes, request IDs, and secret/path redaction.
- LAPI-06: Task 5 runs regression and desktop checks; tasks 2–3 constrain v1 to GET-only projections.
- LAPI-07: Tasks 2 and 5 keep route adapters over existing services and align architecture documentation.

The Tauri-owned packaged sidecar and runtime selection are intentionally excluded from this slice and remain the next infra spec after API foundation verification.
