# Local API foundation and read/review contract

## Status and authorization

**Status:** Approved by the user on 2026-09-23; implementation in progress. Scope follows the approved local-only desktop API, read/review-only future CLI, and private per-user token.

## Problem and user workflow

Saber already has useful same-origin `/api/*` routes for its UI, but they are not a stable or safe external contract: route shapes and errors vary, the server binds beyond loopback in development, and powerful local controls coexist with read operations. A future Saber CLI needs a deliberately limited contract for inspecting tasks and reviewing work without direct database access or the ability to mutate workspaces or launch processes.

After this slice, an authenticated local client can read Saber health, provider readiness, tasks, runs/events, verification evidence, and workspace review. Requests from unauthenticated, cross-origin, non-loopback, malformed, or oversized contexts fail consistently. The desktop UI continues to work through current internal routes during gradual migration.

## Scope and exclusions

**In scope:**

- OpenAPI 3.1 document for the first read/review `/api/v1` contract.
- Validated DTOs and stable success/error envelopes at the v1 API boundary.
- Per-install private bearer-token generation/storage for a future CLI running as the same OS user.
- Loopback-only bind configuration, Host/Origin checks, no wildcard CORS, bounded inputs, token redaction, and unauthorized response handling.
- Read-only health, provider readiness, task list/detail, task runs, run detail/events cursor, verification records, and workspace review routes.
- Route-level contract and security tests, while retaining existing unversioned routes for the UI.
- A runtime/package spike plan for Tauri-owned server sidecar; packaged sidecar implementation belongs to its own following slice after the API foundation is reviewed.

**Excluded:**

- API task creation/editing, verification writes, run start/stop/follow-up, workspace create/remove/merge, dev-server/browser controls, or PTY commands.
- Remote/LAN access, cloud API, account system, multiple users, microservices, Docker services, DB container, provider installation or authentication.
- CLI executable, token rotation/revocation command, or desktop WebView bootstrap; the current UI continues using unversioned internal routes.
- Repository-wide directory migration or changing the existing database schema unless a specific defect prevents the read contract.
- Production packaging claims until the sidecar runtime spike and clean-install evidence are complete.

## Requirements and acceptance criteria

### LAPI-01 — Versioned, read-only contract

The server serves the documented `/api/v1` read/review routes using DTOs separate from SQLite rows and UI state. The checked-in OpenAPI document matches actual method, path, query, status, response, and error behavior. Unknown routes return a stable `404`; unsupported methods return `405` and an `Allow` header. No `/api/v1` endpoint performs a write or process-control side effect.

**Acceptance:** contract tests exercise every OpenAPI operation against handlers and validate responses against schemas. Tests attempt mutation methods against each resource and prove no task, run, verification, workspace, or terminal state changed.

### LAPI-02 — Useful task and run review

An authenticated caller can list tasks and fetch one task; read provider readiness; list/get runs scoped to a task; retrieve ordered run events from an opaque or monotonic cursor; read criterion verification; and review the task workspace. Responses use stable DTO names, explicit enums, ISO-8601 UTC timestamps, bounded pagination, and do not reveal native provider session IDs, executable paths, environment values, or database layout.

**Acceptance:** fixtures with multiple tasks/runs prove scoping and event ordering/cursor continuation; missing IDs return `404`; invalid cursors return a documented validation error; OpenAPI schema checks ensure disallowed internal fields are absent.

### LAPI-03 — Local token authentication

Each installation has one cryptographically random bearer token stored in a private per-user configuration location. Token generation is atomic and does not overwrite an existing token on restart. The token is not returned by the health endpoint, placed in a URL, passed as a process argument, saved in browser local/session storage, or emitted in logs. Private transfer to the UI and future CLI uses a local bootstrap/config mechanism with restrictive OS permissions.

Every `/api/v1` resource except an explicitly minimal unauthenticated readiness endpoint requires `Authorization: Bearer <token>`. Missing, malformed, and incorrect credentials return the same generic `401` envelope. Token comparison is constant-time where supported. The current UI continues using internal unversioned routes; the private token file is the future CLI bootstrap source under the same OS user. Neither the API nor health route returns the token.

**Acceptance:** tests prove token creation/reuse, permission policy on the supported OS, auth gate behavior for every route, and absence of token text from captured logs and HTTP bodies. Manual Windows inspection verifies the file ACL is private to the current user.

### LAPI-04 — Loopback and browser-origin protections

The API listener accepts only IPv4/IPv6 loopback addresses. It rejects non-loopback Host values and unexpected Origin values. It does not emit wildcard CORS. Requests lacking Origin from the future CLI remain valid when authenticated. Development remains on strict port 8082 but binds loopback only; packaged dynamic port selection is a later runtime slice.

**Acceptance:** automated request/listener tests prove loopback binding and rejection of hostile Host/Origin and preflight requests. On Windows, inspect listener addresses and verify another machine/LAN interface cannot connect. Confirm `bun run dev` still serves the UI at `http://localhost:8082/`.

### LAPI-05 — Safe limits and errors

The API bounds request body bytes, query length, page size, cursor size, and JSON response bytes. Failures return `{error:{code,message,requestId}}`, use documented status codes, and never serialize stack traces, filesystem paths, command lines, environment values, or provider secrets. Success resources use `{data:...}` and lists have a stable cursor container. Responses are `no-store`. Stable errors include `unauthorized`, `validation_error`, `cursor_invalid`, `not_found`, `conflict`, `operation_not_allowed`, `response_too_large`, and `internal_error`; the OpenAPI document itself is returned as a standard OpenAPI JSON document.

**Acceptance:** tests cover malformed path encoding, oversized query/body declarations, oversized page responses, invalid pagination, unknown resources, workspace conflicts, and unexpected internal errors. Assert the response shape and verify a sentinel secret/path inserted into an internal exception does not appear in the response or logs.

### LAPI-06 — Preserve existing product invariants

The API read models do not change task/run/terminal ownership. Run scope remains an immutable snapshot. A task shell remains distinct from an agent run. Existing UI routes remain behavior-compatible during migration, and CLI routes cannot create or control PTYs.

**Acceptance:** existing `bun run test` passes; focused integration tests prove run snapshots and terminal records are unchanged by all read calls; manual UI smoke confirms task board, task workspace, provider controls, and terminal startup still work.

### LAPI-07 — Keep architecture modular and local

HTTP routing/DTO parsing is an adapter to existing application services; do not add independently deployed services or duplicate domain rules. The architecture note documents frontend, Tauri host, sidecar/API, data, provider, terminal boundaries, target stack, trust model, release packaging, delivery slices, and deferred decisions.

**Acceptance:** code review confirms API route modules call existing application services and no HTTP handler directly changes persistence outside those services; architecture documentation reflects the implemented first slice and calls out remaining release work.

## Data and lifecycle

This slice reads current SQLite-backed task, run, event, verification, workspace, and provider data. It introduces no product table migration. The local bearer token is separate from task data and stored under Saber’s per-user private config directory. On restart, an existing token is reused. Deleting or rotating the token is not part of this slice; future explicit rotation must invalidate old credentials without breaking the desktop bootstrap.

Runs retain their captured task specification/context/revision and provider session remains private. Events are read in deterministic sequence order and cursor continuation must not skip or duplicate events. Terminal sessions remain Tauri-owned and are not represented as controllable v1 resources.

Development server binds `127.0.0.1` (and/or `::1` as deliberately configured) on strict port 8082. Production sidecar uses an OS-selected free loopback port and an owned readiness/shutdown lifecycle in a subsequent slice. A health response is minimal and does not disclose the token or local machine details.

## Verification plan

| Requirement | Automated verification | Manual verification |
| --- | --- | --- |
| LAPI-01 | OpenAPI operation/handler contract tests; mutation-method invariance tests | Inspect checked-in OpenAPI and route list |
| LAPI-02 | DTO schema tests, task/run scoping, cursor order/continuation, field allowlist tests | Read a real task/run/workspace through API and compare to UI |
| LAPI-03 | Token lifecycle, all-route auth matrix, generic 401, response/log redaction tests | Inspect token location ACL and restart reuse on Windows |
| LAPI-04 | Listener binding and hostile Host/Origin/CORS tests | Check localhost app at port 8082 and listener binding on Windows |
| LAPI-05 | Body/query/page-response bounds, error mapping, secret/path redaction tests | Trigger malformed/oversized request and inspect safe error |
| LAPI-06 | Full Vitest suite plus run/terminal invariance tests | Open desktop, switch task, use terminal, inspect provider/task UI |
| LAPI-07 | Module-boundary review | Review updated architecture and API docs |

Run `bun run test`, `bun run build`, and strict-port development smoke at `http://localhost:8082/`. The sidecar packaging spike and clean-install check are required before production release, not completion of this API-only slice. Report Windows-tested versus Linux/macOS-unverified status explicitly.

## Completion evidence

**Verified on Windows, 2026-09-23.**

- **LAPI-01:** The OpenAPI 3.1 document is served at `GET /api/v1/openapi.json`. Contract tests check that all documented operations are GET-only; mutation attempts for each documented path return `405` with `Allow: GET`; unknown API paths, including `/api/v1`, return `404`.
- **LAPI-02:** Handler tests cover task/run/verification scoping, provider readiness, workspace review projection, ISO UTC timestamps, missing and malformed IDs, event order/cursor continuation, and omission of absolute project paths, native provider IDs, diffs, raw output, and message text. Live token-authenticated task pagination returned a two-item page with a next cursor.
- **LAPI-03:** Token tests cover 32-byte base64url format, reuse, concurrent creation, and bearer comparison. On Windows the file owner was the current user; ACL inspection found no Everyone, Authenticated Users, or built-in Users ACE. Live unauthenticated task access returned `401`; authenticated access succeeded. The token value was not included in output or logs.
- **LAPI-04:** `vite.config.ts` binds to `127.0.0.1` and retains strict port 8082. `Get-NetTCPConnection` showed only the `127.0.0.1` listener. Handler tests reject hostile Host and Origin values; the browser loaded Saber at `http://localhost:8082/`.
- **LAPI-05:** Tests cover safe request IDs/envelopes, invalid cursors, oversized query/body declarations and oversized page responses, safe internal failures, no wildcard CORS, and no-store behavior. The sentinel path/secret did not appear in the response or captured logs.
- **LAPI-06:** All 82 Vitest tests passed across 15 files. The running browser showed the existing task board and existing tasks. Existing `/api/tasks` returned its legacy task list. The current M2 Tauri terminal receipt remains the terminal-specific Windows verification; the API slice does not modify the native PTY bridge.
- **LAPI-07:** HTTP handling is separated into `src/server/apiV1.ts`, token handling into `src/server/apiToken.ts`, and the contract into `src/server/openapi.ts`; handlers use existing task/provider/workspace services and introduce no database schema changes or service deployments.
- `bun run build` passed. Build output includes existing Rolldown warnings about dependency-level `"use client"` directives; these did not fail the build.

**Remaining:** no CLI executable or token bootstrap command is implemented. The packaged Tauri-owned sidecar, dynamic port/readiness/shutdown, clean-install verification, and Linux/macOS verification remain future slices. The current token file lives at `%USERPROFILE%\\.saber\\api-token` by default; it is private to the current Windows user under the observed ACL.
