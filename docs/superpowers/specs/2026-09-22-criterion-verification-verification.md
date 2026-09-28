# Criterion-linked verification evidence

## Outcome

Implemented criterion parsing, revision-scoped append-only pass/fail records, task/run ownership validation, task-pane evidence entry and history, and current-revision summary states. A criterion becomes verified only after all current criteria have passing latest records. Evidence stays attached to its task and old revision records remain available as stale history.

## Evidence by requirement

- CV-01: `src/lib/verification.test.ts` covers valid and legacy criteria, malformed IDs, duplicates, and summary behavior. The UI displays the stable-ID requirement for legacy criteria.
- CV-02: `src/server/taskStore.test.ts` covers append-only records, SQLite reopen, and evidence retained after a revision edit. The POST handler validates and persists records, including optional run scope.
- CV-03: parser and summary tests cover missing evidence, failure replacing a prior pass, and stale revisions. The browser task pane showed a saved AC-01 pass after reload, then showed 1 failed criterion after recording an AC-02 failure. Editing criteria advanced the task to Spec 2 and both Spec 1 records appeared stale.
- CV-04: the panel requires a check description and evidence notes, offers explicit pass/fail actions, and does not execute checks. The local browser flow confirmed pass and fail saves update the visible summary and evidence.
- CV-05: records use a separate SQLite table and are never mutated by run retries. Store reopen test preserved both attempts.

## Checks run

- `bun x vitest run --maxWorkers=1 --reporter=dot`: 8 files and 40 tests passed. Single-worker execution avoids a parallel-load timeout in the existing 2,000-event pagination test.
- `bun x vitest run src/server/taskStore.test.ts -t "pages more than 2000 events without cursor loss" --reporter=verbose`: passed individually.
- `bun run build`: passed; Vite emitted existing module-level `use client` bundling warnings from dependencies.
- Browser at `http://localhost:8082/`: verified persisted AC-01 evidence after reload.
- `node node_modules/typescript/bin/tsc --noEmit --pretty false`: passed with no diagnostics. The `bun x tsc` wrapper did not terminate in this environment.
- After a clean dev-server restart on port 8082, an existing unnumbered task displayed “Needs criterion IDs” and no verification controls.
- Claude Code live-provider testing remains skipped at the user's request because no Claude Code account is available.

## Follow-up

Run the full test suite single-worker in this environment. Use the installed TypeScript CLI directly if the `bun x` wrapper hangs. Claude live-provider testing remains an external prerequisite for provider-specific verification.
