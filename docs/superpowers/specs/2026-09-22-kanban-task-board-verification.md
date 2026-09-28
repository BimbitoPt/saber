# Kanban task board verification

## Outcome

Added a Board/List switch and five derived task lanes without adding a second persisted workflow state. Board selections open the existing task detail view; switching back to Board highlights the same task. New task returns to the existing create form.

## Evidence by requirement

- KAN-01: `src/lib/taskAttention.test.ts` covers all attention states, checks each fixture's exact lane, and verifies every task is included once. Browser lane counts matched the seeded tasks: To do 4, Running 0, Ready for review 2, Done 1, Needs attention 0.
- KAN-02: Browser checks switched List -> Board, opened the Codex adapter smoke card into its task details, and switched back to Board with the same card still selected. The board's New task button opened the existing task creation form. Selection was restored to the Codex smoke card afterward.
- KAN-03: The verification smoke task moved into Done after current-revision criterion records made its summary Verified. A temporary failed AC-02 attempt moved it to Needs attention on refresh; a passing retry returned it to Done, retaining the earlier attempt. Existing ready-for-review tasks remained in their own lane.
- KAN-04: Normal app viewport screenshot showed compact lanes, high-contrast borders, text labels/counts, selected-card styling, visible focus outline, and horizontal scrolling for the full set of columns. Keyboard navigation was exercised with Tab from the Board switch; focus moved to the New task button and a blue focus ring was visible in the screenshot. Cards are native keyboard-focusable buttons with `aria-pressed`; lane names and counts are semantic text.
- `bun x vitest run --maxWorkers=1 --reporter=dot`: 9 files and 43 tests passed.
- `node node_modules/typescript/bin/tsc --noEmit --pretty false`: passed.
- `bun run build`: passed.
- Dev server restarted on strict port 8082 and the finished board was inspected in the browser.
- A read-only review found a filter-selection edge case and a weak lane assertion. Board-card selection now resets the old List filter before opening details, and the lane test asserts expected task IDs. Both findings were re-reviewed and resolved.

## Limitations

Queueing and waiting-for-input remain unrepresented. State changes are only as current as the existing two-second task-list refresh. Drag-and-drop is intentionally excluded because lane positions reflect actual run and verification state.
