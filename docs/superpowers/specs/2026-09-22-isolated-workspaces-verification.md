# Isolated workspace verification

Date: 2026-09-22.

## Acceptance evidence

| Requirement | Evidence |
| --- | --- |
| IW-01 | Real Git tests create/reuse managed worktrees from committed HEAD and prove dirty source files are not copied or changed. Non-Git tasks fail. Browser smoke created branch `codex/saber-4efa23a9-1383-468c-88f9-1f5897f9b1aa` under `%USERPROFILE%\.saber\worktrees`. |
| IW-02 | Real Git/run tests verify separate execution paths can run in parallel, a single worktree remains locked, native provider continuation cannot cross from the prior source checkout, and missing worktrees do not fall back to source. |
| IW-03 | Workspace metadata is optional on task records, preserving old SQLite data. Browser shows source, managed worktree, branch and merge target. Removal retains task/run records. |
| IW-04 | Browser review displayed working-tree state including `?? review-smoke.txt`, branch, and current HEAD. Real Git test checks tracked diff and untracked status. Git command disables external diff/textconv and caps output. |
| IW-05 | Real Git tests cover dirty task changes, stale review, dirty source, non-fast-forward history, ignored source-file overwrite, and clean fast-forward. Merge only uses a reviewed HEAD and creates no commit. |
| IW-06 | Tests show ignored files block cleanup; clean cleanup removes the worktree but preserves branch and task history. Browser verified the removed state and retained branch notice. |

## Commands and results

- `bun run test`: 34 tests across 7 files passed.
- `bun x tsc --noEmit`: passed.
- `bun run build`: passed. Existing bundler warnings about module-level `use client` directives were emitted.
- Restarted `bun run dev` on port 8082.
- Browser verified existing Codex output diagnostics presentation; the full log is inside collapsed “Provider diagnostics” while `SABER_CODEX_FOLLOWUP_OK` stays visible.
- Browser created, reviewed and safely removed a disposable task workspace. Its branch and task history remain. Source checkout file remained unchanged.

## Review and limits

Independent review found and fixed a Git merge edge case: `--no-overwrite-ignore` plus a regression test prevents fast-forward from replacing ignored local source files. No blocking findings remained. Git runs are synchronous and bounded within the local Saber server; external programs can still modify files, which is why Git cleanliness and ancestry checks run immediately before mutations. Workspaces start from committed HEAD, and dependencies are not installed. Authenticated Claude live testing was skipped by explicit user request because they do not have a Claude Code account.
