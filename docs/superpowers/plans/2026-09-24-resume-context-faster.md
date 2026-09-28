# Resume task context faster Implementation Plan

> **For agentic workers:** Execute inline in the existing shared checkout. Steps use checkbox syntax for tracking.

**Goal:** Let a developer preview the saved checkpoint and next-action draft for the highlighted task before switching to it.

**Architecture:** Keep the existing task switcher result ordering and active index as the source of the preview task. Render that task's `context` and `draft` in a read-only, bounded side panel. Leave selection, recency persistence and terminal lifecycle on their existing explicit paths.

**Tech Stack:** Bun, React, TypeScript, Tailwind v4, TanStack Start, Vitest, existing task-switcher UI.

## Global Constraints

- Keep the preview derived from the current `TaskSummary[]`; do not add fields, endpoints, or persisted preview state.
- Preserve task/run separation and immutable run scope.
- Do not start, unlock, write to, or inject content into a terminal from preview behavior.
- Do not edit `src/routeTree.gen.*` or `src-tauri/gen/**`.
- Use Bun for JavaScript package commands.

---

## File map

- Modify `src/components/TaskSwitcher.tsx`: render the active result's checkpoint and next-action draft in a side preview; preserve the current modal list, keyboard controls and selection flow.
- Update `docs/superpowers/specs/2026-09-24-resume-context-faster.md`: record actual requirement evidence and remaining platform limitations.
- Update `docs/roadmaps/2026-09-22-terminal-first-saber.md`: record the completed slice and choose the next roadmap action based on verification receipts.

## Task 1: Add highlighted-task context preview — RTC-01, RTC-02, RTC-03, RTC-04

**Files:** `src/components/TaskSwitcher.tsx`

**Interface:** `results[activeIndex]` remains the highlighted `TaskSummary`; preview reads `context` and `draft` directly. Existing `choose(index)`, `onSelect`, and `onClose` contracts do not change.

- [x] **Step 1: Add a responsive two-column switcher layout.** The desktop view uses a split list/preview layout. At narrow widths the preview stacks under the list, with bounded list and preview regions.
- [x] **Step 2: Render the active result's checkpoint and next-action draft.** The panel uses separate headings, preserves whitespace, renders text safely, and shows “No checkpoint saved.” / “No next action saved.” for empty values.
- [x] **Step 3: Verify read-only state transitions.** Search-result changes and Arrow Down aligned the active option and preview. Code inspection confirmed only `choose(index)` calls selection; preview has no effects or API/storage/terminal calls.
- [x] **Step 4: Run the focused existing unit suite.** `bun run test -- src/lib/taskSwitcher.test.ts` passed all 10 tests.
- [x] **Step 5: Type-check and build.** `bunx tsc --noEmit` and `bun run build` passed.
- [ ] **Step 6: Complete the switcher browser acceptance pass.** Populated and empty context, search, Arrow Down, Escape, dialog/listbox, and visual layout were inspected. Long-text scrolling, pointer hover/selection, Enter selection, focus restoration, and native Tauri remain unverified.

## Task 2: Record evidence and roadmap state — RTC-01 through RTC-04

**Files:** `docs/superpowers/specs/2026-09-24-resume-context-faster.md`, `docs/roadmaps/2026-09-22-terminal-first-saber.md`

- [x] **Step 1: Map each requirement to actual evidence.** Evidence and unverified behavior are recorded in the feature spec.
- [x] **Step 2: Update the roadmap active slice.** The roadmap records M6 evidence and keeps packaged PTY and clean-account installer checks outstanding.
- [x] **Step 3: Run `git diff --check`.** The tracked component and roadmap diff had no whitespace errors; new Markdown files were checked for trailing whitespace separately.

## Plan self-review

- RTC-01 and RTC-02 are implemented in the switcher component and verified in the browser.
- RTC-03 is enforced by using the current render-only preview and existing explicit selection handler; browser verification distinguishes highlight from selection.
- RTC-04 is covered by existing switcher helpers plus browser checks and the type/build checks.
- No task/run schema, API, workspace or Rust changes are in scope.
