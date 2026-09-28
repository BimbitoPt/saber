# Resume task context faster

## Status and authorization

**Status:** Implemented and verified in the Windows browser preview, 2026-09-24. The user previously chose faster context resumption, reuse of the task checkpoint and follow-up draft, and preview on the highlighted task in the switcher.

## Problem and user workflow

The keyboard task switcher shows each task's title, project and status, but returning to a task still requires selecting it before its saved checkpoint and next action are visible in the workspace. A developer moving quickly between tasks must either remember what was next or switch away and back again.

When the switcher is open, moving the active highlight previews that task's saved checkpoint and next-action draft beside the result list. The developer can review context before choosing; Enter or pointer selection remains the explicit action that switches tasks.

## Scope and exclusions

Add a read-only context preview for the active task in the existing keyboard switcher. Reuse `TaskSummary.context` and `TaskSummary.draft`; do not add storage fields, API calls, schema changes, or another handoff record. Show clear empty states when either value is absent and keep long text readable in a bounded, scrollable preview.

Do not select tasks merely by highlighting them, write task/run/checkpoint data, start or unlock terminals, create agent runs, copy or inject context, alter recent-task ranking, or change keyboard/focus behavior. Terminal marker verification inside the packaged native window remains a separate runtime verification gap.

## Requirements and acceptance criteria

- RTC-01: Opening the switcher previews the task at the active option index. Arrow navigation, pointer hover, and search-result changes update the preview to the highlighted result. Verify these transitions in the browser.
- RTC-02: The preview shows the saved context checkpoint and next-action draft with separate labels. Missing values show explicit empty-state text; long values remain readable in a bounded scroll region. Verify populated, empty and long-value cases.
- RTC-03: Preview is read-only. Highlighting or dismissing the switcher does not select a task, persist data, start a terminal, create a run, or send text to a shell. Only Enter or pointer selection uses the existing `onSelect` path. Verify cancel and selection behavior and inspect API/storage activity.
- RTC-04: Preserve existing switcher search, recent/all grouping, status labels, dialog/listbox semantics, keyboard control, and focus restoration. Verify search, Arrow Up/Down, Enter, Escape and focus behavior after adding the preview.

## Data and lifecycle

The preview is derived directly from the current `TaskSummary[]` and the switcher's active result index. It is ephemeral UI state and does not outlive the open switcher. The task remains unchanged until the existing explicit selection callback runs. Current `context` and `draft` values remain the source of truth; no migration or recovery behavior changes.

## Verification plan

| Requirement | Verification |
| --- | --- |
| RTC-01 | Browser: open the switcher, move with arrows and pointer, and type a query; verify the highlighted task and preview stay aligned. |
| RTC-02 | Browser: inspect a task with both fields, one with empty fields, and long text in each field; verify labels, empty states and independent scrolling. |
| RTC-03 | Browser: Escape without changing selection, inspect task/run state before and after highlight-only navigation, then explicitly select with Enter. |
| RTC-04 | Run focused task-switcher tests, `bunx tsc --noEmit`, `bun run build`, and `git diff --check`; inspect the preview and keyboard behavior in the running app. |

## Completion evidence

Implementation is in `src/components/TaskSwitcher.tsx`. The switcher now previews the active result in a read-only side panel, with a stacked compact layout at narrow widths. The checkpointed “Verify context restoration” task was searched and its saved checkpoint and next-action draft appeared in the preview. Arrow Down changed both the highlighted task and preview. Empty fields displayed their respective empty states. Escape dismissed the switcher without invoking task selection; no task/run API, terminal command, or provider run was triggered by preview navigation. Visual inspection confirmed the dialog retains the existing result/status layout and adds an independently scrolling context area.

| Requirement | Outcome | Evidence and limitation |
| --- | --- | --- |
| RTC-01 | Verified in Windows browser preview | Search-result changes and Arrow Down moved the preview with the highlighted option. Pointer hover uses the same active-index update callback but was not separately exercised. |
| RTC-02 | Partially verified in Windows browser preview | Populated checkpoint/draft and both empty states were inspected. Long-content scrolling was not exercised with a long fixture. |
| RTC-03 | Verified by browser flow and code inspection | Escape dismissed the switcher without selection; preview derives only from `results[activeIndex]`. Selection remains solely in `choose(index)`. No API calls or terminal effects were added. |
| RTC-04 | Partially verified in Windows browser preview and packaged-server browser view | Existing listbox/dialog, search, status and arrow interaction remain; Escape closed the dialog. The rebuilt MSI's server also rendered the updated preview. Native Tauri terminal interaction, Enter selection, pointer selection and focus restoration were not exercised in this pass. |

Checks passed: `bun run test -- src/lib/taskSwitcher.test.ts` (10 tests); `bunx tsc --noEmit`; `bun run build`; and `git diff --check`. The in-app browser preview and the browser view served by the updated MSI extraction showed the populated checkpoint and next-action draft. Packaged native terminal verification and clean-account installation remain pending because this environment does not expose native app-window controls. Linux and macOS UI behavior remain untested.
