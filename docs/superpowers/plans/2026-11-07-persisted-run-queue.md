# Persisted run queue — implementation plan

Spec: docs/superpowers/specs/2026-11-07-persisted-run-queue.md (issue #17).

## Slice 1 — Core queue and lifecycle (this PR)

1. `src/lib/tasks.ts`: add `queued` to `RunStatus`, `launch` launch-plan and transient `queuePosition` fields on `RunRecord`, and the `Queued` status label.
2. `src/server/runQueue.ts`: `SABER_MAX_ACTIVE_RUNS` parsing (default 2, ceiling 16) and FIFO position annotation for run listings.
3. `src/server/taskStore.ts`: `createRun` accepts a queued initial status with a persisted launch plan; workspace conflict checks treat queued runs as claim holders; `finishRun` allows `queued -> stopped` only; `promoteRun` performs `queued -> running` without an end timestamp.
4. `src/server/agentRuns.ts`: strict FIFO queueing on start (capacity full or older work queued), extracted child wiring shared by start and promotion, serialized promotion passes that re-check process and terminal ownership, cancellation of queued runs, and `recoverQueued()` called once when the process singleton is created.
5. `src/server/terminalLocks.ts` and `taskStore.createTerminalSession`: terminal reservations reject queued workspaces with an actionable message.
6. Routes annotate run listings with queue positions; `openapi.ts` documents the new status.
7. UI: TaskDetail shows queued position with cancellation and disables launching while queued; SessionPane polls queued runs slowly until promotion.
8. Tests: `runQueue.test.ts` (config, positions), `agentRuns.test.ts` run-queue block (capacity, FIFO, cancellation, restart, blocked promotion, launch-plan replay), `taskStore.test.ts` (transitions, restart), `terminalLocks.test.ts` (queued claim).

## Slice 2 — Deeper integration (deferred)

- Queue-aware specialist teams: surface team-member queue positions in the team picker.
- Optional per-project concurrency ceilings on top of the global limit.
- Queue metrics (wait time, promotion latency) in the sessions view.

## Verification gates

`bunx tsc --noEmit`, `bun run test`, `bun run build`. Feature behavior evidence comes from the requirement-mapped tests in the spec's verification plan.
