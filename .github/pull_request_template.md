## Summary
<!-- What changed and why? Link the issue/spec when applicable. -->

## Scope and acceptance criteria
- [ ] Requirements or acceptance criteria are clear.
- [ ] The diff is limited to the intended change.
- [ ] Generated files and unrelated refactors are excluded.

## Verification
- [ ] Tests added or updated for changed behavior.
- [ ] Relevant tests pass locally.
- [ ] `bunx tsc --noEmit` passes.
- [ ] `bun run build` passes.
- [ ] CI results are green, or failures are explained below.

## Safety and regression review
- [ ] Errors, cancellation, retries, and partial failures are handled.
- [ ] No secrets, tokens, credentials, or sensitive data are introduced.
- [ ] Input validation, path boundaries, and authorization are preserved.
- [ ] Persistence, concurrency, and lifecycle invariants are preserved.
- [ ] API, schema, config, and migration compatibility are considered.
- [ ] Tests cover relevant regression and failure cases.

## Reviewer notes
**Risk level:** Low / Medium / High

**Areas requiring careful review:**
<!-- e.g. filesystem, Git worktrees, terminal/process lifecycle, SQLite, API contracts -->

**Known limitations / follow-ups:**
<!-- Explicitly state anything not tested or intentionally deferred. -->

## Reviewer sign-off
- [ ] Correctness and edge cases reviewed.
- [ ] Security and data-loss risks reviewed.
- [ ] Tests validate behavior, not only implementation details.
- [ ] No unresolved high- or critical-severity findings remain.
