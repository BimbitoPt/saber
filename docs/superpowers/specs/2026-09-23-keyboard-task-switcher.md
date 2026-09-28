# Keyboard task switcher

## Status and authorization

Approved next slice, 2026-09-23. The user instructed continuation after the searchable-switcher design was presented. This slice implements that recommended design: Ctrl+Shift+P opens a searchable task palette.

## Problem and user workflow

Saber's task workspace currently requires pointer selection in the task list or board. When a developer is typing in a task-owned terminal, reaching for the pointer interrupts the command-line workflow and adds friction to context switching.

The developer presses Ctrl+Shift+P, filters tasks by title or project, checks each task's existing derived status, chooses a task with arrow keys, and presses Enter. Saber returns to that task's terminal and saved context. Escape closes the palette without changing the active task.

## Scope and exclusions

Add an ephemeral, accessible task-switching dialog to the terminal-first workspace. Use the current task list and existing derived task status. Keep the current task list and board unchanged. Route successful selection through the existing task-selection behavior so terminal startup, persistence, and session ownership retain their existing rules.

Do not add persisted switcher history, new task/run states, command execution, new provider runs, drag-and-drop, global operating-system shortcuts, or changes to task/run/terminal ownership. Ignore the shortcut while focus is in ordinary form fields or editable task content; allow it from xterm's terminal input surface.

## Requirements and acceptance criteria

- KTS-01: Pressing Ctrl+Shift+P, or Cmd+Shift+P on macOS, opens the palette from the workspace. It does not open twice when already open. The shortcut is ignored in input, textarea, select, or contenteditable fields outside xterm. From xterm, the chord is intercepted by Saber and is not sent to the shell. Verify these paths in the desktop UI and with a focused shortcut test where available.
- KTS-02: The dialog lists current tasks with title, project basename, and status derived through `taskAttentionState`. Typing filters case-insensitively by title, project basename, or full project path. Empty task lists and no-match searches show clear states; Enter with no result does nothing. Verify each search field and derived status in a unit test plus browser check.
- KTS-03: Arrow Up/Down moves the active option, Enter selects it, and pointer selection selects it. A successful choice uses existing task selection, clears any attention filter, and returns the workspace to Terminal view. Verify the selected task ID, heading, checkpoint, and terminal surface after switching.
- KTS-04: Escape, the close button, and backdrop dismissal close without changing selection or task data. Cancel restores focus to the element that opened the dialog. Choosing a task leaves focus restoration to the selected terminal's existing focus lifecycle. Verify cancel and selection separately.
- KTS-05: The switcher uses dialog and listbox semantics, an accessible search name, an announced active option, visible keyboard focus, and a keyboard trap limited to its search and close controls. It creates no agent run and writes no task, run, or checkpoint data. Verify semantics and inspect storage/API activity during a switch.

## Data and lifecycle

The query, active result index, and open/closed state exist only while the component is mounted. The task catalog and status are derived from the existing `TaskSummary[]`. A successful selection calls the workspace's existing task-selection flow; `saber.selectedTask` remains the only selection persistence mechanism. The switcher does not mutate a task or run. Selecting a task with no terminal continues to use the existing terminal-start request behavior; no command is injected into its shell. Cancel leaves the currently selected task unchanged.

## Verification plan

- KTS-01 and KTS-04: browser checks for shortcut source, in-dialog behavior, ignored form-field chords, xterm chord interception, cancel, and focus restoration.
- KTS-02: Vitest coverage for case-insensitive matching of title, project basename, and full path, plus empty query and empty results; browser check for status labels and no-match state.
- KTS-03: browser check for arrow navigation, Enter, pointer choice, return to Terminal view, correct checkpoint and task identity.
- KTS-05: inspect dialog/listbox accessibility attributes and verify switching causes no task/run mutation or agent-run request.
- Run focused tests, full Vitest, application TypeScript check, production build, and inspect the updated workspace pane in the browser.

## Completion evidence

Implementation complete on 2026-09-23.

| Requirement | Outcome | Evidence and limitation |
| --- | --- | --- |
| KTS-01 | Verified in browser and native Tauri | Ctrl+Shift+P opened the palette from Saber preview and from the Tauri window while a live PowerShell PTY was focused. The focused task-title field ignored it. The capture-phase handler explicitly allows `.xterm` targets and prevents the chord from reaching terminal listeners. |
| KTS-02 | Verified | Four Vitest cases cover case-insensitive title, basename and full-path search, empty-query ordering, and no matches. The browser palette exposed derived status labels and filtered a real task title. |
| KTS-03 | Verified in browser and native Tauri | Enter selection switched the selected task and heading. In Tauri, switching from the live Codex-adapter smoke task to the checkpointed context-restoration task displayed its saved decision and next action without unlocking its interrupted shell; switching back restored the same existing PowerShell prompt in the same task workspace. No command was sent. |
| KTS-04 | Escape path verified | Escape dismissed the dialog and restored focus to the opener. Close-button and backdrop dismissal use the same cancel callback but were not separately exercised. |
| KTS-05 | Semantics verified; storage/API audit by inspection | Accessibility tree exposed dialog, named combobox, listbox and selected option. Selection flows through existing `select()` and no task/run/checkpoint API is called by the switcher. The expected selected-task preference is persisted by that existing path. |

Checks: focused task-switcher tests passed (4); `bunx tsc --noEmit` passed; `bun run build` passed; `git diff --check` passed. Full `bun run test` passed (13 files, 61 tests). The existing event-pagination stress case now has a 15-second per-test budget after exceeding Vitest's 5-second default once on this Windows host. Windows browser verification covered opening, filtering, Enter selection, selection restoration, form-field suppression, Escape dismissal, and focus return. Native Tauri verification opened the switcher from the live terminal using Ctrl+Shift+P, selected another task, inspected its saved checkpoint while leaving its interrupted shell locked, and returned to the original task where the same idle PowerShell prompt was visible. Linux and macOS remain untested.
