# Lifecycle and state stabilization (P0)

## Status and authorization

Status: Approved by the user on 2026-10-19. Implemented for task/run/terminal state and the stale-form guard. The dev-server and browser lifecycle rows are deferred to the process-lifecycle finding; see Completion evidence.
Authorizes scope only; implementation starts after user approval.

## Problem and user workflow

Agent runs, terminal sessions, dev servers, and the verification browser each track liveness in a different place. A forced process exit, a server restart, two rapid launch clicks, or two tabs editing the same task can leave SQLite, the in-memory process tables, and the UI disagreeing about what is running and what the task says. The user sees a run marked running with no process, a terminal lock with no shell, a dev server that survives its stop button, or an older task form silently overwriting a newer specification.

Before: each subsystem trusts its own last write. After: every state change follows a declared transition table, every lock is acquired and released under the same atomic guard, every shutdown and restart path reconciles to one consistent snapshot, and a stale form can never overwrite a newer task revision.

## Scope and exclusions

In scope: `src/server/agentRuns.ts`, `src/server/terminalLocks.ts`, `src/server/taskStore.ts`, `src-tauri/src/terminal.rs`, `src/server/devServers.ts`, `src/server/browser.ts`, plus the HTTP and Tauri seams that drive them.

Excluded: provider protocol changes, Git worktree semantics, profile revisions, verification rules, UI redesign. The 8090-8099 dev port range and the single shared verification browser stay as-is.

## Requirements and acceptance criteria

- LIFECYCLE-01 (legal transitions): task, run, terminal-session, workspace, and dev-server states change only along the documented tables. Any illegal transition is rejected naming the current state. Check: unit tests attempt every illegal edge and assert rejection.
- LIFECYCLE-02 (process-exit cleanup): when an agent child exits or errors, its run record reaches a terminal status exactly once and the process leaves the owned-process table. A second exit event is a no-op. Check: duplicate close/error events assert one terminal write and an empty process table.
- LIFECYCLE-03 (idempotent shutdown): stopping an already-stopped run, terminal, dev server, or browser returns success without side effects; a duplicate request cannot double-kill or resurrect the entry. Check: concurrent duplicate stops resolve successfully with one consistent record.
- LIFECYCLE-04 (restart reconciliation): on store open, every persisted `running` run becomes `interrupted`, and every non-stopped terminal session without a live PTY becomes `interrupted`; normal statuses are untouched. Check: reopen-store test plus reconcile test with empty live list.
- LIFECYCLE-05 (atomic locks): terminal reserve/release and run creation hold the same SQLite guard for check and write, so two simultaneous claims for one workspace produce one owner and one conflict error. Check: lock tests assert single ownership and no partial rows after a failed claim.
- LIFECYCLE-06 (stale-form protection): task updates carry the revision the form was rendered from; a write from an older revision is rejected as stale and newer text is preserved. Check: save with an older revision fails while stored spec keeps newer content.


## Data and lifecycle

Task: `revision` increments only when spec or criteria change and is the spec binding for runs and verification. `updatedAt` is a strictly monotonic per-task clock that moves on every write (`Math.max(Date.now(), previous + 1)`), so it is the optimistic-concurrency token. `updateTask` itself requires a finite `expectedUpdatedAt` (rejecting an ungated write), checks `expectedRevision` when present, and a miss is a 409 `stale_task`; the PATCH route maps the missing-token case to 428 `precondition_required`.

Run: `running -> done | stopped | error | interrupted`. `interrupted -> stopped`. Terminal states (`done`, `stopped`, `error`) accept no further transition. `finishRun` enforces this table.

Terminal session: `starting -> running | interrupted | stopped`. `running -> interrupted | stopped`. `interrupted -> stopped`. `stopped` is terminal. `setTerminalSessionStatus` enforces this; `recoverTerminalSession` requires explicit confirmation, and reconciliation never promotes `interrupted` back to `running`.

Task workspace: `provisioning -> ready`. `ready -> removed`. `removed` is terminal. Run worktree: `ready -> removed`. Both already enforced in `gitWorkspaces.ts`.

Dev server: `starting -> up | down`. `up -> down`. `down` is terminal. `stopDevServer` is idempotent and kills the process exactly once.

Browser: single shared page. `shutdown` is idempotent and clears all handles even when close throws.

Restart rule: persisted `running` runs become `interrupted` at store open; terminal sessions reconcile against the live PTY list. Neither path invents liveness.

Concurrency rule: SQLite `BEGIN IMMEDIATE` serializes check-then-write for terminal sessions and runs. In-memory `active`/`stopping` maps are cleanup-only caches, never authority.

## Verification plan

- LIFECYCLE-01: `bun run test -- src/server/taskStore.test.ts src/server/terminalLocks.test.ts src/server/agentRuns.test.ts` covers run/terminal tables; add missing edges.
- LIFECYCLE-02: duplicate close/error test in `agentRuns.test.ts`; assert single terminal write and empty `active` map.
- LIFECYCLE-03: idempotent stop tests for runs, terminals, dev servers, browser shutdown (browser/dev-server tests are new files).
- LIFECYCLE-04: reopen-store test plus reconcile test with empty live list.
- LIFECYCLE-05: existing SQLite lock tests plus a failed-claim row-count assertion.
- LIFECYCLE-06: new `updateTask` revision tests; frontend save sends `expectedRevision`, 409 surfaces as stale-form message.
- Full gates: `bun run test`, `bunx tsc --noEmit`, `bun run build`, PR Audit green.

## Completion evidence

Date: 2026-10-19. Gates: `bun run test` 25 files / 166 passed / 1 skipped; `bunx tsc --noEmit` exit 0; `bun run build` exit 0.

- LIFECYCLE-01 (legal transitions): implemented. `finishRun` enforces `running -> done|stopped|error|interrupted`, `interrupted -> stopped`, and rejects all other edges; `setTerminalSessionStatus` allows a same-state write as a no-op and rejects illegal edges, including `interrupted -> running`. Covered by `taskStore.test.ts` and `terminalLocks.test.ts`.
- LIFECYCLE-02 (process-exit cleanup): implemented for agent runs. `agentRuns.ts` guards `error` and `close` so the first terminal write wins and a duplicate event returns early after the process leaves the owned-process table; a failed output flush can no longer skip the terminal write, so a run cannot be stranded `running`. Dev-server, browser, and native-PTY exit cleanup remain open (see remaining work).
- LIFECYCLE-03 (idempotent shutdown): implemented for runs and terminal sessions. `AgentRuns.stop` returns quietly for an already-terminal run, and a `running` run that owns no process is settled to `interrupted` instead of leaving the workspace falsely locked; `setTerminalSessionStatus` treats a repeat status as a no-op. Dev-server `stopDevServer` and browser `shutdown` idempotency remain open.
- LIFECYCLE-04 (restart reconciliation): implemented. Store open marks persisted `running` runs `interrupted`; `reconcileTerminalSessions` leaves `stopped` and `interrupted` records alone, promotes only `starting` to `running`, and demotes anything not in the live list to `interrupted`. Covered by `taskStore.test.ts`.
- LIFECYCLE-05 (atomic locks): implemented. Terminal reserve and run creation check and write inside one `BEGIN IMMEDIATE` transaction; a failed claim leaves no partial row.
- LIFECYCLE-06 (stale-form protection): implemented. `updateTask` requires a finite `expectedUpdatedAt` (an ungated write throws `MissingPreconditionError`) and rejects a mismatched `expectedRevision`/`expectedUpdatedAt` with `StaleTaskError`; `updatedAt` is strictly monotonic so every write invalidates a form rendered from the previous state. The PATCH route maps `MissingPreconditionError` to 428 `precondition_required` and `StaleTaskError` to 409 `stale_task`. `TaskDetail` sends the revision and timestamp the form was rendered from, resyncs from the server when it has not diverged, keeps local edits and flags the conflict when it has (without deleting them), and discards a stale local draft only when the task is opened. Covered by `taskStore.test.ts` and `TaskDetail.test.tsx`.

Remaining work in this spec, deferred to the process-lifecycle finding: dev-server and browser state tables, their exit handlers, their idempotent shutdown, and native-PTY session reaping on natural exit. Two adjacent items found in review are also deferred: releasing a terminal lock only after the PTY exit is confirmed (`TerminalSurface.tsx`), and rejecting cross-site mutating requests (`Origin`/`Sec-Fetch-Site` check on the local API). `interventions: 0`.
