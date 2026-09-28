# Kanban task board

## Status and authorization

Approved design: the user requested a Kanban board for To do, Running, Ready for review, and other task states, then chose a board derived from real task/run/verification state and approved the Board/List design on 2026-09-22.

## Problem and workflow

The current task workspace provides a task list with status filters. That is useful for finding a state but does not give a quick visual overview of work moving through the agentic-development lifecycle. The user needs a board to see backlog tasks, active work, review-ready work, verified work, and exceptions together.

## Scope and exclusions

Add a Board/List view switch to the task workspace. The board presents five derived lanes: To do (Draft), Running, Ready for review, Done (Verified), and Needs attention (Failed, Interrupted, Stopped). Cards show task title, project, spec revision, and relevant run/verification state. Selecting a card opens the existing task details while preserving selection; the board remains available via the view switch. Counts and cards update from the same two-second task refresh already used by the workspace. Provide a New task action from the board.

Board state is never manually edited. Run actions and criterion verification remain the only way to advance derived states. Keep the existing list and filters intact. Do not add drag-and-drop, a second persisted workflow status, queueing, waiting-for-input detection, notifications, or preview changes. Board columns scroll horizontally when needed; task cards remain keyboard accessible and show text state labels without relying on color.

## Requirements and acceptance criteria

- KAN-01: Every task appears in exactly one board lane using the existing attention-state derivation: draft -> To do; running -> Running; ready_for_review -> Ready for review; verified -> Done; failed/interrupted/stopped -> Needs attention. Each lane count equals its visible card count. Verify with unit tests covering every state and count.
- KAN-02: A user can switch between Board and List without losing the selected task. Selecting a board card opens that task in the existing detail view; switching back to Board retains the selected card. The board's New task action opens the existing task form. Verify in the browser.
- KAN-03: A run completion or new verification result changes a task's lane through the existing periodic refresh, with no manual status field or database migration. Verify at least Ready for review and Needs attention transitions in tests/browser using the current task state and focused smoke data.
- KAN-04: Board lanes use the existing visual system, show text state labels and counts, fit the desktop workspace, and remain horizontally scrollable at narrower widths. Verify keyboard focus, visible lane labels/counts, and an app browser inspection at the normal viewport.

## Data and lifecycle

Attention remains derived through `taskAttentionState` and its tests. No board-specific state is persisted. Selection remains the existing `saber.selectedTask` value. The current list filters continue to derive from the same state function. State updates arrive through the existing `/api/tasks` refresh; no new scheduler or provider event semantics are introduced.

## Verification plan

Add a pure grouping test proving every task appears exactly once in the correct lane and counts reconcile. Run full Vitest single-worker, direct installed TypeScript CLI, and production build. Restart dev on strict port 8082 and verify Board/List switching, card selection, New task, current state lane mapping, and visible board controls in the browser. Record evidence by KAN requirement in the matching verification document. Claude Code live testing remains skipped as previously requested.
