# Terminal startup failure state

## Status and authorization

**Status:** Approved for implementation.
**Date:** 2026-11-06.
**Authorization:** The repository owner requested autonomous issue and pull-request work. This bounded regression fix is tracked by issue #13.

## Problem and user workflow

When Saber runs with its native terminal runtime available but native session discovery or reconciliation fails, the workspace reports the error while leaving the terminal pane in its loading state. The user cannot distinguish a failed initialization from a slow one.

## Scope and exclusions

In scope: end the terminal loading state when initialization fails, preserve the visible error, and add regression coverage.

Out of scope: changing native process ownership, retry behavior, terminal recovery semantics, or the terminal API.

## Requirements and acceptance criteria

### TERM-INIT-01 — Failure ends loading

If `terminal_list` or terminal reconciliation rejects, terminal initialization is considered complete and the loading indicator is removed.

Acceptance: a rejected native session discovery call does not leave “Checking terminal sessions…” rendered.

### TERM-INIT-02 — Failure remains visible

The existing startup error remains visible to the user.

Acceptance: the workspace renders the startup error after initialization rejects.

### TERM-INIT-03 — Existing paths remain intact

Successful reconciliation and the no-native-runtime fallback keep their existing behavior.

Acceptance: the focused regression test covers the failure path; the full suite checks for regressions in existing terminal behavior.

## Verification plan

| Requirement | Verification |
| --- | --- |
| TERM-INIT-01 | `bun run test -- src/components/TaskWorkspace.test.tsx` |
| TERM-INIT-02 | Assert the rendered startup alert contains the native error |
| TERM-INIT-03 | `bun run test` and existing terminal lifecycle tests |

## Completion evidence

Pending CI and review. A successful build alone does not establish native terminal behavior.
