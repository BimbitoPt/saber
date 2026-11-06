# Repository-first launch — slice 1: launch context contract

## Status and authorization

**Status:** Approved for implementation.
**Date:** 2026-11-07.
**Authorization:** The repository owner requested autonomous issue and pull-request work. This is the first implementation slice of issue #18; the issue stays open until the terminal-ownership slices land.

## Problem and user workflow

Saber currently requires the developer to create a project and task before reaching the terminal workflow they already have in a normal shell. The product direction says the opposite: `cd ~/Projects/saber && saber` should recognize the repository, bootstrap the workspace, and put a terminal there immediately.

Slice 1 delivers the launch-context contract and the automatic project bootstrap. Before: launching Saber shows a project/task administration surface and the developer types the project path by hand. After: the launcher hands the invoking shell's working directory to the app, the server detects the Git repository, registers the project once (canonical paths dedupe), reads local guidance metadata, and the workspace shows the detected repository with its branch and dirty state; the new-task form is prefilled with the repository root.

## Scope and exclusions

In scope: the `SABER_LAUNCH_CWD` launcher-to-app handoff, Git-root discovery from any nested directory, automatic project registration with duplicate prevention, local guidance discovery (AGENTS.md, README, package.json scripts, package manager lockfiles), branch and dirty-state detection, explicit fallbacks for non-Git or missing launch context, launch summary UI in the workspace, and the `POST /api/launch` + `GET /api/launch-context` endpoints.

Out of scope (remaining slices of issue #18, tracked in the plan): project-scoped persistent terminals replacing task-owned terminals, deep terminal lifecycle restructuring, multi-project switching UI, packaged cross-platform smoke tests.

## Requirements implemented in this slice

### REPO-FIRST-01 — Launch-context handoff

The `scripts/launcher/saber.cmd` (Windows) and `scripts/launcher/saber.sh` (Linux/macOS) launchers set `SABER_LAUNCH_CWD` to the invoking shell's working directory before starting the desktop app; the Tauri process and its local server inherit the variable. A GUI launch from a dock without the variable is a valid, handled state (`status: "unavailable"`), not an error.

Acceptance: route tests set and clear `SABER_LAUNCH_CWD` and read the resulting context from `/api/launch-context`.

### REPO-FIRST-02 — Git root discovery

`resolveGitRoot` resolves the repository root from any directory inside it via `git rev-parse --show-toplevel` (fixed argv, no shell, 5s timeout). Missing git, non-repositories, and transient git failures all resolve to "no repository detected" rather than an error.

Acceptance: unit tests with a fake git runner plus a real `git init` repository in the route test.

### REPO-FIRST-03 — Automatic project bootstrap

The detected root is registered through the existing project registry; `registerProject` canonicalizes paths, so repeated launches from nested directories resolve to one project record. No user input is requested.

Acceptance: the route test asserts exactly one project record exists after two launches (nested directory and root).

### REPO-FIRST-06 — Project context discovery

`discoverGuidance` reads AGENTS.md, README (common casings), package.json script names (string commands only), and detects the package manager from lockfiles; `discoverRepositoryState` reads the current branch (or detached HEAD) and dirty working-tree state. Everything is local: no repository contents, secrets, or environment files leave the machine, nothing is rewritten, and no setup scripts run.

Acceptance: guidance unit tests; the guidance payload contains file paths and names only.

### REPO-FIRST-07 — Safe ambiguity handling

A directory outside any Git repository returns `status: "outside-git"` with an explanation and the most recently registered project as a fallback. A launch without the handoff variable returns `status: "unavailable"`. Saber never silently selects an unrelated repository.

Acceptance: launchContext unit tests and route tests; the workspace renders the fallback reason (TaskWorkspace tests).

### UI surface (supports REPO-FIRST-04/05, not yet the full requirement)

The workspace shows a launch summary line (repository name, branch, clean/dirty, AGENTS.md, package manager) and prefills the new-task project field with the detected root — overriding the generic inventory prefill, never a saved draft. Terminal behavior itself is unchanged in this slice; no task title or spec is required to view the workspace.

## Verification plan

| Requirement | Verification |
| --- | --- |
| REPO-FIRST-01 | `bun run test -- src/server/routes/routes.test.ts` (launch routes) |
| REPO-FIRST-02/03 | `bun run test -- src/server/launchContext.test.ts` and the real-git route test |
| REPO-FIRST-06 | Guidance unit tests in `launchContext.test.ts` |
| REPO-FIRST-07 | Fallback unit + route tests; `src/components/TaskWorkspace.test.tsx` render tests |
| Regression | `bunx tsc --noEmit`, `bun run test`, `bun run build` |

## Completion evidence

Pending CI and review. Terminal-ownership requirements (REPO-FIRST-04/05/08, TERMINAL-01..06) remain open under issue #18 and are sequenced in the implementation plan.
