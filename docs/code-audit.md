# Code Audit and Pull Request Review

## Purpose

Every change to Saber should be reviewed for correctness, security, regression risk, and evidence of verification. CI is a safety net, not a substitute for reviewing the diff.

## Required automated gates

The `PR Audit` workflow runs on pull requests targeting `master` and on pushes to `master`:

1. Install the locked Bun dependencies with `bun install --frozen-lockfile`.
2. Run the Vitest suite with `bun run test`.
3. Run TypeScript checks with `bunx tsc --noEmit`.
4. Build the production app with `bun run build`.
5. Run CodeQL analysis for JavaScript/TypeScript and Rust.

A green build means these checks passed. It does not prove every acceptance criterion, desktop interaction, or runtime behavior was tested.

## Review procedure

1. **Understand intent.** Compare the PR description with the issue/spec and acceptance criteria. Flag scope drift or missing requirements.
2. **Read the complete diff.** Inspect callers, tests, configuration, generated artifacts, and failure paths, not only the main implementation.
3. **Trace invariants.** Identify what must remain true before and after the change, and check every entry point that can mutate the same state.
4. **Review security boundaries.** Check untrusted input, path traversal, shell/process invocation, authorization, secrets, dependency changes, and sensitive logging.
5. **Review failure behavior.** Check cancellation, timeouts, retries, cleanup, partial writes, races, stale state, and error propagation.
6. **Verify evidence.** Confirm tests cover the changed behavior and relevant regressions. Treat unrun checks as unverified, never as passing.
7. **Record findings.** Cite the exact file and line, describe the impact, and provide a reproducible scenario. Separate confirmed defects from questions and suggestions.
8. **Make the decision.** Request changes for unresolved high-impact defects; approve only when blocking findings are addressed and the evidence is sufficient.

## Severity levels

- **Critical:** Immediate compromise, broad data loss, or a security boundary bypass. Block release and escalate.
- **High:** Likely security issue, data corruption/loss, broken isolation, or a major workflow failure. Block merge.
- **Medium:** Meaningful correctness or reliability defect with a narrower impact. Usually fix before merge unless explicitly accepted and documented.
- **Low:** Minor edge case, maintainability concern, or non-blocking improvement.

Severity should reflect impact and realistic exploitability, not how large the code change looks.

## Saber-specific invariants

Reviewers should pay special attention to:

- SQLite remains authoritative for persisted task and terminal-lock state; process supervision determines liveness; the UI reflects server state.
- Task workspaces and run worktrees remain isolated, with immutable run scope.
- Git workspace operations validate repository root and branch identity before acting.
- Dirty and ignored-file protections, stale-review checks, and fast-forward-only merge rules remain intact.
- Cancellation and timeout handling must not leave unsafe partial state or skip required cleanup.
- Existing shared-checkout tasks remain serialized where required.
- Verification commands and acceptance criteria remain trustworthy; a change to tests or verification plans needs human scrutiny.

## Review report format

For an audit report, summarize:

1. **Verdict:** Approve, request changes, or insufficient evidence.
2. **Findings:** Severity, file/line, impact, reproduction, and recommended fix.
3. **Coverage gaps:** Required checks not run or behavior not exercised.
4. **Residual risks:** Accepted limitations and follow-up work.
5. **Evidence:** Test/build/analysis results, clearly distinguishing observed results from assumptions.

Do not claim a PR is validated solely because code was edited or a workflow was configured.
