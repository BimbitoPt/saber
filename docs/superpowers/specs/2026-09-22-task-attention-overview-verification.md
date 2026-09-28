# Task attention overview verification

## Outcome

Saber derives one attention state per task and displays counts and filters for the complete task set. Filtering does not change the stored or selected task; if the selection is hidden, its task stays selected and becomes visible again when All is restored.

## Evidence by requirement

- TAO-01: `src/lib/taskAttention.test.ts` verifies Draft, Running, Interrupted, Failed, Ready for review, Stopped, Verified, and the Verified/Failed precedence over a completed run.
- TAO-02: Browser at `http://localhost:8082/` showed All 7, Ready for review 2, and Draft 5; selecting Ready for review displayed the two matching tasks only.
- TAO-03: With “Verify context restoration” selected, applying Ready for review showed that it was hidden while retaining selection. Selecting All restored its task detail, including its saved checkpoint and follow-up draft.
- `bun x vitest run --maxWorkers=1 --reporter=dot`: 9 files, 42 tests passed.
- `node node_modules/typescript/bin/tsc --noEmit --pretty false`: passed with no diagnostics.
- `bun run build`: passed.
- Dev server restarted on strict port 8082 and the task pane was inspected in the browser.

## Limitations

Counts currently include Draft and Stopped as explicit states. Queued and waiting-for-input states remain deferred because Saber does not yet maintain those lifecycle signals. Notifications, queue limits, and responsiveness budgets require separate specs.
