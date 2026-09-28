# Task Attention Overview Implementation Plan

Goal: surface task-level attention states so developers can find work requiring action without opening each task.

Architecture: derive display state from existing task/run/verification summaries; test the classifier as a pure helper; add counts and state filters to the task sidebar.

Global constraints: Bun only; strict dev port 8082; do not persist derived state; preserve task selection and run/workspace records; no queue, notifications, or inferred wait-for-input lifecycle.

### Task 1: Derive attention states — TAO-01 — complete

Add a pure classifier and tests for all states and precedence collisions. Keep existing persisted statuses unchanged.

### Task 2: Add overview counts and filters — TAO-02, TAO-03 — complete

Add All and per-state filters with counts computed from the entire task list. Keep selected identity while hidden by the active filter, show a clear hidden-selection message, and restore its pane when the task becomes visible again.

### Task 3: Verify and record completion evidence — complete

Run the full test suite single-worker, direct installed TypeScript CLI, and production build. Restart on 8082 and verify filtering, counts, and selection retention. Write requirement-linked evidence and update AGENTS.md current slice. Results: 9 test files / 42 tests pass; TypeScript CLI passes; production build passes; browser checks confirm counts/filtering and selection restoration. See `docs/superpowers/specs/2026-09-22-task-attention-overview-verification.md`.
