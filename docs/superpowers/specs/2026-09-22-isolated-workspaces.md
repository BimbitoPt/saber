# Isolated task workspaces

Status: Approved direction, user requested implementation and explicitly skipped authenticated Claude testing.

## Scope and design

One Git worktree and branch per task, explicitly created from committed HEAD. Keep original project identity separate from execution path. Existing tasks remain in their original checkout until isolated. Git worktrees reuse repository objects and fit native CLI providers; full clones duplicate storage, while shared-checkout scheduling cannot provide parallel edits.

## Acceptance criteria

- IW-01: Create an isolated workspace for an idle task in a Git checkout with a committed HEAD and named branch. Record source checkout, base commit, target branch, task branch and managed path. Source uncommitted files are never copied or modified. Non-Git and unborn repositories fail clearly. Repeated create returns the same workspace.
- IW-02: Runs capture their actual work directory immutably. Independent worktrees can run concurrently; the same worktree and interrupted ownership remain locked. Continuation requires the same provider and actual work directory. No fallback to source when a managed worktree is missing or removed.
- IW-03: Task selection preserves context, drafts and provider history. Display source, workspace and branch. Existing records require no database migration.
- IW-04: Explicit review shows tracked changes against the recorded base, working-tree status including untracked files, and current commit identity. Diff output is bounded and fails clearly if too large. Never execute external diff/textconv helpers. Review is unavailable during runs.
- IW-05: Explicit merge accepts a reviewed commit only, rejects stale review, dirty task/source checkout, changed target branch, active/interrupted/closing source or task runs, and non-fast-forward history. Merge only already committed task changes, never auto-commit user files. Show outcome and preserve run history.
- IW-06: Cleanup only removes a registered managed worktree at the exact stored path when idle and free of tracked, untracked and ignored files. Never force remove or delete the branch. Persist removed state; preserve task/history and prevent further runs. Failed operations retain recoverable metadata; retry can recognize an already removed registered workspace.

## Lifecycle and limitations

Use synchronous bounded native Git operations to serialize app mutations against launches in the single server process. Persist provisioning metadata before creating the worktree, allowing an interrupted creation to be retried safely. Validate actual Git root, branch, and common repository before using an existing managed directory. Filesystem edits by external programs are outside Saber's lock; Git still performs its own conflict checks. No dependency installation, automatic commits, conflict resolver, branch deletion, or per-task preview server in this slice.

## Verification

Use temporary real repositories to test creation/reuse, source changes preservation, non-Git rejection, concurrency, continuation boundaries, stale/dirty/non-fast-forward merge refusal, clean merge, ignored-file cleanup refusal, safe removal and retained branches. Run Vitest, TypeScript and production build. Restart dev on strict port 8082 and inspect diagnostics and workspace controls in the browser. Authenticated Claude tests are skipped by user request.
