# Kanban Task Board Implementation Plan

> **For agentic workers:** Execute these tasks inline in order. Steps use checkbox syntax for tracking.

**Goal:** Add a compact Kanban view that helps developers scan agent task flow without creating a second source of task state.

**Architecture:** Reuse `taskAttentionState` as the one state classifier. Add a pure board grouping helper and focused tests, render accessible columns/cards in a small `TaskBoard` component, and add Board/List navigation in `TaskWorkspace`. Selecting a board card opens the current TaskDetail view; the existing task ID selection and local-storage persistence remain authoritative.

**Tech Stack:** Bun, TypeScript, React, TanStack Start, Tailwind v4, Vitest.

## Global Constraints

- Use Bun for package scripts and tests.
- Keep dev on port 8082 with `--strictPort`.
- Do not edit generated route trees or Tauri generated files.
- Do not add comments or emojis.
- Preserve task/run separation, immutable run scope, and existing list filters.
- Do not add board-specific persisted status or drag-and-drop.

---

### Task 1: Define and test derived board lanes — KAN-01

**Files:**
- Modify `src/lib/taskAttention.ts`
- Modify `src/lib/taskAttention.test.ts`

**Interfaces:**
- Export `taskBoardLanes`, each lane with `id`, `label`, and included `TaskAttentionState[]`.
- Export `groupTasksIntoBoardLanes(tasks: TaskSummary[])`, returning a record keyed by lane ID, with tasks in original order.

- [x] Define five ordered lanes: `todo` = `draft`; `running` = `running`; `review` = `ready_for_review`; `done` = `verified`; `attention` = `failed`, `interrupted`, `stopped`.
- [x] Add tests with one fixture per attention state and assert every task is returned exactly once, in the expected lane, and lane counts sum to input count.
- [x] Run `bun x vitest run src/lib/taskAttention.test.ts --reporter=verbose` and confirm pass.

### Task 2: Render accessible Kanban board — KAN-01, KAN-04

**Files:**
- Create `src/components/TaskBoard.tsx`
- Modify `src/components/TaskWorkspace.tsx`

**Interfaces:**
- `TaskBoard` receives `{tasks: TaskSummary[]; selectedId: string | null; onSelect(id: string): void; onNewTask(): void}`.
- Use the lane grouping helper from Task 1; do not derive a separate status in UI code.

- [x] Render an intro row with “Task board”, concise explanation that columns follow run and verification state, and a New task action.
- [x] Render five labeled lane sections with counts and horizontally scrollable layout. Use existing line/panel/accent tokens and clear text labels; color may reinforce lane state but never replace the label.
- [x] Render each card as a keyboard-focusable button with task title, project basename, spec revision, and latest run/verification status. Set `aria-pressed` for the selected task.
- [x] Render an explicit empty-lane message, keep attention tasks visually distinct, and use focus-visible styling.

### Task 3: Add Board/List navigation and handoff — KAN-02, KAN-03

**Files:**
- Modify `src/components/TaskWorkspace.tsx`

- [x] Add accessible Board and List view buttons beside task workspace controls.
- [x] Keep List as the initial view. Board card selection calls the existing `select(id)` then displays List/TaskDetail. Returning to Board retains the selected ID and marks its card selected.
- [x] Board New task calls `select(null)` and switches to List so the existing form is reused.
- [x] Keep the existing list filters and selection-hidden recovery behavior unchanged. Continue to feed board from the existing periodically refreshed `tasks` array.

### Task 4: Verify and record completion — KAN-01 through KAN-04

**Files:**
- Create `docs/superpowers/specs/2026-09-22-kanban-task-board-verification.md`
- Modify `README.md`
- Modify `AGENTS.md`

- [x] Run `bun x vitest run --maxWorkers=1 --reporter=dot`; expect all test files and tests to pass. Result: 9 files, 43 tests passed.
- [x] Run `node node_modules/typescript/bin/tsc --noEmit --pretty false`; expect exit code 0.
- [x] Run `bun run build`; expect exit code 0.
- [x] Restart dev on `http://localhost:8082/`; verify Board/List, lane counts, review/done placement, card selection/restoration, accessible card semantics, and New task. Failed/interrupted/stopped classifier mapping is unit-tested; the seeded browser data had no such tasks to show in Needs attention.
- [x] Record evidence per KAN ID, update README's feature summary and AGENTS current slice. Evidence: `docs/superpowers/specs/2026-09-22-kanban-task-board-verification.md`.
