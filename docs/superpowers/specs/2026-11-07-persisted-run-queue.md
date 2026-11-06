# Persisted global run queue

## Status and authorization

**Status:** Approved for implementation.
**Date:** 2026-11-07.
**Authorization:** The repository owner requested autonomous issue and pull-request work. This bounded feature slice is tracked by issue #17.

## Problem and user workflow

`AgentRuns.start()` validates workspace conflicts and then spawns a provider process immediately. There is no global cap on concurrently live provider runs, so independent tasks can launch an arbitrary number of agent processes at once. The product direction (MULTI-01 / PERF-01) calls for a configurable concurrency limit with queueing of excess runs.

Before: launching a fourth run while three are active starts a fourth agent process. After: with the limit configured to three, the fourth request is persisted as queued, holds its workspace, and starts automatically when an active run settles.

## Scope and exclusions

In scope: a configurable global active-run limit, a persisted FIFO queue for excess eligible runs, distinct queued lifecycle states, promotion that re-checks workspace and terminal ownership, restart recovery, queue position in the runs API, and task UI visibility including cancellation.

Out of scope: cloud execution, distributed scheduling, team collaboration, per-project limits, queue reprioritization, and automatic retry of interrupted runs.

## Requirements and acceptance criteria

### RUN-QUEUE-01 — Configurable limit with a safe default

The maximum number of concurrently live provider runs is read from `SABER_MAX_ACTIVE_RUNS` (integer 1-16). Unset defaults to 2. Invalid values are rejected with an explanatory error.

Acceptance: `bun run test -- src/server/runQueue.test.ts` covers the default, valid overrides, and every rejected shape.

### RUN-QUEUE-02 — Overflow is persisted as queued, not spawned

When the limit is reached, an eligible request is stored with status `queued` and its launch plan (provider, model, read-only flag, follow-up flag) persisted on the run record. No provider child is spawned.

Acceptance: with the limit at 1 and one active run, a new request persists as queued and the spawn spy count stays at 1 (agentRuns run-queue tests).

### RUN-QUEUE-03 — Distinct lifecycle states

`queued`, `running`, `interrupted`, `error`, `stopped`, and `done` remain distinct. A queued run is never represented as a live process; cancelling it settles it as `stopped` and records a `run_cancelled` event.

Acceptance: store transition tests reject `queued -> done`, `queued -> running` via `finishRun`, and cancellation tests assert no spawn and a stopped record.

### RUN-QUEUE-04 — Workspace isolation on promotion

A queued run claims its workspace from acceptance: another run or an interactive terminal cannot claim it. Promotion re-checks process ownership and terminal locks; a blocked run stays queued while other eligible work promotes past it. Promotion order is FIFO by acceptance.

Acceptance: queue tests cover workspace rejection, terminal reservation rejection, and blocked-head promotion.

### RUN-QUEUE-05 — Safe restart recovery

Restarting Saber preserves queued runs as queued and never marks a run as running unless a process was confirmed live: runs persisted as `running` are marked `interrupted` by the existing recovery and are never retried automatically. Queued work is promoted when the process can own provider children again.

Acceptance: reopening the store keeps queued records queued while marking running records interrupted; a fresh `AgentRuns` instance promotes queued work exactly once (spawn count assertions).

### RUN-QUEUE-06 — Queue visibility and control

The runs API annotates queued runs with their 1-based FIFO position. The task UI shows queued state and position, keeps the launch form disabled while work is queued, and offers cancellation. A promotion or cancellation is visible in the run event stream (`run_queued`, `run_promoted`, `run_cancelled`).

Acceptance: `annotateQueuePositions` tests assert positions; TaskDetail renders queued position and cancellation; SessionPane keeps polling at a slow interval while queued so promotion is picked up.

## Data and lifecycle

Ownership: runs and their launch plans live in the existing `runs` table; no new tables. State transitions: `queued -> running` (promotion, `promoteRun`), `queued -> stopped` (cancellation, `finishRun`); `running -> done/stopped/error/interrupted` unchanged. Concurrency: promotion passes are serialized per process (`promotionInFlight`); the store's transactional conflict check treats `queued` like `running`/`interrupted` for workspace claims. Restart: queued records survive; interrupted records require the existing explicit acknowledgment. Immutable: the assembled prompt and captured scope of an accepted run never change between acceptance and promotion.

## Verification plan

| Requirement | Verification |
| --- | --- |
| RUN-QUEUE-01 | `bun run test -- src/server/runQueue.test.ts` |
| RUN-QUEUE-02 | `bun run test -- src/server/agentRuns.test.ts` (run-queue block) |
| RUN-QUEUE-03 | Store transition tests in `src/server/taskStore.test.ts` |
| RUN-QUEUE-04 | Workspace/terminal claim tests in `agentRuns.test.ts` and `terminalLocks.test.ts` |
| RUN-QUEUE-05 | Reopen tests in `taskStore.test.ts` and recovery test in `agentRuns.test.ts` |
| RUN-QUEUE-06 | Position annotation tests plus `bun run build` and CI UI checks |
| Regression | `bunx tsc --noEmit`, `bun run test`, `bun run build` |

## Completion evidence

Pending CI and review. A successful build alone does not establish queued-work behavior; the run-queue tests above are the requirement-mapped evidence for this slice.
