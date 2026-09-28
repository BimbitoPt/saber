# Recent task ordering in the switcher Implementation Plan

> **For agentic workers:** Execute inline in this shared checkout, task by task. Steps use checkbox syntax for tracking.

**Goal:** Put up to eight recently selected tasks at the top of the task switcher without changing task, run, checkpoint, or terminal state.

**Architecture:** Keep recent-ID parsing, recency updates, and task grouping as pure functions in src/lib/taskSwitcher.ts. TaskWorkspace owns the preference state and persists it under a dedicated localStorage key; the existing selection path remains authoritative. TaskSwitcher filters the grouped current task catalog and renders Recent and All tasks sections with the existing derived statuses and keyboard behavior.

**Tech Stack:** Bun, React, TypeScript, TanStack Start, Vitest, Tauri v2, existing localStorage preferences.

## Global Constraints

- Use Bun for package commands and Vitest for tests.
- Do not edit src/routeTree.gen.* or src-tauri/gen/**.
- Keep terminal sessions distinct from agent runs; do not change task/run ownership or immutable run scope.
- Do not add task/run/checkpoint fields or status values.
- Do not add a terminal-start request beyond the existing task-selection behavior; do not create a provider run or inject commands/context.
- Preserve the current task-list order for all non-recent tasks.
- Keep preference failures non-blocking and keep task selection in the existing select(id) flow.

---

## File map

- Modify src/lib/taskSwitcher.ts: add bounded recent-ID parsing/update and stable grouping of current tasks.
- Modify src/lib/taskSwitcher.test.ts: cover valid ordering, duplicate/stale IDs, filtering across groups, cap/eviction, and preference storage failures.
- Modify src/components/TaskWorkspace.tsx: load recents once, update in-memory preference optimistically on switcher selection, and persist under saber.taskSwitcher.recents without changing selection behavior.
- Modify src/components/TaskSwitcher.tsx: receive recent IDs and display filtered grouped results while retaining dialog, focus, keyboard, and status behavior.
- Update docs/superpowers/specs/2026-09-23-recent-task-switcher-design.md: record requirement-level completion evidence and platform limits.
- Update docs/roadmaps/2026-09-22-terminal-first-saber.md: identify M5 completion and the next roadmap decision.

## Task 1: Implement and test recent-ID and grouping functions — RTS-01, RTS-02, RTS-03, RTS-05

Files: src/lib/taskSwitcher.ts, src/lib/taskSwitcher.test.ts.

Interfaces:
- RECENT_TASK_LIMIT = 8
- parseRecentTaskIds(raw: string | null): string[]
- moveTaskToFront(recentIds: string[], taskId: string): string[]
- groupTasksForSwitcher(tasks: TaskSummary[], recentIds: string[]): { recent: TaskSummary[]; all: TaskSummary[] }
- filterTasksForSwitcher(tasks: TaskSummary[], query: string): TaskSummary[]

- [x] Step 1: Add tests for stored preference parsing: null, invalid JSON, non-array JSON, empty IDs, duplicate IDs, non-string entries, and more than eight IDs. Valid output is unique ordered non-empty strings capped at eight; malformed input returns [].
- [x] Step 2: Run bun run test -- src/lib/taskSwitcher.test.ts; the tests first failed with the new exports missing.
- [x] Step 3: Add recency update tests. moveTaskToFront(["a", "b", "a", "c"], "b") returns ["b", "a", "c"]; inserting a ninth distinct task into an eight-ID list evicts the last ID.
- [x] Step 4: Add grouping tests. With source tasks [a,b,c,d] and recents [c,a,missing,c], return recent [c,a] and all [b,d]. Empty or wholly stale recents return all source tasks in all.
- [x] Step 5: Implement pure helpers. Parse JSON inside try/catch; accept only non-empty strings; deduplicate in input order; cap at eight. Update by filtering the selected ID before prepending it. Group by intersecting current tasks with the unique recent-ID set while preserving source order within each group.
- [x] Step 6: Run bun run test -- src/lib/taskSwitcher.test.ts; all 10 focused cases pass.

## Task 2: Add an isolated, failure-safe preference lifecycle — RTS-02, RTS-04, RTS-05

Files: src/components/TaskWorkspace.tsx, src/lib/taskSwitcher.ts, src/lib/taskSwitcher.test.ts.

Interfaces: TaskWorkspace owns recentTaskIds: string[]. The storage key is exactly saber.taskSwitcher.recents. On initial mount, read and parse that key. On switcher selection, compute the next IDs, update React state immediately, then attempt to write their JSON. Storage errors must not interrupt existing task selection.

- [x] Step 1: Add testable helpers readRecentTaskIds(storage: Pick<Storage, "getItem">): string[] and writeRecentTaskIds(storage: Pick<Storage, "setItem">, recentIds: string[]): void. Use the dedicated key, delegate parsing to parseRecentTaskIds, and catch getItem/setItem errors.
- [x] Step 2: Test successful and failed storage operations. A fake storage records getItem/setItem; assert exact key and JSON order. A getItem throwing error returns []; a setItem throwing error does not throw to the caller.
- [x] Step 3: Run bun run test -- src/lib/taskSwitcher.test.ts; all 10 focused cases pass.
- [x] Step 4: Implement storage helpers. Serialize only the ordered string array; do not store timestamps, tasks, statuses, selected task, or run data.
- [x] Step 5: Load preference state safely in TaskWorkspace. Add recentTaskIds state and a mount effect calling readRecentTaskIds(window.localStorage) inside an outer try/catch so access to window.localStorage may also fail safely.
- [x] Step 6: Update only the switcher selection callback. Before calling existing select(id), calculate IDs using moveTaskToFront, update recentTaskIds, then try writeRecentTaskIds(window.localStorage, nextIds) inside try/catch. Preserve setAttentionFilter("all") and setView("terminal"). Do not update recency when opening/canceling the switcher or selecting elsewhere.
- [x] Step 7: Run bun run test -- src/lib/taskSwitcher.test.ts and bunx tsc --noEmit; tests pass and TypeScript exits 0.

## Task 3: Render grouped, searchable recent tasks — RTS-01, RTS-03, RTS-06

Files: src/components/TaskSwitcher.tsx, src/components/TaskWorkspace.tsx, src/lib/taskSwitcher.ts, src/lib/taskSwitcher.test.ts.

Interfaces: Add required prop recentIds: string[] to TaskSwitcher. Derive groups with groupTasksForSwitcher, filter each group with filterTasksForSwitcher, and flatten the filtered groups in recent-first order for active-index navigation.

- [x] Step 1: Pass recentTaskIds into TaskSwitcher. Preserve tasks, selectedId, onSelect, and onClose props.
- [x] Step 2: Add assertions for search ordering across groups. Recent task matches appear before non-recent matches; project basename and full-path filtering continue to work; group membership does not change based on query.
- [x] Step 3: Run bun run test -- src/lib/taskSwitcher.test.ts; all 10 focused cases pass.
- [x] Step 4: Render matching recent results below a semantic Recent heading and remaining matches below All tasks. Keep task rows as the same listbox options with stable task-switcher-option-{task.id} IDs, derived status labels, and current-task indicator. Keep existing no-task/no-match messages when both groups are empty.
- [x] Step 5: Use one flattened ordered result array for aria-activedescendant, arrow navigation, Enter selection, and pointer selection so visual and keyboard order match.
- [x] Step 6: Run bun run test -- src/lib/taskSwitcher.test.ts and bunx tsc --noEmit; all focused tests pass and TypeScript exits 0.

## Task 4: Verify the complete slice and record evidence — RTS-01–RTS-06

Files: docs/superpowers/specs/2026-09-23-recent-task-switcher-design.md, docs/roadmaps/2026-09-22-terminal-first-saber.md.

- [x] Step 1: Run bun run test -- src/lib/taskSwitcher.test.ts, then bun run test; focused suite is 10/10 and full suite is 13 files, 67 tests.
- [x] Step 2: Run bunx tsc --noEmit, bun run build, and git diff --check; all exit 0.
- [x] Step 3: Verify browser workspace: select two existing smoke tasks through the palette; confirm recent-first order and stable all-task order; search across both groups; close with Escape; reload and confirm preference persistence. No provider run or terminal command was used.
- [x] Step 4: Verify native Tauri with an existing live shell. Opened the grouped palette, selected the already-interrupted Verify context restoration task (confirmed its saved checkpoint and lock remained), then selected Codex adapter smoke test again and confirmed the same idle PowerShell prompt returned. No shell was started/unlocked and no command was sent.
- [x] Step 5: Confirm saber.taskSwitcher.recents is the only new preference write in the implementation; fake-storage tests assert the dedicated key and data. Code inspection confirms no task/run/checkpoint writes or provider-run API calls were added.
- [x] Step 6: Update requirement receipts and roadmap with exact Windows evidence. Linux/macOS remain marked untested.

## Self-review

- RTS-01, RTS-02, RTS-03, and RTS-05 are implemented/tested in Task 1 and rendered in Task 3; preference failure behavior is exercised in Task 2.
- RTS-04 is isolated and audited in Task 2 and Task 4; no schema or run changes are planned.
- RTS-06 retains existing interaction semantics in Task 3 and is verified in browser and native Tauri in Task 4.
- Helper signatures are consistent across tasks, IDs remain task-list-authoritative, and there are no placeholder steps.
