# Criterion Verification Implementation Plan

Goal: attach explicit, revision-scoped verification evidence to each stable acceptance criterion.

Architecture: a pure parser/summary module defines criterion validity and verified-state rules; TaskStore appends immutable evidence rows; API validates task/revision/run ownership; a focused panel records and displays evidence.

Tech Stack: existing TypeScript, Bun, TanStack Start, SQLite via node:sqlite, Vitest.

Global constraints: Bun only; port 8082 strict; preserve task/run separation, provider-native histories and worktrees; do not auto-run commands or infer evidence; no generated-file edits or comments.

---

### Task 1: Stable criteria and verification summaries — complete

Files:
- Create `src/lib/verification.ts` and `src/lib/verification.test.ts`
- Modify `src/lib/tasks.ts`

Define `AcceptanceCriterion {id: string; text: string}`, `VerificationOutcome = "passed" | "failed"`, `VerificationRecord {id, taskId, criterionId, criterionText, revision, outcome, check, evidence, runId?, checkedAt}`, and `VerificationSummary {state: "needs_ids" | "invalid" | "incomplete" | "failed" | "verified"; total; passed; failed; stale}`.

Implement `parseCriteria(criteria: string): {criteria: AcceptanceCriterion[]; errors: string[]; needsIds: boolean}`. Ignore blank lines. Accept only `/^(AC-\d{2,}):\s*(\S.*)$/`; reject duplicate IDs and malformed non-empty lines. If all non-empty lines are unnumbered, set `needsIds`. Implement `summarizeVerification(criteria, revision, records)` by selecting latest record by checkedAt then ID per criterion, considering only current revision; an older latest record counts stale/incomplete and failed latest counts failed. Return `verified` only when every current criterion's latest record passes.

Tests cover valid/legacy/malformed/duplicate criteria, missing evidence, pass/fail, stale revisions, latest failure replacing previous pass, and fully verified state.

### Task 2: Persist and validate evidence — complete

Files:
- Modify `src/server/taskStore.ts`, `src/server/taskStore.test.ts`, `src/server.ts`

Create `verifications(id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), run_id TEXT REFERENCES runs(id), data TEXT NOT NULL)` plus task index. Add `listVerifications(taskId)` and `createVerification(record)` that inserts without update/delete. GET `/api/tasks/:id/verifications` returns `{records, summary}`. POST same accepts `{criterionId, outcome, check, evidence, runId?}`; load current task, parse criteria, require valid ID, non-empty check and evidence (max 10000 chars each), pass/fail outcome, and optional run belonging to task with `specRevision === task.revision`. Snapshot criterion text/revision/server timestamp. Return the created record and summary. Invalid body is 400; unknown task/run 404; cross-scope or stale run 409.

Store tests reopen the database, verify append-only history and snapshot revisions. API validation should be isolated in an exported helper if direct route tests would otherwise require starting the entire server.

### Task 3: Record evidence and show task state — complete

Files:
- Create `src/components/VerificationPanel.tsx`
- Modify `src/lib/api.ts`, `src/components/TaskDetail.tsx`, `src/components/TaskWorkspace.tsx`

Add `listVerifications(taskId)` and `recordVerification(taskId, input)`. Panel parses current criteria, groups records by criterion, displays latest current evidence and prior attempts, and labels stale older evidence. For each valid criterion, provide check description and evidence text fields, optional run selector restricted to this task's current revision, and explicit “Record pass” / “Record fail” buttons. No default outcome. Require both text fields. Update panel state from the response. Display overall summary and do not mark a run itself Verified.

Show acceptance-criteria guidance in create and edit forms: one `AC-01: ...` criterion per line. Existing tasks with legacy criteria show a clear “Add stable AC IDs to enable verification” state and no verification buttons.

### Task 4: Full verification and completion evidence — complete

Run `bun run test`, `bun x tsc --noEmit`, and `bun run build`. Restart `bun run dev` on port 8082. Verify UI flow for passing all criteria, failure replacing pass, spec revision invalidating evidence, and existing legacy tasks. Add evidence to `docs/superpowers/specs/2026-09-22-criterion-verification-verification.md`, update README and AGENTS current slice, and mark plan steps complete only after checks pass. Full suite passed single-worker (8 files, 40 tests); direct installed TypeScript CLI passed; production build passed. Browser checks covered persisted pass after reload, failure summary, stale evidence after criteria edits, and legacy task warning after a clean dev-server restart. Claude live-provider validation remains skipped because the user has no Claude Code account.
