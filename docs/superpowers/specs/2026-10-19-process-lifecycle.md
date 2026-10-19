# Process lifecycle supervision

## Status and authorization

Status: Approved by the user on 2026-10-19 (the user selected "Process lifecycle (finding #3)" from the audit). Authorizes scope only; implementation proceeds after this document.

## Problem and user workflow

Dev servers, the verification browser, and the native PTY each manage their own lifecycle with no shared rules. Observed failures:

- A dev server that crashes keeps showing `up` (no exit handler), and its pane renders a stale status until the app restarts.
- Stopping a dev server fires `taskkill` and deletes the record without waiting for the kill, so the process can survive as an orphan; on POSIX `taskkill` does not exist and the spawn error is unhandled.
- A Bun/server restart empties the in-memory dev-server table while the OS processes keep running, and the port allocator can then hand out an occupied port.
- The verification Chromium is never shut down (`shutdown()` is exported but never called), so it outlives the app.
- A crashed or disconnected verification page is never cleared, so every screenshot returns 503 until the process restarts.
- `terminal_list` reports a PTY that has already exited, and the terminal record is then reconciled to `running`, locking the workspace behind a dead shell.
- If `terminal_close` fails, the frontend silently skips the release, leaving the record `running` with no signal and no reconciliation.

Before: each resource trusts its own last write and nothing reconciles after a restart. After: every spawned resource has an explicit lifecycle with a guaranteed exit handler, a bounded shutdown that always clears state, and a reconciliation path driven by real process liveness.

## Scope and exclusions

In scope: `src/server/devServers.ts`, `src/server/browser.ts`, `src/server.ts` shutdown wiring, `src-tauri/src/terminal.rs` liveness, and the terminal release/recover paths in `src/components/TerminalSurface.tsx`.

Excluded and tracked elsewhere: the `Origin`/`Sec-Fetch-Site` guard on the local API (finding #8); splitting `server.ts` into modules (finding #4); dev-server process-group creation and job-object tree kill at the OS level for hard kills (follow-up, noted in Completion evidence).

## Requirements and acceptance criteria

PROC-01 Dev-server state machine. States are `starting | running | stopping | exited | failed`. `starting -> running | failed`, `running -> stopping`, `stopping -> exited`, `failed -> exited`. Every spawned process registers `exit` and `error` handlers at spawn; an unexpected exit transitions to `exited` and the status is never stale. Trigger: the child exits on its own. Check: a unit test spawns a fake child, emits `exit`/`error`, and asserts the status is `exited` and the entry is no longer reported as running.

PROC-02 Dev-server stop is idempotent and bounded. Stop on an unknown or already-stopped entry returns success without side effects (no 404 from the route). Stop marks `stopping`, terminates the process tree (Windows `taskkill /T /F`; POSIX a signal to the process group, falling back to `SIGKILL`), waits with a bounded timeout, and always clears the entry. Trigger: stop twice; stop an unknown name. Check: unit tests assert both are no-ops that return success and that a stop that times out still clears the entry.

PROC-03 Dev-server reconciliation and shutdown. A start over an entry whose process is gone respawns rather than returning the cached port. The manager exposes `reconcile()` (drop entries whose process is not alive) and `stopAll()` (bounded stop of every entry), and the server calls both on shutdown. Trigger: server restart; app close. Check: unit tests assert `reconcile()` drops a dead entry, a start after that allocates a fresh port, and `stopAll()` leaves no entries.

PROC-04 Browser state machine. States are `idle | launching | ready | failed`. A `disconnected` browser or a closed/crashed page resets the state so the next `ensurePage()` relaunches. A partial launch failure (context or page creation throws) must not leak the browser handle. Check: unit tests with an injected launcher assert that a disconnect causes the next `ensurePage()` to relaunch, and that a failure mid-launch leaves no handle.

PROC-05 Browser shutdown is bounded and always clears handles. `shutdown()` closes the browser with a bounded wait, clears every reference even when close rejects, and runs on server shutdown so Chromium cannot outlive the app. Check: unit tests assert a rejecting close still clears state, and that the shutdown hook invokes it.

PROC-06 PTY liveness authority. `terminal_list` returns only processes that are actually alive, reaping entries whose child has exited, so the snapshot is a true liveness report. `terminal_close` always drops the map entry once the process is gone, even if reaping reports an error, and never drops it while the process is confirmed alive. Check: `cargo test` covers the reaping and the confirmed-close paths.

PROC-07 Terminal release follows confirmed exit. If `terminal_close` fails, the frontend reconciles the session record against the live PTY list instead of assuming `stopped`, so a live PTY keeps its lock and a dead one becomes `interrupted`. Trigger: `terminal_close` rejects. Check: a unit test injects a rejecting close and asserts reconcile runs with the live list and no release occurs.

PROC-08 Recovery refuses a live PTY. Recovering an `interrupted` session is rejected while its id is present in the live PTY list. Trigger: the user confirms recovery while the shell is still alive. Check: a unit test asserts the refusal and that `recoverTerminalSession` is not called.

## Data and lifecycle

Dev servers and the browser are process-lifetime resources owned by the server process: in-memory state, no SQLite. The process supervisor (the child handle / Playwright browser) is authoritative for liveness; the in-memory entry is a projection of it, and `reconcile()` realigns the projection after a restart. Terminal sessions stay persisted in SQLite, with the native PTY table as the authority: reconcile promotes only ids the PTY reports live and never promotes `interrupted` (established in the P0 slice). Shutdown order is: stop dev servers, shut down the browser, then release terminal sessions.

## Verification plan

- PROC-01..05: new `src/server/devServers.test.ts` and `src/server/browser.test.ts` with injected process/launcher fakes.
- PROC-06: `cargo test --manifest-path src-tauri/Cargo.toml terminal_session -- --nocapture`.
- PROC-07..08: new `src/lib/terminalLifecycle.test.ts` covering the extracted close/recover decision, plus the existing terminal suites.
- Full gates: `bun run test`, `bunx tsc --noEmit`, `bun run build`, `bun run scripts/verify-terminal.ts`, PR Audit green.

## Completion evidence

Date: 2026-10-19. Gates: `bun run test` 28 files / 203 passed / 1 skipped; `bunx tsc --noEmit` exit 0; `bun run build` exit 0; `bun run scripts/verify-terminal.ts` (10 Rust tests, 24 TS tests) exit 0.

- PROC-01..03 (dev servers): implemented in the rewritten `src/server/devServers.ts`. `DevServerManager` owns the `starting | running | stopping | exited | failed` machine, registers `exit`/`error` at spawn (first death wins, so a crash can never read `up`), stops idempotently through a bounded kill that always clears the entry, allocates only ports no live entry or probe holds, and exposes `reconcile()`/`stopAll()`. The wire status stays `starting | up | down` (`src/lib/api.ts` is unchanged); richer states map to `down`. Covered by `src/server/devServers.test.ts` (12 tests, injected child/probe/kill fakes).
- PROC-04..05 (browser): implemented in the rewritten `src/server/browser.ts`. `BrowserSession` owns `idle | launching | ready | failed`, resets on `disconnected`/page `close`/`crash` so the next `ensurePage()` relaunches, closes a partially-created handle on a mid-launch failure, and shuts down under a bounded wait that clears every reference even when `close()` rejects. Covered by `src/server/browser.test.ts` (11 tests, injected launcher).
- PROC-06 (PTY liveness): implemented in `src-tauri/src/terminal.rs`. `list()` reaps exited children so the snapshot is a true liveness report; `close()` drops the entry once the process is gone (surfacing a failed reap) and keeps it only while the process is confirmed alive. Covered by `cargo test` (8 new `terminal_session` tests).
- PROC-07..08 (terminal release and recovery): implemented as effect-injected helpers in `src/lib/terminalLifecycle.ts` and wired into `src/components/TerminalSurface.tsx`. A failed `terminal_close` reconciles against the live PTY list instead of releasing (live PTY keeps its lock; a gone PTY becomes `interrupted`; an unreadable list leaves the lock and surfaces the failure), and recovery is refused while the id is still live. Covered by `src/lib/terminalLifecycle.test.ts` (14 tests).
- Shutdown: `src/server.ts` registers idempotent `SIGINT`/`SIGTERM` hooks that reconcile dev-server entries, stop them, then shut down the browser.

Deviations from the draft scope, both reviewed: the dev-server spawn now resolves the Bun binary through `resolveBunBinary` (Bun's `which`, then `SABER_BUN_PATH`, then the previous Windows npm path, then `bun` on PATH) instead of a hardcoded `%USERPROFILE%` path, because the packaged app runs a bundled Node where `process.execPath` is not Bun; and `POST /api/dev-servers/stop` now returns `{ ok: true }` for an unknown project (idempotency) instead of 404.

Remaining work: dev-server children are still not spawned detached and hard-killed through a process group or Windows job object (the POSIX branch is best-effort `SIGTERM`/`SIGKILL`); graceful desktop-close teardown cannot be observed on Windows because Tauri terminates the sidecar without a signal, so the signal hook is the only in-scope path; and the `Origin`/`Sec-Fetch-Site` guard on the local API remains finding #8. `interventions: 0`.
