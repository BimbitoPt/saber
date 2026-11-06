# Repository-first launch — implementation plan

Spec: docs/superpowers/specs/2026-11-07-repository-first-launch-slice-1.md (issue #18).

## Slice 1 — Launch context contract (this PR)

1. `src/server/launchContext.ts`: `resolveGitRoot` (nested-directory git discovery, safe failures), `discoverRepositoryState` (branch, detached, dirty), `discoverGuidance` (AGENTS.md, README, package.json scripts, package manager), `buildLaunchContext` (detect, register once, summarize), `launchContextFromEnv` (launcher handoff via `SABER_LAUNCH_CWD`).
2. `src/server/routes/projects.ts`: `POST /api/launch` (explicit cwd, validated through `resolveWorkdir`) and `GET /api/launch-context` (launcher handoff).
3. `scripts/launcher/saber.cmd` + `saber.sh`: cross-platform launchers that pass the invoking shell's cwd.
4. `src/components/TaskWorkspace.tsx`: launch summary line + new-task prefill from the detected repository.
5. Tests: `launchContext.test.ts` (fake git + real git), launch route tests, TaskWorkspace launch tests; route table regenerated.

## Slice 2 — Project-scoped persistent terminal

- Introduce a project-level terminal session (TERMINAL-01) without removing task worktree isolation (existing task terminals keep working; TERMINAL-04 keeps tasks from owning terminals by default).
- Terminal lifecycle persistence across view switches (TERMINAL-05) and explicit new-tab/split creation (TERMINAL-02), with no agent-specific terminal types (TERMINAL-03).
- Verify against REPO-FIRST-04/05 acceptance: terminal ready at repository root without a task form.

## Slice 3 — Reopen, switching, and packaged verification

- Recent-project memory and multi-project switching (REPO-FIRST-08), restoring per-project terminal state where supported.
- Cross-platform launcher testing with spaces and Unicode paths (REPO-FIRST-10), packaged Windows/Linux/macOS smoke tests validating the actual terminal cwd (issue #14-style acceptance evidence).

## Verification gates

`bunx tsc --noEmit`, `bun run test`, `bun run build`. Behavior evidence comes from the requirement-mapped tests in the spec.
