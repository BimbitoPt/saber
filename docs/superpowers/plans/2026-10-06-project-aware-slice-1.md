# Project-aware context, slice 1: profile and single agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Saber usable for its own development while building the first project-aware slice: a Saber-side project record with a reviewed profile, immutable per-run capture, adapter context budgets, and a pre-launch source preview — default single agent only. No specialist teams in this slice.

**Architecture:** Add `projects` and append-only `profile_revisions` tables to the existing SQLite store; keep JSON-blob rows so additive fields need no migration. Resolve every task project path to a project record keyed by canonical repository root. Compose the provider prompt from spec revision, checkpoint, approved profile snapshot, and the fixed `default` role; persist the full snapshot plus the exact submitted prompt on the run. Declare per-adapter context budgets on the provider contract and refuse or explicitly narrow oversized payloads before spawn.

**Tech Stack:** Bun, TypeScript, TanStack Start, React, Tailwind v4, Tauri v2, SQLite through `node:sqlite`, Vitest, existing provider adapters and Git worktree service.

## Global Constraints

- Use Bun only for package management and scripts.
- Use port 8082 with strict-port development behavior. `vite dev` cannot serve API routes in this tree (`NitroViteError: vite environment "nitro" is unavailable`); browser verification uses the production server build served from the staged sidecar tree, as in the A1 receipt.
- Playwright drivers run under system Node, not Bun (Bun stalls the DevTools pipe handshake).
- Preserve provider-independent task IDs and provider-owned run/session IDs.
- Capture immutable task/run scope; later task, profile, or role edits never mutate a prior run.
- No specialist teams, team UI, or per-run worktrees in this slice; the single `default` role is the only role.
- Do not store credentials or environment values in project profiles or handoffs.
- Do not edit `src/routeTree.gen.*` or `src-tauri/gen/**` by hand.
- Keep the terminal-first Saber workflow; profile UI supports the terminal and task workflow rather than replacing it.
- A successful process exit is ready for review, not verified; no automatic merge, commit, or deploy.
- Verify behavior in the running app and inspect changed panes in the browser; use native desktop checks for behavior the browser cannot prove.

---

## File map

- `src/lib/tasks.ts`: shared project-record, profile-entry, profile-revision, run-capture, and adapter-budget types.
- `src/server/taskStore.ts`: additive `projects` and `profile_revisions` tables, canonical root identity, approval pointer, source-hash staleness.
- `src/server/projectProfiles.ts` (new): root validation, allowlisted repository discovery, secret deny-list, draft/approve/refresh, context assembly with budget accounting, pre-launch preview model.
- `src/server/projectProfiles.test.ts` (new): fixture-based source, revision, scope, redaction, restart, and staleness tests.
- `src/server/providers/types.ts` plus `opencode.ts`, `codex.ts`, `claude.ts`: per-adapter context budget and profile-context support declarations.
- `src/server/agentRuns.ts`: resolve and persist immutable profile/role snapshots at launch; enforce budget before spawn; reject cross-provider follow-up.
- `src/server/agentRuns.test.ts`: captured-snapshot, provider-change, oversized/unsupported-context, and history tests.
- `src/server.ts`: project-record and profile-draft/approve/refresh/preview routes following existing route/error conventions.
- `src/lib/api.ts`: typed client methods for the new routes.
- `src/components/ProjectProfilePanel.tsx` (new): entry origins/sources, revision history, edit/approve/discard, stale flag, empty state.
- `src/components/TaskDetail.tsx`: active-revision display, inline expandable outgoing-context preview, empty-profile and omitted-context notices.
- `src/components/TaskWorkspace.test.tsx` and focused component tests: profile review flow, default single-run launch, A-B-A and restart continuity.

## Task 0: Dogfood gate — run this slice from inside Saber (no requirement ID; entry condition)

**Files:** none. The freshly rebuilt Windows installers from the A2 receipt.

- [x] Install Saber on this machine (2026-10-06: NSIS `Saber_0.1.0_x64-setup.exe` silent install succeeded per-user to `%LOCALAPPDATA%\Saber` with `mstudio-ade.exe`, `node.exe`, `saber-server`, `uninstall.exe`. The per-machine MSI fails without elevation in this shell — Error 1925; interactive admin install remains a user action).
- [x] Launch the installed Saber (2026-10-06: PID 1540, owns Node sidecar PID 14676 plus WebView2 window; ephemeral loopback port 63778, health 200 minimal). Port 8082 untouched.
- [x] In the open Saber window (2026-10-06: user ran `echo SABER_DOGFOOD_OK` in the packaged task terminal and the marker echoed back. Shell is PowerShell in the task's managed worktree `%USERPROFILE%\.saber\worktrees\5a84a3a1-…` — the correct effective directory for a task with an isolated workspace, not the source checkout. Packaged PTY marker/cwd receipt closed. A prior `interrupted` session on the checkout root initially blocked the new shell per the no-overlapping-writers rule; the user recovered it through the designed confirm-stopped flow and started the terminal.)
- [x] Close Saber through its window and confirm the app and its owned server/terminal processes exit (2026-10-06: user closed via window; no `mstudio-ade` process remains and port 63778 is free. Graceful-shutdown receipt closed for the app/server.)
- [ ] Create one Saber task per plan task below (Tasks 1–6), each with its spec section pasted as the task spec and its acceptance bullets as criteria. All implementation work in this slice happens in Saber task terminals or Saber provider runs; evidence for each plan task is recorded as Saber verification records on its task.
- [ ] Approve the first real profile on the Saber project itself (Task 2) and use it for a real provider run (Task 3): Saber eats its own context.

## Task 1: Project record and profile persistence (PAC-01, PAC-02)

**Status:** Implemented in task worktree `678f9f3c` and independently verified on 2026-10-06: focused suite 7/7, full suite 18 files / 97 tests, `tsc` clean. No generated files touched.

**Files:** `src/lib/tasks.ts`, `src/server/taskStore.ts`, `src/server/projectProfiles.ts`, `src/server/projectProfiles.test.ts`.

- [x] Add types: `ProjectRecord` (canonical root, display name, createdAt), `ProfileEntry` (key, origin `repository`|`user`, source path or authorship, content capped at 100,000 chars), `ProfileRevision` (revision ID, project root, entries, source hashes, state `draft`|`approved`, timestamps), plus an active-revision pointer per project.
- [x] Add `projects` and `profile_revisions` tables with foreign keys and indexes. Canonicalize roots with the existing worktree canonicalization (case-insensitive on Windows). Prior serialized data decodes with absent optional fields.
- [x] Implement root validation: reject sources outside the registered project root; reject secret-bearing paths (environment files, keys, credential files) per the deny-list; never interpolate environment values.
- [x] Implement allowlisted repository discovery (project instructions plus common manifests: package README/AGENTS equivalents, `package.json`, Tauri config, provider inventory). Do not walk arbitrary source trees. Discovered facts become a draft with precise source references.
- [x] Implement draft save/edit/discard, approve (pointer moves; prior revisions stay readable), and refresh (explicit action producing a comparable draft). Record source hashes at approval; later source changes surface a `stale` flag without rewriting the active revision.
- [x] Add tests: persistence across SQLite reopen, valid/invalid/out-of-project sources, deny-listed filenames, edited/rejected drafts, immutable prior revisions, stale flag after source change, restart recovery.
- [x] Run `bun run test -- src/server/projectProfiles.test.ts`; expected: new focused tests pass.
- [x] Run `bunx tsc --noEmit`; expected: exit code 0.

## Task 2: Profile review UI with empty states (PAC-01, PAC-02, PAC-09 preview shape)

**Status:** Implemented in the shared checkout and verified on 2026-10-06: component suite 5/5, headless Chromium 6/6 against the production server build, full suite 20 files / 109 tests, `tsc` and `git diff --check` clean. Routes: `POST/GET /api/project-records`, `GET /api/project-profiles?root=`, `POST /api/project-profiles/drafts`, `POST /api/project-profiles/refresh`, `PATCH/POST /api/project-revisions/{id}[/approve|/discard]` with 400/404/409 mapping. Panel mounted in `TaskDetail` List view; add-entry appends to the current draft via edit (no orphan drafts).

**Files:** `src/components/ProjectProfilePanel.tsx`, `src/components/TaskDetail.tsx`, `src/lib/api.ts`, `src/server.ts`, focused component tests.

- [x] Add routes following existing conventions (`jsonResponse`, 400/404/409 shapes): `POST /api/project-records` (register by absolute path, resolves through the existing project-resolution path), `GET /api/project-records`, `GET /api/project-profiles?root=...` (history plus active pointer), `POST /api/project-profiles/drafts`, `POST /api/project-revisions/{rev}/approve`, `POST .../discard`, `POST /api/project-profiles/refresh`.
- [x] Build `ProjectProfilePanel`: per-entry origin label and source, active revision and draft state, edit/approve/discard actions, stale flag, and an empty state for projects with no approved profile.
- [x] Mount the panel in the task List view for the selected task's resolved project. Keep task/run semantics untouched; the panel never starts runs or terminals.
- [x] Add component tests: approve/reject flow, source display, empty state, stale flag rendering.
- [x] Run focused component tests; open the changed pane in the browser against the production server build and verify keyboard operation and rendering.

## Task 3: Immutable run capture and adapter budgets (PAC-03, PAC-04)

**Status:** Implemented in the shared checkout and verified on 2026-10-06: focused suites 17/17 (`agentRuns` 10/10 plus `projectProfiles` 7/7), broader suite 18 files / 100 tests (excluding Git-worktree and terminal timing suites), `tsc` and `git diff --check` clean.

**Files:** `src/lib/tasks.ts`, `src/server/taskStore.ts`, `src/server/agentRuns.ts`, `src/server/agentRuns.test.ts`, `src/server/providers/types.ts`, `src/server/providers/opencode.ts`, `src/server/providers/codex.ts`, `src/server/providers/claude.ts`, `src/server.ts`.

- [x] Extend `RunRecord` with `profileRevisionId`, `roleId` (always `default` in this slice), `roleInstructions` snapshot, `contextSources` (exact source list sent), keeping the existing `task` field as the stored submitted prompt for audit.
- [x] Declare per-adapter context support on the provider contract: a character budget and whether profile context is supported. Set honest initial values per adapter; combinations without support are reported unavailable, never silently sent.
- [x] Update `AgentRuns.start` to resolve the active approved profile revision (or explicit empty-profile notice), assemble the prompt as spec revision + spec + criteria + checkpoint + profile snapshot, check the assembled size against the adapter budget, and persist the complete snapshot before spawning. Oversized payloads fail before launch naming the over-budget source; unsupported adapters return an explicit omitted-context outcome without launching.
- [x] Preserve existing task/workspace/terminal locks, provider ownership, and native session semantics. Cross-provider follow-up is rejected; provider change always starts a fresh snapshot run.
- [x] Add a preview endpoint `POST /api/tasks/{id}/runs/preview` returning the exact source list, per-source and total character counts, the adapter budget verdict, and the empty-profile or omitted-context notice. No process is started.
- [x] Add tests: stored inputs stable across later profile edits, two runs with different profile revisions, provider change creates a distinct snapshot, oversized payload names its source, unsupported adapter path is explicit, history retained.
- [x] Run `bun run test -- src/server/agentRuns.test.ts src/server/providers/`; expected: pass.
- [x] Run `bunx tsc --noEmit`; expected: exit code 0.

## Task 4: Inline pre-launch preview in the run control (PAC-04, PAC-09)

**Status:** Implemented and verified 2026-10-06. Component suite `src/components/TaskDetail.test.tsx` 5/5; headless Chromium (Playwright, system Node v24.15.0) against the production server build on port 8183 with an isolated `SABER_DATA_DIR`: 9/9 checks via `scripts/verify-task4-preview.mjs` with screenshots `task4-preview-ok.png`, `task4-preview-oversized.png`, `task4-preview-notice.png`.

**Files:** `src/components/TaskDetail.tsx`, `src/components/TaskDetail.test.tsx` (new), `src/lib/api.ts`, `src/lib/tasks.ts`, `src/server.ts`, `src/server/providers/executables.ts`, `src/server/providers/types.ts`.

- [x] Add an inline expandable outgoing-context section to the TaskDetail run control, driven by the preview endpoint: source list, sizes, budget verdict, and empty-profile or omitted-context notice. One click still launches; details are on demand per the approver decision.
- [x] Show provider capability state (supported/unsupported context, readiness) next to the provider picker using existing readiness data plus the new budget declarations.
- [x] Keep selection, terminal, workspace, and verification behavior unchanged.
- [x] Add component tests: preview expands with sources, oversized verdict blocks with named source, launch proceeds on explicit action only.
- [x] Verify in the browser against the production server build: preview, launch, and notice states.

## Task 5: Hygiene enforcement and fixture proof (PAC-09)

**Status:** Verified 2026-10-06: deny-list and no-interpolation tests in `projectProfiles.test.ts`, plus a fixture test in `agentRuns.test.ts` proving a discovered+approved profile keeps `.env`/`secrets.json` values out of the assembled run prompt and the preview payload. Enforcement points: draft validation, approval hashing, prompt assembly from validated entries only, raw file reads.

**Files:** `src/server/projectProfiles.ts`, `src/server/projectProfiles.test.ts`, `src/server/agentRuns.test.ts`.

- [x] Enforce the project-scoped source allowlist and secret-filename deny-list at draft creation, approval, and prompt assembly. Out-of-project additions require explicit per-source user action; nothing outside the root is silently included.
- [x] Add fixture-based tests with secret-bearing environment files, key material, and a sibling directory: assert exclusion from persistence, preview, prompt, and API responses.
- [x] Assert no environment variable values enter stored or transmitted context.
- [x] Run the profile and agent-run suites; expected: pass.

## Task 6: Continuity, full verification, and slice closeout (PAC-08, plus slice gate)

**Status:** Verified 2026-10-08. Full suite 21 files / 117 tests, `test:terminal` (2 Rust + 17 Vitest), `cargo test` 8/8, `tsc`, `build` + checksum-verified sidecar staging all pass. Closeout against the production server build with isolated data: 8/8 API checks including a real opencode run (`done`, exit 0) with captured profile revision, default role, and profile content in the submitted prompt; restart persistence of tasks and approved profile; UI A-B-A with profile following the selected task — 5/5. No Tauri runtime or packaging changes in this slice, so MSI/NSIS were not rebuilt.

**Files:** `src/components/TaskWorkspace.test.tsx`, spec and roadmap docs.

- [x] Verify task A -> B -> A and app restart restore the selected task's resolved project, active profile revision, checkpoint/draft, workspace identity, and latest run states without starting duplicate processes. Extend the workspace lifecycle test where the code path changed.
- [x] Run `bun run test` by itself; expected: all files pass without worker-start errors (rerun uncontended on timeout flakes).
- [x] Run `bun run test:terminal`, `bunx tsc --noEmit`, `bun run build`, `cargo test`, and `git diff --check`; expected: all succeed.
- [x] Rebuild and reinstall the Windows MSI/NSIS only if this slice touched the Tauri runtime or packaged permissions; otherwise record why packaging was skipped.
- [x] Browser verification in headless Chromium against the production server build with an isolated `SABER_DATA_DIR`: profile review, exact context preview, default single-agent launch with the Saber project's own approved profile, omitted-context notice path, and A-B-A restoration.
- [x] Record completion evidence against PAC-01–PAC-04, PAC-08, and PAC-09 (single-run path) in the spec; list remaining gaps (teams slice, native Tauri checks, authenticated Claude). A successful build or agent exit is not completion evidence by itself.

## Plan self-review

- PAC-01–PAC-02 map to Tasks 1–2; PAC-03–PAC-04 map to Tasks 3–4; PAC-09 maps to Tasks 1–2, 4, and 5; PAC-08 (single-run path) maps to Task 6; Task 0 is the dogfood entry gate.
- Slice 2 (specialist teams, PAC-05–PAC-07 plus extended PAC-06/PAC-08) is explicitly out; the `default` role, single-run default, and one-worktree-per-task model are unchanged here.
- All approver decisions are embedded: canonical-root identity, 100k entry bounds plus adapter prompt budgets, role model deferred to slice 2, inline expandable preview, hash-based stale flag.
- Each task yields independently testable software with named commands and expected results; provider live auth is not required to validate adapter contract behavior.
- No TODO/TBD placeholders remain.
