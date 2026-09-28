# Persistent tasks and context restoration

Status: Approved for implementation through the user's instruction to build the first slice.

## Scope

Implement the first slice of the approved Saber product direction: persistent tasks, immutable run scope, OpenCode execution, checkpoints, drafts, and restart recovery. Keep the current stack and use SQLite through the runtime's built-in node:sqlite interface (verified on the installed Node 24 runtime). No new provider adapters or concurrent editing in this slice.

## Acceptance criteria

- PT-01: Create a task with project, title, specification, and acceptance criteria before launching an agent. Task records survive server restart.
- PT-02: Each launch or follow-up creates a separate run containing the current spec revision, provider, prompt, model, timestamps, and event history. A successful exit means ready for review, never verified.
- PT-03: Save task context (decisions, blockers, next action) and an unsent follow-up draft. Switching tasks restores them; refreshing restores the selected task. Unsaved edits remain visible if a save fails.
- PT-04: Reopening storage marks previously running attempts interrupted. Never infer that an orphan process stopped or succeeded. Interrupted tasks require explicit confirmation that the old process stopped before another run can launch.
- PT-05: Preserve output in SQLite with monotonic per-run sequence numbers and bounded pages. Parse split/multiple JSON lines without losing events. Follow-up execution restarts observation.
- PT-06: Prevent overlapping writes in the same checkout; failed launches, missing native session IDs, invalid input, and save failures show actionable errors. A failed follow-up retains its draft.
- PT-07: Launch prompts include the exact spec revision, criteria, and saved context. Later edits do not mutate prior run snapshots. Continuing a native session uses the latest captured ID from a prior run of the same task.

## Boundaries and verification

Checkpoint text is user-authored, not an inferred agent summary. The existing shared browser/dev-server panes remain shared and are labelled accordingly; workspace-scoped previews belong to the later isolation slice. Local storage holds UI selection and a recovery copy of unsaved edits; SQLite is authoritative for saved task data. Full spec approval/version history, acceptance evidence, multi-provider support, worktrees, and performance budgets remain later slices.

Use isolated temporary SQLite databases for persistence/recovery/event tests and fake child processes for lifecycle tests. Run the existing Vitest suite and TypeScript check. Restart the dev server on port 8082 and verify task creation, A/B switching, edits, refresh, and persisted history in a browser. Do not launch coding agents against the user's repository merely to test the UI.
