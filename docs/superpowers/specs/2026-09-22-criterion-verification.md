# Criterion-linked verification records

## Status and authorization

Approved direction: the user asked to continue spec-driven development on 2026-09-22. This slice implements the verification-record portion of VERIFY-01 and SDD-01 from the approved product direction.

## Problem and workflow

Runs can be ready for review, but Saber cannot show which acceptance criteria were checked or what evidence supports a completion claim. A developer gives each criterion a stable ID, runs work, then records a check and outcome against a specific task revision. Failed or missing current evidence keeps the task unverified.

## Scope and exclusions

Support criterion lines formatted `AC-01: observable result`, append-only pass/fail verification records, optional linkage to a run from the same task and revision, current-revision summaries, and a verified state only when every criterion's latest record passes. Existing tasks remain readable and editable; legacy criteria without IDs cannot be marked verified until rewritten with IDs. Do not auto-run commands, infer results from agent output, edit code, merge, publish, delete evidence, or introduce performance budgets in this slice.

## Acceptance criteria

- CV-01: Parse one non-empty criterion per line using unique IDs `AC-` plus at least two digits, a colon, and non-empty text. Report duplicate/malformed IDs and do not present an invalid list as verified. Legacy unnumbered criteria remain usable for runs but report that stable IDs are needed for verification.
- CV-02: Append immutable evidence containing task ID, criterion ID and text snapshot, task revision, pass/fail outcome, check description, evidence notes, timestamp, and optional run ID. Validate that the criterion exists in the current task revision and that a linked run belongs to the same task and revision. Preserve evidence through restart and spec edits.
- CV-03: Show latest evidence per criterion and retain prior attempts. Evidence from earlier revisions is stale. A task is Verified only if its current criteria are valid and every criterion's latest current-revision evidence passes. Failure, missing evidence, changed revision, or invalid criteria cannot be Verified.
- CV-04: UI records evidence explicitly; it never executes a check or marks a run verified automatically. Require a check description and notes before recording pass/fail. Allow optional linkage to a same-revision run. Show verified, incomplete, failed, stale, or needs-ID states and update immediately after saving.
- CV-05: Verification records are scoped to tasks, survive restart, and do not modify immutable run records. Retrying creates a new run and does not erase prior evidence.

## Data lifecycle and failure behavior

Store append-only rows in SQLite with a task foreign key and optional run foreign key. Task revision already advances when specification or criteria change; any earlier record becomes stale for the new revision without deletion. Keep old task JSON and run records readable. Reject malformed evidence with actionable 400 responses; reject cross-task/revision run links. A run's successful exit remains Ready for review until every criterion is manually verified with current evidence.

## Verification plan

Test parser validation, summary status transitions, duplicate and stale attempts, SQLite reopen, and run-link ownership. Run full Vitest, typecheck and production build. Restart dev on 8082 and verify current/failed/stale evidence in the task pane, including an existing legacy task remains unverified until criteria use stable IDs. Claude live test remains skipped as requested.
