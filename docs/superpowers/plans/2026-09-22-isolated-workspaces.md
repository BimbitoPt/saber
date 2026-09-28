# Isolated Workspaces Implementation Plan

Goal: independent task checkouts with review, conservative merge, and lossless cleanup.

Architecture: TaskWorkspaceRecord lives in task JSON; GitWorkspaceService owns native Git mutations; AgentRuns resolves and snapshots execution directories. WorkspacePanel owns user actions and review display.

Tech stack: existing Bun/TanStack Start/TypeScript, node:sqlite, installed Git.

Constraints: no generated files, no new code comments, no automatic commits or force removal, port 8082 strict, preserve existing changes.

- [x] Define shared workspace/review contracts and metadata persistence (IW-01/03).
- [x] Implement managed Git create/validate/review/merge/remove with bounded commands and pre-mutation run checks; verify temporary real repositories (IW-01/04/05/06).
- [x] Resolve run workdir through managed workspace; snapshot paths and filter continuation by workdir; test parallel isolated runs and missing workspaces (IW-02).
- [x] Add task workspace panel and API routes for create/review/merge/remove. Disable mutating actions during runs; merge sends reviewed head (IW-03/04/05/06).
- [x] Run tests, typecheck, build and browser verification. Record criterion evidence and skipped Claude test.

Evidence: docs/superpowers/specs/2026-09-22-isolated-workspaces-verification.md

Contracts: TaskWorkspaceRecord {path, source, baseCommit, targetBranch, branch, state: provisioning|ready|removed}; WorkspaceReview {head, status, diff, branch}; endpoints GET/POST/DELETE /api/tasks/:id/workspace and POST /api/tasks/:id/workspace/merge with {head}. GET returns WorkspaceReview; mutations return TaskRecord. UI invokes onSaved for task metadata updates.
