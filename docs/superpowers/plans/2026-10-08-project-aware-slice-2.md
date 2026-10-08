# Project-aware context, slice 2: specialist teams — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a developer explicitly launch a bounded, project-configured specialist team for one task — each member in its own isolated worktree with immutable profile/role capture — and review every member's outcome without any implicit merge or verification. Slice 1 (project record, profile revisions, single-agent capture, budgets, preview) is committed and stays the foundation; its single-run default, one-worktree-per-task model, and read-only API contract are unchanged.

**Architecture:** Add a `roles` table (per-project role definitions bound to the profile revision they were based on) and a `teams` table (task-level grouping of independent run IDs). Provision additive per-run worktrees (`worktrees/<taskId>/runs/<runId>`, provider-neutral per-run branches) while the task's primary workspace remains the review and single-run merge source. Reserve all member workspaces atomically before spawning any member process; derive team state from member runs; extend the existing guarded merge to accept an explicitly reviewed member worktree with the same ff-only, clean-tree, and reviewed-head checks. Runs keep their existing immutable capture fields (`profileRevisionId`, `roleId`, `roleInstructions` from slice 1).

**Tech Stack:** Bun, TypeScript, TanStack Start, React, Tailwind v4, Tauri v2, SQLite through `node:sqlite`, Vitest, existing provider adapters and Git worktree service.

## Global Constraints

- Use Bun only for package management and scripts.
- Use port 8082 with strict-port development behavior. `vite dev` cannot serve API routes in this tree; browser verification uses the production server build served from the staged sidecar tree.
- Playwright drivers run under system Node, not Bun (DevTools pipe handshake stalls under Bun).
- Preserve provider-independent task IDs and provider-owned run/session IDs.
- Capture immutable task/run scope; later task, profile, or role edits never mutate a prior run. Role edits replace the definition; history stays in run snapshots.
- No automatic merge, commit, deploy, or verified-state synthesis from member success.
- No autonomous behavior: no team launches on task creation, no role self-assignment, no scope expansion without explicit user action.
- Do not store credentials or environment values in roles, teams, or handoffs.
- Do not edit `src/routeTree.gen.*` or `src-tauri/gen/**` by hand.
- Keep the terminal-first Saber workflow; team UI supports the terminal and task workflow rather than replacing it.
- A successful process exit is ready for review, not verified.
- Verify behavior in the running app and inspect changed panes in the browser; use native desktop checks for behavior the browser cannot prove.

---

## File map

- `src/lib/tasks.ts`: shared role, team, per-run-worktree, and member-review types.
- `src/server/taskStore.ts`: additive `roles` and `teams` tables, per-run worktree metadata on runs or a run-workspace index.
- `src/server/specialistTeams.ts` (new): role CRUD validation, four-role ceiling, implementer rule, atomic reservation with rollback, bounded launch, team state derivation, member review projection.
- `src/server/specialistTeams.test.ts` (new): limits, atomicity/rollback, write isolation, read-only enforcement, partial spawn failure, no implicit integration.
- `src/server/providers/types.ts` plus adapters: read-only invocation support declaration per adapter, verified against installed CLIs; unsupported role/provider pairs report unavailable.
- `src/server/agentRuns.ts`: accept a role + explicit worktree override at launch for team members; reuse immutable capture, budget, and lock semantics.
- `src/server/gitWorkspaces.ts`: per-run worktree provisioning/removal under the managed root with the existing safety checks; parameterized member merge with identical guards.
- `src/server.ts`: role and team routes following existing route/error conventions.
- `src/lib/api.ts`: typed client methods for roles, teams, member review, and member merge.
- `src/components/SpecialistTeamPicker.tsx` (new): default single agent; explicit bounded multi-role launch behind role/provider review and a workspace plan.
- `src/components/TaskDetail.tsx`: team status, member runs with outcome/diff/blockers, explicit per-member merge action.
- `src/components/TaskWorkspace.test.tsx` and focused component tests: explicit launch flow, restored team status, A-B-A with members.

## Task 1: Adapter read-only spike and capability declarations (PAC-04 honesty, PAC-06)

**Status:** Implemented and verified 2026-10-08: provider suites 36/36 across `providers/`, `agentRuns`, and `gitWorkspaces` fixtures; `tsc` clean. Spike findings from installed CLIs: `opencode run --help` exposes no sandbox/read-only flags (only `--auto`, which goes the wrong way) → unsupported; `claude --help` exposes `--permission-mode` and `--disallowedTools` → read-only via `plan` mode with Edit/Write/NotebookEdit denied (empirical refusal untested — claude is signed out here); codex CLI not installed → unverified, unsupported with reason. `AgentProvider.readOnly` declared per adapter; `opencodeProvider` return type simplified to `AgentProvider`.

**Files:** `src/server/providers/types.ts`, `src/server/providers/opencode.ts`, `src/server/providers/codex.ts`, `src/server/providers/claude.ts`, provider tests.

- [x] Declare read-only invocation support on the provider contract (e.g. `readOnlyArgs` or a support flag with exact flags), following the `contextBudget` precedent.
- [x] Verify each installed CLI's actual read-only/sandbox interface from its own help/version output; never assume flags. Codex and Claude Code interfaces are discovered, not asserted.
- [x] Combinations without adapter-expressed read-only report the role/provider pair unavailable; document which pairs are unavailable on this machine.
- [x] Add contract tests for declared flags and for unavailable-pair reporting. Live authenticated execution is not required; unavailable states with reasons are valid evidence where CLIs or auth are missing.
- [x] Run provider focused tests plus `bunx tsc --noEmit`.

## Task 2: Roles bound to projects and profile revisions (PAC-05)

**Status:** Implemented and verified 2026-10-08: `specialistTeams.test.ts` 4/4 (seeding once bound to the active revision, reviewer limited to claude per Task 1 declarations, duplicate/invalid/unknown-provider rejection, update/disable persistence, unregistered-project refusal); `tsc` and `git diff --check` clean. Routes `GET/POST /api/roles` and `PATCH /api/roles/{id}?root=` reuse the profile error mapping; client in `lib/api.ts`.

**Files:** `src/lib/tasks.ts`, `src/server/taskStore.ts`, `src/server/specialistTeams.ts`, `src/server/specialistTeams.test.ts`, `src/server.ts`, `src/lib/api.ts`.

- [ ] Add types: `SpecialistRole` (stable ID, display name, instructions, write flag, supported providers, based-on profile revision ID, enabled state).
- [ ] Add a `roles` table keyed by project root plus role ID. Seed every project with built-in `implementer` (write, all providers) and `reviewer` (read-only, providers per Task 1 declarations) roles bound to the active profile revision when the first team flow opens; record the basis revision on each role.
- [ ] Add minimal role CRUD: create/update/disable custom roles with validation (unique ID, non-empty instructions, known providers, write flag explicit). Role edits never rewrite run history; runs carry their instruction snapshot from slice 1 fields.
- [ ] Add routes: `GET /api/projects/{root}/roles`, `POST` create, `PATCH` update/disable, following existing conventions and error shapes.
- [ ] Add tests: seeding, duplicate/invalid IDs, unknown providers, disabled roles excluded from launch, history stability across role edits.
- [ ] Run focused tests plus `bunx tsc --noEmit`.

## Task 3: Atomic team launch with per-run worktrees (PAC-05, PAC-06)

**Status:** Implemented and verified 2026-10-08: `specialistTeams.test.ts` 10/10 (selection validation, implementer rule, read-only pairs incl. real-adapter unsupported case, non-Git/busy refusal, distinct-worktree launch with role capture, atomic rollback creating nothing, partial spawn visibility); related suites 37/37; `tsc` and `diff-check` clean. Routes `GET/POST /api/tasks/{id}/teams` and `POST .../teams/plan` with readiness gating on launch. Overlap semantics confirmed: distinct git roots never overlap, so per-run worktrees are isolated by construction.

**Files:** `src/server/specialistTeams.ts`, `src/server/agentRuns.ts`, `src/server/gitWorkspaces.ts`, `src/server/taskStore.ts`, `src/server.ts`, tests.

- [x] Add a `teams` table: team ID, task ID, member run IDs, selected roles/providers, workspace plan, timestamps. A team groups runs; it never collapses them.
- [x] Validate the explicit launch request before touching anything: at most four selected roles, implementer present when any selected role is write-enabled, providers installed/authed/capable (read-only pairs included), task locks free, Git eligibility (repository root, clean preconditions per existing service).
- [x] Provision a distinct managed worktree per write-capable member under `worktrees/<taskId>/runs/<runId>` with provider-neutral per-run branches before starting any member process. Read-only members receive read-only invocation (Task 1 declarations) on separate paths, never a shared writable path.
- [x] On reservation failure: roll back only newly provisioned empty worktrees, create no runs and no team record, and return the serial-run recommendation. On later spawn failure: preserve started/failed member records as partial outcomes; release only unused empty reservations; never hide the partial state.
- [x] Launch member runs through the slice-1 capture path (profile revision, role snapshot, budget check, locks). Each member owns its process, events, workspace, and outcome.
- [x] Add temporary-Git integration tests: parallel members in distinct worktrees, atomic reservation failure with clean rollback, partial spawn failure visibility, read-only non-interference, non-Git refusal, no branch mutation from launch alone.
- [x] Run focused suites plus `bunx tsc --noEmit`.

## Task 4: Team review UI with explicit integration only (PAC-07)

**Status:** Implemented and verified 2026-10-08: `SpecialistTeamPicker` (explicit plan-review-then-launch gating) and `TeamReviewList` (member states, review-on-demand, explicit merge, blocked-member display) with 5 tests across two new suites; `TaskDetail.test.tsx` still 5/5; `tsc` clean. Member merge reuses identical guards parameterized to the member worktree with sequential per-member merges, explicit rebase guidance on non-ff, and guarded cleanup reporting.

**Files:** `src/components/SpecialistTeamPicker.tsx`, `src/components/TaskDetail.tsx`, `src/lib/api.ts`, `src/server.ts`, focused component tests.

- [ ] Keep the single-agent run as the primary action. Place multi-agent launch behind an explicit picker requiring role/provider review and workspace-plan confirmation; no launch on task creation.
- [ ] Render team groups with independent member status, provider/role/revision identity, outcome summary, changed files, checks, and blockers. Derive state from member runs; never synthesize a verified state.
- [ ] Add per-run review reads (head, branch, status, diff for a member worktree) and an explicit per-member merge action reusing the existing ff-only, clean-tree, reviewed-head guards parameterized to the member worktree. Merges run one member at a time directly into the source checkout: a non-fast-forward (e.g. a teammate's earlier merge touched the same files) fails with guidance to rebase explicitly in the terminal — never auto-rebased. After a successful member merge, its worktree is removed through the same guarded removal path; other members keep their history and must re-review before their own merge.
- [ ] Successful members stay ready-for-review; failed/interrupted members keep history; nothing merges or verifies without the explicit action.
- [ ] Add component tests: picker gating, member rendering, merge-action explicitness, no auto-advance.
- [ ] Verify in the browser against the production server build.

## Task 5: Team continuity and full slice verification (PAC-08, plus slice gate)

**Status:** Verified 2026-10-08. Full suite 24 files / 139 tests, `test:terminal` (2 Rust + 17 Vitest), `cargo test` 8/8 (one health-fixture timeout flake, then clean), `tsc`, production build with checksum-verified sidecar staging. Headless Chromium closeout 14/14 with two real opencode runs: profile/role setup, picker plan review, explicit launch, role capture with distinct worktrees, no source commits from launch, team review, explicit member merge with worktree cleanup, no verified synthesis, A-B-A. Interrupt cycle proven end to end: server-only kill → both members reconcile as interrupted on restart, team record survives, relaunch blocked 409 with zero duplicate runs, UI shows both interrupted members, orphan check clean, acknowledge-then-relaunch succeeds with exactly one added run. New double-launch guard: `planTeam` refuses while any member runs or is interrupted. No Tauri runtime changes: MSI/NSIS not rebuilt.

**Status:** Verified 2026-10-08. Full suite 24 files / 138 tests, `test:terminal` (2 Rust + 17 Vitest), `cargo test` 8/8 (one health-fixture timeout flake, then 2× clean), `tsc`, production build with checksum-verified sidecar staging. Headless Chromium closeout 14/14 against the production server build: profile approval, built-in + custom role setup, picker plan review, explicit 2-member launch, two real opencode runs to `done` with per-member role capture and distinct worktrees, no source commits from launch, team review display, explicit member merge with worktree cleanup, no verified synthesis, A-B-A restoration. Restart persistence of tasks/profile/roles proven in the slice-1 closeout and unchanged since. No Tauri runtime changes: MSI/NSIS not rebuilt.

**Files:** `src/components/TaskWorkspace.test.tsx`, spec and roadmap docs.

- [x] Reload persisted teams and member run state on task selection and app restart using existing interrupted-run reconciliation; prove A -> B -> A with two tasks and at least two roles including an interrupted member, with no duplicate processes.
- [x] Run `bun run test` by itself; expected: all files pass without worker-start errors (rerun uncontended on timeout flakes).
- [x] Run `bun run test:terminal`, `bunx tsc --noEmit`, `bun run build`, `cargo test`, and `git diff --check`; expected: all succeed.
- [x] Rebuild and reinstall the Windows MSI/NSIS only if this slice touched the Tauri runtime or packaged permissions; otherwise record why packaging was skipped.
- [x] Browser verification in headless Chromium (system Node) against the production server build with an isolated `SABER_DATA_DIR`: role setup, explicit two-member team launch, per-member review, one explicit member merge, A-B-A restoration. If installed providers allow, run one real bounded team on a trivial spec; otherwise record the block with readiness evidence.
- [x] Record completion evidence against PAC-05–PAC-08 in the spec; list remaining gaps. A successful build or agent exit is not completion evidence by itself.

## Plan self-review

- PAC-05 maps to Tasks 2–3; PAC-06 maps to Tasks 1 and 3; PAC-07 maps to Task 4; PAC-08 maps to Task 5. PAC-01–PAC-04 and PAC-09 are slice-1 receipts this slice reuses without reopening.
- The task's primary workspace and single-run merge flow are untouched; per-run worktrees and member merge are additive with identical guards.
- Partial failure is always explicit and persisted; rollback covers only empty reservations, never member outcomes.
- Read-only enforcement is adapter-expressed or the pair is unavailable; convention-only enforcement is excluded by construction.
- No TODO/TBD placeholders remain. Commands and expected results are named; live auth is not required where contract tests and unavailable states apply.
