# Resume task context faster

## Status and authorization

**Status:** Implemented and verified in the Windows browser preview, 2026-09-24. The user previously chose faster context resumption, reuse of the task checkpoint and follow-up draft, and preview on the highlighted task in the switcher. The remaining interaction gaps (pointer hover, long-text scrolling, Enter/pointer selection, focus restoration) were verified on 2026-10-06 in headless Chromium against the production server build plus a committed jsdom regression test; native Tauri-window interaction remains unverified.

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
| RTC-01 | Verified in Windows browser preview and headless Chromium | Search-result changes, Arrow Down, and pointer hover moved the preview with the highlighted option. jsdom covers hover via `mouseover` and search filtering. |
| RTC-02 | Verified in Windows browser preview and headless Chromium | Populated checkpoint/draft, both empty states, and 200-line values were inspected. Both preview paragraphs carry bounded `max-h-32 overflow-auto` regions; measured scrollHeight 3924px against a 128px client area with the final line present. |
| RTC-03 | Verified by browser flow and code inspection | Escape dismissed the switcher without selection; preview derives only from `results[activeIndex]`. Selection remains solely in `choose(index)`. No API calls or terminal effects were added. |
| RTC-04 | Verified in headless Chromium and jsdom | Search, Arrow Up/Down, Enter selection, pointer selection, Escape dismissal, search autofocus, and focus restoration to the invoking control after Escape all pass. Native Tauri terminal interaction was not exercised in this pass. |

Checks passed: `bun run test -- src/lib/taskSwitcher.test.ts` (10 tests); `bunx tsc --noEmit`; `bun run build`; and `git diff --check`. The in-app browser preview and the browser view served by the updated MSI extraction showed the populated checkpoint and next-action draft. Packaged native terminal verification and clean-account installation remain pending because this environment does not expose native app-window controls. Linux and macOS UI behavior remain untested.

## Follow-up verification — 2026-10-06 (Phase A1)

No source changes were required; all gaps passed against the existing implementation.

- New regression test `src/components/TaskSwitcher.test.tsx` (7 tests): search autofocus, arrow-driven preview, pointer-hover preview, bounded long-text regions with full 200-line content, search-result preview tracking, Enter and pointer selection through `onSelect`, and Escape dismissal without selection.
- Headless Chromium (Playwright, system Node v24.15.0) against the production server build served from the staged checksum-verified Windows Node sidecar tree with an isolated `SABER_DATA_DIR`, 11/11 checks: Ctrl+Shift+P opens the switcher, search is focused, initial/arrows/hover/search preview tracking hold, 200-line checkpoint and draft render in bounded scroll regions (scrollHeight 3924px vs 128px client, final line present), Enter selects the hovered task, Escape dismisses without reselecting, and focus returns to the invoking Terminal button.
- Related suites rerun: `src/components/TaskSwitcher.test.tsx` + `src/components/TaskWorkspace.test.tsx` + `src/lib/taskSwitcher.test.ts` (18 tests) pass; `bunx tsc --noEmit` and `git diff --check` pass.
- Incidental findings, not M6 defects: `vite dev` currently cannot serve API routes (`NitroViteError: Vite environment "nitro" is unavailable`), so browser verification used the production server build; Playwright cannot launch its browser when driven from Bun (DevTools pipe handshake stalls), so the driver ran under system Node. Task creation (`POST /api/tasks`) accepts only project/title/spec/criteria; context and draft require `PATCH /api/tasks/{id}`.
