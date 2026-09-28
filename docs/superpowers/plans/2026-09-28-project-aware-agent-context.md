# Project-aware agent context and specialist teams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each Saber project a reviewed, revisioned knowledge profile that is captured in every run, with one project-aware agent by default and explicitly launched isolated specialist teams when requested.

**Architecture:** Keep project profiles and team definitions in the existing local SQLite store. Treat approved profile revisions and each run's task/profile/role/workspace inputs as immutable snapshots. Extend the current provider-run and Git-worktree boundaries; represent a specialist team as a persisted group of independent runs, never as one shared mutable run. Add project profile and team controls to the current task-first workspace.

**Tech Stack:** Bun, TypeScript, TanStack Start, React, Tailwind v4, Tauri v2, SQLite through `node:sqlite`, Vitest, existing provider adapters and Git worktree service.

## Global Constraints

- Use Bun only for package management and scripts.
- Use port 8082 with strict-port development behavior.
- Preserve provider-independent task IDs and provider-owned run/session IDs.
- Capture immutable task/run scope; later task or project-profile edits never mutate a prior run.
- Use managed task worktrees for parallel writes; serialize writes in a shared checkout.
- Do not store credentials or environment values in project profiles or handoffs.
- Do not edit `src/routeTree.gen.*` or `src-tauri/gen/**` by hand.
- Keep the terminal-first Saber workflow; profile and team UI supports the terminal and task workflow rather than replacing it.
- A successful process exit is ready for review, not verified; no automatic merge, commit, or deploy.
- Verify behavior in the running app and inspect changed panes in the browser; use native desktop checks for behavior the browser cannot prove.

---

## File map

- `src/lib/tasks.ts`: shared project-profile, profile-entry, specialist-role, team, and run-snapshot types.
- `src/server/taskStore.ts`: additive SQLite tables and transaction-safe persistence for profiles, revisions, team groups, and run snapshot fields.
- `src/server/projectProfiles.ts`: validate project-root membership, collect allowlisted repository facts, redact/exclude secrets, create draft revisions, approve/reject revisions, and render context previews.
- `src/server/projectProfiles.test.ts`: fixture-based profile source, revision, scope, redaction, and restart tests.
- `src/server/agentRuns.ts`: require and persist immutable profile/role snapshots at launch, while preserving existing task locks, provider ownership, and native session semantics.
- `src/server/agentRuns.test.ts`: assert captured run context, provider-specific routing, failure transitions, and retained history.
- `src/server/specialistTeams.ts`: reserve all workspaces atomically, create bounded run groups, launch selected supported role/provider pairs, and report aggregate status without hiding per-run state.
- `src/server/specialistTeams.test.ts`: test team limits, atomic reservation/rollback, write isolation, read-only roles, partial launch failures, and no implicit integration.
- `src/server.ts`: expose local project-profile, revision, preview, role, and team APIs following existing route/error conventions.
- `src/server/apiV1.ts` and `src/server/openapi.ts`: document only local API operations that belong to the approved API contract; keep mutation exposure within the existing loopback bearer-token policy.
- `src/lib/api.ts`: typed client methods for profile, preview, and team APIs.
- `src/components/ProjectProfilePanel.tsx`: show source-backed profile entries, draft/approved revisions, and review controls.
- `src/components/SpecialistTeamPicker.tsx`: default to one agent and make multi-role launch an explicit bounded action.
- `src/components/TaskDetail.tsx`: display selected profile revision, preview exact outgoing context, role/provider status, team runs, and each run's outcome/diff without changing task/run semantics.
- `src/components/TaskWorkspace.test.tsx` and focused component tests: verify profile review, default single-run flow, explicit parallel launch, and restored team status.

## Task 1: Persist source-backed project profiles (PAC-01, PAC-02)

**Files:** `src/lib/tasks.ts`, `src/server/taskStore.ts`, `src/server/projectProfiles.ts`, `src/server/projectProfiles.test.ts`, `src/server.ts`, `src/lib/api.ts`.

- [ ] Add types for profile entry origin (`repository` or `user`), source path/author, draft/approved state, profile revision ID, and project profile summary.
- [ ] Add SQLite tables for project profiles and append-only revisions; store path identity canonically and add foreign keys/indexes.
- [ ] Implement project-root validation using existing project resolution utilities. Reject sources outside the registered project and reject secret-bearing environment files and credential paths.
- [ ] Implement allowlisted repository discovery for project instructions and common manifests; do not read arbitrary source trees. Convert discovered facts into a draft with precise source references.
- [ ] Add APIs to get profile history, save a draft, approve it, reject/discard it, and inspect a source. Approval updates only the active-revision pointer.
- [ ] Add tests for persistence across reopening SQLite, valid/invalid source paths, edited/rejected drafts, immutable prior revisions, and source content changing after approval.
- [ ] Run `bun run test -- src/server/projectProfiles.test.ts`; expected: profile-focused tests pass.
- [ ] Run `bunx tsc --noEmit`; expected: exit code 0.

## Task 2: Review profile drafts in Saber (PAC-01, PAC-02, PAC-09)

**Files:** `src/components/ProjectProfilePanel.tsx`, `src/components/TaskDetail.tsx`, `src/lib/api.ts`, focused component tests, `src/components/TaskWorkspace.test.tsx`.

- [ ] Build an accessible profile panel that labels each entry's origin and source, shows active revision and draft state, and offers edit/approve/discard actions.
- [ ] Show the outgoing context source list and rendered context preview before the first run or when profile revision changes; exclude credentials, environment values, and out-of-project paths.
- [ ] Show a clear empty state for projects with no approved profile; allow one-agent task flow to proceed only with an explicit notice that no project profile context will be supplied.
- [ ] Add component tests for approve/reject, source display, empty profile notice, and excluded source visibility.
- [ ] Run focused component tests and open the changed project/task pane in the app at port 8082; verify keyboard operation and browser rendering.

## Task 3: Capture immutable profile and role inputs per run (PAC-03, PAC-04)

**Files:** `src/lib/tasks.ts`, `src/server/taskStore.ts`, `src/server/agentRuns.ts`, `src/server/agentRuns.test.ts`, `src/server/providers/types.ts`, `src/server/providers/opencode.ts`, `src/server/providers/codex.ts`, `src/server/providers/claude.ts`.

- [ ] Extend `RunRecord` with captured profile revision ID/content, role ID/instructions, and context-source references; existing serialized runs decode with absent optional fields.
- [ ] Update `AgentRuns.start` to resolve and capture the active approved profile revision and selected role before process creation. Persist the complete scope before launching.
- [ ] Build the provider prompt from task spec/revision, checkpoint, profile snapshot, and role instructions. Preserve raw provider output and native session IDs as today.
- [ ] Add an explicit context length check. When payload exceeds the provider's supported limit or provider capability is unavailable, fail before launch or show the exact omitted sources; never claim delivery when omitted.
- [ ] Ensure follow-up and provider-switch launches create new run snapshots and never change earlier inputs or transfer a hidden native session between providers.
- [ ] Add tests that compare stored run inputs before/after profile edits, verify provider changes create distinct snapshots, and verify unsupported/oversized context behavior.
- [ ] Run provider and agent-run focused tests plus `bunx tsc --noEmit`.

## Task 4: Add project-configured specialist roles (PAC-01, PAC-05)

**Files:** `src/lib/tasks.ts`, `src/server/taskStore.ts`, `src/server/projectProfiles.ts`, `src/server/server.ts`, `src/server/specialistTeams.ts`, tests.

- [ ] Define role records with stable role ID, display name, project-specific instruction, read/write capability, and enabled state; persist them within an approved profile revision.
- [ ] Validate at most four selected roles per team and require a project-aware implementer role whenever any selected role can write.
- [ ] Resolve provider readiness/capabilities for each selected role; represent unsupported or uninstalled combinations as unavailable before starting any process.
- [ ] Add tests for default role availability, invalid/duplicate role IDs, four-role ceiling, missing implementer, and unsupported provider combinations.

## Task 5: Launch bounded teams with atomic worktree reservation (PAC-05, PAC-06, PAC-07)

**Files:** `src/server/specialistTeams.ts`, `src/server/specialistTeams.test.ts`, `src/server/agentRuns.ts`, `src/server/gitWorkspaces.ts`, `src/server/taskStore.ts`, `src/server.ts`.

- [ ] Add persisted team group records that reference independent run IDs and preserve each run's own provider, native session, workspace, events, and outcome.
- [ ] Validate explicit team-launch request, selected roles, provider readiness, task lock state, and Git repository eligibility before starting any specialist.
- [ ] Provision and persist a distinct managed task worktree for every write-capable concurrent role before starting any role process. On reservation failure, roll back only newly provisioned empty worktrees and create no run group.
- [ ] Ensure read-only roles cannot write and editing roles never share a writable path. Unsupported/non-Git cases return a clear serial-run recommendation.
- [ ] Start individual runs only after all reservations succeed. If a later process spawn fails, preserve started/failed member records and release only unused empty reservations; never hide partial outcome.
- [ ] Derive team state from member run states; successful runs remain ready-for-review, failed/interrupted runs keep their history, and no team completion triggers merge or verification.
- [ ] Add temporary-Git integration tests for concurrency, atomic reservation failure, clean rollback, partial spawn failure, read-only roles, and no branch mutation.

## Task 6: Review specialist results and restore team state (PAC-07, PAC-08)

**Files:** `src/lib/api.ts`, `src/server.ts`, `src/components/SpecialistTeamPicker.tsx`, `src/components/TaskDetail.tsx`, `src/components/TaskWorkspace.test.tsx`, team component tests.

- [ ] Add API reads for team groups and member runs, including role, provider, captured profile revision, workspace, status, outcome, changed files, checks, and blockers.
- [ ] Keep one-agent run as the primary action. Place multi-agent launch behind an explicit action that requires reviewing the selected roles/providers and their workspace plan.
- [ ] Render independent member status, diff/review links, blockers, and checks. Do not synthesize a single “verified” state from member success.
- [ ] On task selection or app restart, reload persisted team groups and member run state; rely on existing interrupted-run reconciliation and avoid duplicate launches.
- [ ] Verify task A -> B -> A and app restart with two tasks and at least two roles, including an interrupted member, with no extra child processes.

## Task 7: API contract, security review, and end-to-end verification (PAC-01–PAC-09)

**Files:** `src/server/apiV1.ts`, `src/server/openapi.ts`, `docs/architecture/saber-api-and-platform.md`, `src/server/apiV1.test.ts`, relevant UI and server tests.

- [ ] Add only API operations needed by the local app flow, with bearer-token protection on loopback mutation routes and documented request/response schemas.
- [ ] Test that no environment values, credentials, sibling-directory files, or provider secrets enter profile persistence, previews, prompts, or API responses.
- [ ] Run focused suites for project profiles, agent runs, workspaces, teams, API, and UI.
- [ ] Run `bun run test` by itself; expected: all test files pass without worker-start errors.
- [ ] Run `bunx tsc --noEmit`, `bun run build`, and `git diff --check`; expected: all succeed.
- [ ] Restart the app with `bun run dev -- --port 8082 --strictPort`, open the changed task pane in the browser, and verify profile review, exact context preview, one-agent default, explicit team launch, each member's review state, and task A-B-A restoration.
- [ ] Build and launch a packaged app only if the new feature affects Tauri runtime or packaged permissions; do not edit generated `src-tauri/gen/**` files by hand.
- [ ] Record completion evidence against PAC-01–PAC-09 and list any platform or authenticated-provider gaps. A successful build or child-agent exit is not completion evidence by itself.

## Plan self-review

- PAC-01–PAC-02 map to Tasks 1–2; PAC-03–PAC-04 map to Task 3; PAC-05 maps to Tasks 4–5; PAC-06 maps to Task 5; PAC-07 maps to Tasks 5–6; PAC-08 maps to Task 6; PAC-09 maps to Tasks 1–2 and 7.
- The feature is kept in one sequenced implementation plan because profile approval, immutable capture, and specialist workspaces form one end-to-end continuity workflow; each task yields independently testable software.
- Existing workspace lock, run outcome, verification, and merge boundaries remain authoritative.
- Partial team launch is explicit and persisted; worktree provisioning is atomic before runs begin, while process-spawn failure is represented as partial member outcomes instead of falsely rolled back work.
- No TODO/TBD placeholders remain. Commands and expected results are named; provider live auth is not required to validate adapter contract behavior.
