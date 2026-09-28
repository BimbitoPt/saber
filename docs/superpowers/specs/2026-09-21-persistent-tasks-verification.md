# Persistent task verification

Date: 2026-09-21
Branch: codex/persistent-tasks
Scope: first persistent-task slice, not the full product roadmap.

## Automated checks

- `bun run test`: 4 files, 12 tests passed.
- `bun x tsc --noEmit`: passed.
- `bun run build`: passed for client, SSR, and Nitro node-server. Bundler emitted dependency directive and plugin-timing warnings; no build errors.
- `git diff --check`: passed; Git reported Windows line-ending conversion notices.

## Requirement evidence

| Requirement | Evidence |
| --- | --- |
| PT-01 | Created two tasks through the browser with specification and acceptance criteria. Both reappeared after server restart. SQLite close/reopen tests also passed. |
| PT-02 | Real OpenCode smoke task produced two distinct run IDs, retaining both attempts, captured specification, timestamps, and output. UI showed Ready for review, not verified. |
| PT-03 | Browser A -> B -> A restored distinct unsaved drafts and A's checkpoint. Saving A, refreshing, and restarting restored selection and saved text. B's separate local recovery draft also survived. |
| PT-04 | SQLite close/reopen test changed running to interrupted, retained completed status, and blocked a new attempt until interruption acknowledgment. |
| PT-05 | Test paged 2,105 events with no gaps. Split-line and multiple-line parsing tests passed. Real native session identity and output persisted across server restart; browser displayed the original response from history. |
| PT-06 | Tests covered concurrent checkout exclusion, sibling/root directory aliases, interrupted ownership, synchronous and asynchronous process errors, invalid patches, retained drafts, and cancellation preserving final output. |
| PT-07 | Tests confirmed older run specs remain unchanged after task edits and persisted prompt equals submitted prompt. Real follow-up reused the original OpenCode native session while creating a distinct run. |

## Live provider smoke test

Used a newly created empty temporary directory, not a user project. The initial read-only request returned `SABER_PERSISTENCE_OK`; a follow-up returned `SABER_FOLLOWUP_OK`. Both exited successfully, each had three stored events, and both used the same native OpenCode session. The temporary directory remained empty. The browser history selector exposed both attempts and rendered the original saved response after restart.

## Review fixes

An independent review identified exact-directory locking as insufficient for a Git checkout. Added checkout identity discovery and overlap checks, with tests for root and sibling subdirectories. The review also found prompt enhancement happened after snapshotting; enhancement now happens once before both storage and provider submission.

## Limits

Codex and Claude Code adapters, isolated worktrees, evidence-based verified completion, automatic context summarization, and performance targets remain future slices. Browser/dev-server panes remain shared. The run pane bounds rendered output to 300 display items; full persisted events are available through the paginated events API. Native desktop packaging was not exercised. Interrupted-process reconciliation is covered with storage tests; the live smoke attempts completed normally. Windows process-tree cancellation is implemented, but the real smoke tasks were allowed to finish rather than forcibly terminated.

Three clearly named verification tasks remain in local Saber storage as inspectable examples. No project code was changed by those smoke runs.
