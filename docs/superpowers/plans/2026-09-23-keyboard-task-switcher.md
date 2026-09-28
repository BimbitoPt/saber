# Keyboard task switcher implementation plan

> **For agentic workers:** Use `executing-plans` to implement this plan task by task. This run is inline; the user asked not to spawn agents. Track steps with checkboxes.

**Goal:** Let developers search and switch Saber tasks from the keyboard without losing task-owned terminal context.

**Architecture:** `src/lib/taskSwitcher.ts` filters the existing `TaskSummary[]`; `TaskSwitcher.tsx` provides an ephemeral accessible dialog; `TaskWorkspace.tsx` owns the shortcut, focus return, and calls the existing selection path. The feature adds no database fields or run/session behavior.

**Tech Stack:** Bun, React, TypeScript, Tailwind v4, Vitest, existing `taskAttentionState` helpers.

## Global Constraints

- Keep package management and app commands on Bun.
- Do not edit `src/routeTree.gen.*` or `src-tauri/gen/**`.
- Preserve task/run separation and immutable run scope.
- Do not type commands into the terminal or create agent runs.
- Allow Ctrl+Shift+P / Cmd+Shift+P from xterm; do not intercept it from ordinary editable task fields.
- Keep task selection and terminal ownership in the existing `TaskWorkspace` flow.

---

## File map

- Create `src/lib/taskSwitcher.ts` for case-insensitive search across task title, project basename, and full project path.
- Create `src/lib/taskSwitcher.test.ts` for filtering and empty-result cases.
- Create `src/components/TaskSwitcher.tsx` for the dialog, active result, keyboard controls, focus trap, and status presentation.
- Modify `src/components/TaskWorkspace.tsx` to own the global shortcut, invoke existing selection, and restore focus on cancel.
- Update `docs/superpowers/specs/2026-09-23-keyboard-task-switcher.md` with completion evidence.

### Task 1: Add the task search function — KTS-02

**Files:** Create `src/lib/taskSwitcher.ts`; create `src/lib/taskSwitcher.test.ts`.

**Interfaces:** `filterTasksForSwitcher(tasks: TaskSummary[], query: string): TaskSummary[]` preserves input ordering and returns the same list for an empty query.

- [x] Write a Vitest test for title, project basename, full path, case-insensitive matching, empty query, and no match.
- [x] Run `bun run test -- src/lib/taskSwitcher.test.ts`; confirm failure because the function does not exist.
- [x] Implement the function:

```ts
import type { TaskSummary } from "./tasks";

export function filterTasksForSwitcher(tasks: TaskSummary[], query: string): TaskSummary[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return tasks;
  return tasks.filter((task) => {
    const projectName = task.project.split(/[\\/]/).filter(Boolean).at(-1) ?? task.project;
    return [task.title, projectName, task.project].some((value) => value.toLowerCase().includes(normalized));
  });
}
```

- [x] Rerun `bun run test -- src/lib/taskSwitcher.test.ts`; expect all cases to pass.

### Task 2: Build the accessible switcher dialog — KTS-02, KTS-04, KTS-05

**Files:** Create `src/components/TaskSwitcher.tsx`.

**Interfaces:** Accept `tasks: TaskSummary[]`, `selectedId: string | null`, `onSelect(id: string): void`, and `onClose(restoreFocus: boolean): void`.

- [x] Create the dialog with search input, close button, listbox, status badges, and no-results state. Use `filterTasksForSwitcher`, `taskAttentionState`, and `taskAttentionLabels`.
- [x] Keep focus on the search input while arrow keys change the active option. Enter selects the active option. Escape and the close button call `onClose(true)`. Pointer selection calls `onSelect(id)` then `onClose(false)`.
- [x] Give the input `role="combobox"`, `aria-expanded`, `aria-controls`, and `aria-activedescendant`; give results `role="listbox"` and each result `role="option"` with `aria-selected`.
- [x] Trap Tab between the search input and close button. Keep result options out of the Tab order so Up/Down remains the single result-navigation path.
- [x] Mark the currently selected task with a visible “Current” label while keeping `aria-selected` tied to the active result.
- [x] Show a status message when there are no tasks or the query has no matches. Do not provide a selectable result in either case.
- [x] Use `bunx tsc --noEmit`; expect no component type errors.

### Task 3: Connect the workspace shortcut and selection lifecycle — KTS-01, KTS-03, KTS-04, KTS-05

**Files:** Modify `src/components/TaskWorkspace.tsx`.

**Interfaces:** Keep `select(id)` as the only task selection persistence and terminal-start entry point. Add `switcherOpen`, a return-focus reference, and close/select callbacks.

- [x] Install a capture-phase `keydown` listener. Match Ctrl+Shift+P or Cmd+Shift+P with no Alt modifier. Ignore the chord if the switcher is open. Ignore targets inside ordinary `input`, `textarea`, `select`, or contenteditable elements unless the target is inside `.xterm`.
- [x] When matched, call `preventDefault()` and `stopPropagation()`, save `document.activeElement`, and open the dialog.
- [x] Implement `closeSwitcher(restoreFocus)`. On cancel, close the dialog and focus the saved element after React unmounts it. On successful selection, call existing `select(id)`, set attention filter to `all`, set view to `terminal`, close without restoring the old terminal's focus, and let the selected `TerminalSurface` own focus.
- [x] Render `TaskSwitcher` only while `switcherOpen` is true. Do not modify API calls, task fields, run creation, or terminal identifiers.
- [x] Run `bunx tsc --noEmit` and `bun run test -- src/lib/taskSwitcher.test.ts`; both passed.

### Task 4: Verify the real interaction and close the spec — KTS-01–KTS-05

**Files:** Update `docs/superpowers/specs/2026-09-23-keyboard-task-switcher.md`.

- [x] Open the current Saber workspace in a browser and verify shortcut open, title filtering, status labels, Enter switching, Escape cancellation, and focus return. Project variants and filtering edge cases are covered by unit tests.
- [x] Verify Ctrl+Shift+P is ignored in the task form, then open the palette from a live native PowerShell terminal and confirm the chord did not appear in the shell.
- [x] Verify task selection changes the heading, inspect a real saved checkpoint without unlocking its interrupted shell, then switch back and confirm the original idle shell prompt returns unchanged.
- [x] Run the focused filter tests (4 passed) and full `bun run test` (13 files, 61 tests passed). Set a 15-second budget on the existing 2,105-event pagination stress case after it exceeded Vitest's 5-second default on Windows.
- [x] Run `bunx tsc --noEmit`, `bun run build`, and `git diff --check`; all passed.
- [x] Record exact outcomes against KTS-01 through KTS-05, browser/runtime limitations, and the next roadmap state in the spec and roadmap.
