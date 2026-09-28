# Recent task ordering in the switcher

## Status and authorization

Design approved by the user on 2026-09-23. The written spec was reviewed and approved before implementation.

## Problem and user workflow

When a developer keeps several tasks open, the task switcher presents them in the same list order regardless of which tasks they are actively moving between. The developer opens the switcher and should see recently selected tasks near the top, making return-to-context faster without changing task status or terminal ownership.

After selecting a task in the switcher, the user opens the switcher again and finds that task at the front of a short Recent group. Other tasks remain available in their existing task-list order.

## Scope and exclusions

Add a recency preference to the existing keyboard task switcher. Store at most eight unique task IDs in a dedicated local preference key. A successful switcher selection moves that task ID to the front and removes any previous copy. The switcher shows extant recent tasks first, then all remaining tasks in their existing source order. Searching continues to match task title, project basename, and full path across all tasks while preserving the recent-first ordering.

Ignore IDs that no longer map to a current task and deduplicate malformed/repeated IDs when reading the preference. Missing, invalid, or unavailable storage falls back to the existing task-list ordering without blocking the switcher. Recency is a UI preference only: it must not mutate task/run/checkpoint data, derive or write status, create a run, or alter task/session ownership. Selecting a task continues the existing terminal lifecycle; recent ordering adds no terminal-start request of its own.

Out of scope: manual pins, configurable limits, recency timestamps, cross-device synchronization, task/run schema changes, a second workflow status, task-list reordering, automatic task selection, command injection, and changes to terminal lifecycle.

## Requirements and acceptance criteria

- RTS-01: On open, show up to eight current tasks whose IDs appear in the stored recency list in most-recent-first order under a “Recent” heading. Show all other current tasks under “All tasks”, preserving their existing task-list order. With no valid recents, show the current task list as “All tasks”. Verify deterministic ordering with fixtures containing recent, non-recent, missing, and duplicate IDs.
- RTS-02: Selecting any task through the switcher moves its ID to the front of the stored list, removes duplicates, and caps the list at eight IDs. Verify selecting a current/recent task and selecting an older task, including eviction of the ninth ID.
- RTS-03: Search matches all current tasks by title, project basename, and full project path. Results retain recent-first ordering and section grouping; the existing case-insensitive search behavior remains. Verify title/path matching across both groups and the no-match state.
- RTS-04: Persist recency in a dedicated preference key separate from `saber.selectedTask`, task records, run records, and checkpoints. Selecting a task through the existing switcher path must not create a run or alter task/run/checkpoint state. Verify the stored preference and inspect the switch flow for task/run mutations.
- RTS-05: Missing, malformed, duplicate, stale-ID, or unavailable local preference data must not crash or prevent opening/searching/selecting. Invalid data is ignored and stale IDs are not rendered; storage write failure leaves the switcher usable with its in-memory ordering for the current mount. Verify malformed data and simulated read/write failures.
- RTS-06: Preserve keyboard and accessible interaction: Ctrl/Cmd+Shift+P, Arrow Up/Down, Enter, Escape, focus return, dialog/listbox semantics, selected task indicator, and derived status labels. Verify keyboard operation after the grouped list change in the browser and native Tauri window.

## Data and lifecycle

Use a dedicated local preference key, `saber.taskSwitcher.recents`, containing a JSON array of task IDs ordered most-recent-first. It is global to the local Saber frontend profile, not stored in a task, run, or checkpoint. The maximum list length is eight. Existing task IDs are authoritative: on render, join IDs against the current `TaskSummary[]`, ignore stale IDs, then append remaining tasks in source order.

On a switcher selection, first pass through the existing task selection flow; update recency for that selected ID without creating a second task/run/terminal operation. Query and active option index remain ephemeral. If preference parsing or reading fails, use the unranked source task order. If writing fails, keep the current in-memory ordering for the mounted workspace and allow the task selection to succeed. No migration is needed because the preference key is new.

## Verification plan

- RTS-01–RTS-03: Add focused unit tests for ordering, grouping, search, deduplication, stale IDs, and the eight-item bound.
- RTS-04–RTS-05: Test storage parsing and write failures; inspect selection flow to confirm only the dedicated preference changes and existing task/run APIs are untouched.
- RTS-06: Verify the grouped switcher with keyboard controls, focus behavior, status labels, and task selection in the browser preview and native Tauri app with an existing live shell.
- Run focused and full Vitest, `bunx tsc --noEmit`, `bun run build`, and `git diff --check` after implementation. Record outcomes and platform limitations against each requirement.

## Design self-review

- Scope is limited to an eight-ID local preference and switcher presentation; no task/run model changes.
- The existing task list remains the source of truth for task availability and status. Stale preference IDs cannot create phantom tasks.
- Read/write failures have explicit fallbacks, and the normal task-selection callback remains the only selection and terminal lifecycle entry point.
- Recent-first order applies to search results; grouping is based on whether each matched current task is in the valid recent set.
- No placeholders or conflicting behavior remain. Implementation plan and current completion evidence follow; native switch-away-and-back evidence is recorded below.

## Implementation and verification evidence

Implementation is present in src/lib/taskSwitcher.ts, src/components/TaskWorkspace.tsx, and src/components/TaskSwitcher.tsx.

| Requirement | Outcome | Evidence and limitation |
| --- | --- | --- |
| RTS-01 | Verified | Ten focused Vitest cases cover recent order, source order of remaining tasks, stale/duplicate IDs, and the eight-ID cap. Browser preview and native Tauri both rendered Recent before All tasks. |
| RTS-02 | Verified | Browser preview selected two tasks in sequence; the second moved to the front. The order remained after reloading the preview. Unit tests cover deduplication and ninth-item eviction. |
| RTS-03 | Verified | Existing case-insensitive title, basename, and full-path filtering tests pass. Browser preview searched across Recent and All tasks while preserving the groups. |
| RTS-04 | Verified by helper tests and code inspection | Storage tests assert the dedicated saber.taskSwitcher.recents key and JSON value. The change adds no task/run/checkpoint API calls or data fields; the existing select(id) path remains unchanged. |
| RTS-05 | Verified | Unit cases cover malformed JSON, wrong shape, duplicates, empty/non-string values, stale IDs, and storage read/write failures. |
| RTS-06 | Verified on Windows | Browser preview verified shortcut open, group labels, status/current labels, search, Arrow Down, Enter selection, Escape, and preference persistence. Native Tauri verified the grouped palette and A-B-A selection: selected the existing interrupted Verify context restoration task (which displayed its saved checkpoint and remained locked), then returned to Codex adapter smoke test and confirmed the same idle PowerShell prompt remained. No shell was started, unlocked, or sent a command. |

Checks passed: focused switcher suite (10 tests); full bun run test (13 files, 67 tests); bunx tsc --noEmit; bun run build; git diff --check. Browser preview started with no tasks, then showed the seven current smoke fixtures after reload. Two existing smoke tasks were selected and left in their existing state; the preview selection was restored to no task and Terminal view afterward. No provider run or terminal command was created or sent. Native A-B-A evidence used the idle PowerShell shell in the disposable Codex adapter smoke task; the other selected task was already interrupted and stayed locked. Linux and macOS remain untested.
