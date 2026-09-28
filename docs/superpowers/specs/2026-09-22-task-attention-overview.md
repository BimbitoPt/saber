# Task attention overview

## Status and authorization

Approved implementation slice: the user asked to continue to the next product steps after criterion verification completed (2026-09-22). This implements the local task overview portion of MULTI-01 from the approved product direction.

## Problem and user workflow

When several tasks exist, their states are only visible one row at a time. The developer must scan the list to find active runs, failures, work ready for review, and verified results. On opening the workspace, a compact overview should make those attention states countable and filterable.

## Scope and exclusions

Derive one display state per task from its latest run and current verification summary. Show counts and filters for Running, Interrupted, Failed, Ready for review, Verified, Stopped, and Draft. Selecting a filter narrows the existing task list without changing task selection or persisted task/run state. Treat verification failure as Failed and current verified evidence as Verified. Do not add scheduling, queued or waiting-for-input states, notifications, concurrency limits, or change provider execution in this slice; those require additional lifecycle signals and their own spec.

## Requirements and acceptance criteria

- TAO-01: Every task maps to exactly one attention state with precedence Verified, Running, Interrupted, Failed, Ready for review, Stopped, then Draft. A failed verification summary is Failed; a run in `done` is Ready for review unless current criteria are verified; a stopped run is Stopped. Check the mapping with unit tests for every state and precedence collision.
- TAO-02: The overview displays a count and selectable filter for each attention state plus All. Counts use the complete task set, not the currently filtered list. Selecting a filter shows only matching tasks; All restores the full list. Check in the browser with each available state.
- TAO-03: Filtering does not alter the selected task, its checkpoint, draft, run, or workspace. A task selected before filtering remains selected when it matches; if hidden by a filter, the detail pane shows the filter context and selection returns when All is selected. Check by selecting, filtering away, and restoring.

## Data and lifecycle

Attention state is derived, not persisted. Task state comes from the latest run and current-revision verification summary already returned by the API. No run record or task identity changes. Stopped is distinct from failed and draft. Queue and waiting-for-input cannot yet be represented reliably and remain out of scope.

## Verification plan

Map state precedence with pure-function tests; run full Vitest, direct installed TypeScript CLI, and production build. Restart the app on strict port 8082 and verify counts, state filters, All restoration, and selection retention with the seeded task set. Record requirement-linked evidence in the matching verification document.
