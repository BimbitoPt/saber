# Project-aware agent context and specialist teams

## Status and authorization

Design approved by the user on 2026-09-28. Written specification is draft pending user review. This document authorizes requirements definition only; implementation requires review of this written spec and a separate implementation plan.

Reviewed against the implementation on 2026-10-06 (review notes inline under each affected requirement and in Approver decisions). No code was changed. The approver accepted all review recommendations on 2026-10-06; the spec is approved as revised below. Implementation requires a separate implementation plan, sequenced per Implementation sequencing.

## Problem and user workflow

A solo developer moves between several agent-driven projects and coding tools. Today, each tool session can require the developer to restate a project's architecture, conventions, commands, constraints, decisions, and task state. Generic agent roles also lack project-specific working knowledge. Saber should preserve that knowledge with the project and attach a stable snapshot to each task run, so returning to work does not depend on one provider's hidden session.

The developer registers or opens a project, reviews a source-linked project profile, and saves an approved revision. They create or resume a task with a spec and checkpoint. Saber supplies the task's captured profile revision to a selected provider run. One agent is the default. When requested, the developer can start a small project-configured specialist team in parallel. Each specialist works in its own task worktree; Saber presents outcomes and diffs for human review without merging automatically. Switching away and back restores the task, workspace, task state, and latest outcomes while provider-native sessions remain provider-owned.

## Scope and exclusions

This slice defines and implements the first project-aware context workflow over the existing task, run, provider, and isolated-workspace foundations.

Included:

- A Saber-side project record keyed by canonical repository root. Inventory entries and ad-hoc task project paths resolve to it; an unregistered path prompts for registration rather than silently creating a profile. The profile belongs to this record.
- A durable project knowledge profile with revision history and references to the repository files or user decisions that support each entry. Each entry carries a stable key, an origin (`repository` or `user`), a source path or authorship note, and content bounded like existing task fields.
- A review/edit step before a profile revision becomes active. Repository-derived facts must identify their source; user-entered decisions are identified as user-authored. Refresh is an explicit user action that produces a comparable draft; approval records source hashes so later source changes surface a stale flag without rewriting the active revision. Run outcomes may suggest edits, which also enter as drafts.
- An immutable profile revision captured by every new run, alongside the existing immutable task spec revision and checkpoint input.
- A project-level set of specialist role instructions, based on the approved profile. Each role has an ID, instructions, a write flag, and supported providers. The user chooses the provider for each run from supported installed providers.
- A single-agent default and explicit opt-in to launch a bounded team of specialists in parallel for one task.
- Separate task worktrees for concurrent specialist runs, with existing isolation and review safeguards. Saber displays each specialist's status, summary, changed files, verification, and blockers in the owning task.
- Task switching and restart recovery continue to use the existing task/run identity and lifecycle. Provider-native session IDs remain scoped to their provider runs.

Excluded:

- Cloud/team-shared profiles, synchronization, billing, or hosted agent execution.
- Automatic provider login, credential storage, permission bypass, hidden-session migration, automatic merge/commit/deploy, or silent profile activation.
- An autonomous agent swarm that can add roles, assign itself work, expand scope, or launch without explicit user action.
- Claims that all supported providers have identical capabilities. A provider/role combination must be supported by the adapter or shown unavailable.
- Automatic edits to profile content from run output. Saber may suggest a change, but the user reviews and activates it as a new revision.

## Requirements and acceptance criteria

- PAC-01: Project profile ownership. A project can have a durable profile containing architecture, stack, commands, conventions, constraints, decisions, and specialist role instructions. Entries distinguish repository evidence from user-authored guidance and retain source paths or authorship. Verify with a temporary project that saved profile data survives restart and every repository-derived entry resolves to a source path in that project.
- PAC-02: Review and revision. Editing or refreshing profile content creates a draft revision. It becomes active only after explicit user approval; prior revisions remain readable. Source files changing after approval do not silently rewrite an active revision. Verify approve/edit/reject/restart flows and confirm revision IDs and content remain stable.
- PAC-03: Immutable run context. Launching any provider run captures the task spec revision, active profile revision ID, role ID and role-instruction snapshot, checkpoint, workspace path, and the exact submitted prompt (already stored per run today for spec/criteria/context; profile and role fields are additive) used for that run. Later edits do not mutate prior run inputs. A provider change creates a new run with an explicit context handoff as a fresh prompt and does not claim hidden model state was transferred; the same-provider native-session follow-up path is rejected across providers. Verify with two runs for one task using different profile revisions and providers, then inspect stored inputs and run history.

  Review note: `RunRecord` persistence is a JSON blob in SQLite, so additive capture fields need no migration; the plan must still list the exact new fields and their bounds.
- PAC-04: Low-friction single-agent path. A developer can launch the default single project-aware agent without configuring a specialist team. The run receives the project profile snapshot and task context through the provider adapter's supported interface. Each adapter declares its context budget and whether it can carry profile context; oversized payloads name the over-budget source and fail with an actionable error, and unsupported combinations show an explicit omitted-context notice instead of launching silently. Delivery is auditable through the stored submitted prompt. Verify supported and unsupported adapter paths and resulting run metadata.

  Review note: no adapter declares a context budget today and readiness only covers install/auth. The capability declaration is new surface on the provider contract; the plan must add it rather than assume it.
- PAC-05: Explicit specialist team. A user may opt into a project-configured team for one task and select available role/provider combinations. The team is bounded to at most four specialists, and when any selected role is write-enabled the team must include the project-aware implementer role. No team launches on task creation or without explicit confirmation of the chosen roles. Verify default launch creates one run and opt-in team launch creates only the selected number of runs.
- PAC-06: Concurrent write isolation. Every simultaneously editing specialist run uses a distinct managed worktree for the same task and captures that worktree immutably. The task's primary workspace remains the review and merge source; per-run worktrees are additive (today worktrees are one-per-task, so the per-run scheme is new). Read-only roles never receive a writable worktree: they run through adapter-supported read-only invocation or are shown unavailable for that provider, and they cannot share a writable path with an editor. Unsupported isolation, non-Git projects, or worktree provisioning failures prevent parallel editing and explain how to proceed serially. Verify with a temporary Git repository that simultaneous specialists cannot target the same writable path and that failures create no unowned worktree or run.

  Review note: read-only enforcement by convention alone is not acceptable; if an adapter cannot express read-only, that role/provider pair must be unavailable, per PAC-04 honesty.
- PAC-07: Review, no implicit integration. Specialist completion never marks the task verified or merges changes. For each run, show provider, role, state, outcome, changed files, checks, and blockers. User explicitly selects a reviewed result or uses the existing reviewed commit/merge workflow; failed or interrupted runs retain their history. Verify that successful exits remain ready-for-review, failed runs remain failed, and no branch changes occur without the existing explicit merge action.
- PAC-08: Context continuity. Switching task A -> B -> A and restarting Saber restores the selected task's active project, task checkpoint/draft, workspace identity, and latest specialist states. Runs from other tasks keep their original profile revision, provider identity, and workspace. Verify with two tasks and at least two roles, including an interrupted run, without starting duplicate processes.
- PAC-09: Secret and scope hygiene. Profiles and task handoffs exclude environment variable values, credentials, unrelated files, and content outside the registered project unless the user explicitly adds a source. Enforcement is a project-scoped source allowlist plus a secret-filename deny-list (environment files, keys, credential files) with no environment-value interpolation; additions outside the project require explicit user action per source. Provider auth stays with the provider CLI. Before launch, Saber previews the exact context sources that will be sent. Verify redaction/exclusion against fixture secrets in environment files and a sibling directory; show what context sources will be sent before launch.

  Review note: the current prompt path interpolates task context verbatim, so pasted secrets would flow to providers today. The preview-before-launch plus deny-list is the minimum credible mechanism; the plan must state both.

## Data and lifecycle

Project profile revisions belong to the registered project and are append-only once approved. Draft revisions can be edited or discarded. Each entry stores its content, origin type, source reference or author, and review state. The active revision pointer changes only after explicit approval. A source reference is evidence, not a live include: runs use the captured approved content, and later source changes require a reviewed revision.

Tasks remain provider-independent and runs remain provider-specific attempts. A run captures immutable task-spec and project-profile revision IDs, role ID/instructions, provider, checkpoint, and workspace path at launch. A team is a task-level grouping of independent run IDs; it does not collapse them into one run or alter existing task/run lifecycle semantics. Team launch must reserve all required isolated workspaces before starting any member; if reservation fails, no member starts. Each run owns its process, events, workspace, and outcome. Restart reconciliation follows existing interrupted-run behavior and never infers success from process disappearance.

Profile/run content stays local in Saber's existing local storage. Context is transmitted only to the provider selected for that run through its existing CLI adapter. No provider receives another run's hidden native session. Team summaries are derived from persisted run outcomes and can be regenerated; they do not replace raw run records or verification evidence.

## Verification plan

- PAC-01–PAC-02: Unit and SQLite integration tests for profile sources, revisions, approval, restart persistence, invalid sources, and stale source files.
- PAC-03–PAC-04: Adapter contract tests asserting exact immutable context snapshot per provider launch; verify unavailable capability and context-limit outcomes are explicit.
- PAC-05–PAC-06: Tests for default single run, selected team membership and four-role limit, workspace reservation atomicity, distinct write paths, read-only role enforcement, and provisioning failure cleanup.
- PAC-07–PAC-08: Lifecycle tests for ready-for-review, failed, interrupted, switch-away/switch-back, restart reconciliation, and explicit merge-only integration. Browser verification of task profile preview, role selection, team status, and per-run review details.
- PAC-09: Fixture-based checks for secret-bearing environment files, sibling directories, source preview, and context payload boundaries.
- Run the full Vitest suite, TypeScript check, production build, and `git diff --check`. Restart the app on its strict port and verify the updated panes in a browser. Native desktop checks are required where the app surface differs from browser behavior.

The implementation plan must map each step and test to PAC requirement IDs and account for Windows/Linux behavior. Live Claude Code execution is not a prerequisite when the user lacks an authenticated account; adapter contract tests and an explicit unavailable state are required instead.

## Implementation sequencing (review addition)

This is two slices, not one. The plan must sequence them and must not claim teams before the profile/single-agent receipts pass:

1. Profile and single agent (PAC-01–PAC-04, PAC-08–PAC-09 for the single-run path): project record, profile revisions and approval, immutable capture, adapter capability declarations, pre-launch preview, hygiene enforcement.
2. Specialist teams (PAC-05–PAC-07, extended PAC-06/PAC-08): roles, bounded opt-in launch, per-run worktrees, per-run review. PAC-08 continuity and PAC-09 hygiene apply to both; verify them per slice.

## Approver decisions (2026-10-06)

1. Project identity: key by canonical repository root, including the existing non-Git serialization rule and nested-checkout handling from the worktree service.
2. Profile size: per-entry and per-revision bounds match existing task-field limits (100,000 chars), plus a total run-prompt budget enforced per adapter.
3. Role model: ID, instructions, write flag, and supported-providers list are sufficient; sandbox details stay in adapters.
4. Pre-launch preview: inline expandable source list in the launch control; one click to start, details on demand.
5. Staleness: recorded source-hash stale flag only; refresh and run-outcome suggestions are explicit user actions, never automatic.

## Slice 1 completion evidence (2026-10-08)

Single-agent path only (PAC-01–PAC-04, PAC-08, PAC-09). Teams (PAC-05–PAC-07) remain a separate slice.

- PAC-01: project records keyed by canonical root with registration; allowlisted repository discovery with precise source references. Tests: `projectProfiles.test.ts` persistence/restart/source cases.
- PAC-02: draft/edit/discard/approve/refresh with pointer-only activation, immutable prior revisions, hash-based stale flag. Tests cover edit/reject flows, byte-identical history, and post-approval staleness; UI review in `ProjectProfilePanel` with component tests.
- PAC-03: runs capture profile revision ID, `default` role ID/instructions, context sources, and the exact submitted prompt; later profile edits leave prior runs untouched (two-revision/two-run test); provider change starts a fresh snapshot with no native-session transfer. Cross-provider follow-up is rejected.
- PAC-04: adapters declare a 200,000-char budget and profile-context support surfaced through readiness; oversized payloads fail before launch naming the largest source with no run created; unsupported adapters fail explicitly with omitted sources. The pre-launch preview endpoint and inline UI show exact sources, sizes, and the budget verdict; empty-profile runs proceed only with an explicit notice.
- PAC-08: restart restores tasks, approved profile, and run states; UI A-B-A restores selection with the profile following the selected task's project. No duplicate processes.
- PAC-09: source allowlist plus secret-filename deny-list enforced at draft, approval, prompt assembly, and reads; no environment-value interpolation; pre-launch source preview. Fixture tests prove `.env`/key material excluded from persistence, prompt, and preview.

Verification: full Vitest 21 files / 117 tests, `test:terminal` (2 Rust + 17 Vitest), `cargo test` 8/8, `tsc`, production build with checksum-verified sidecar staging. Headless Chromium closeout: real opencode run completed (`done`, exit 0) with captured profile revision and profile content in the submitted prompt; restart persistence and A-B-A verified in the UI.

Remaining gaps: specialist teams slice; native Tauri-window checks; authenticated Claude smoke (no account); clean-account/VM install.

## Slice 2 completion evidence (2026-10-08)

Bounded opt-in specialist teams (PAC-05–PAC-08). Slice-1 receipts reused without reopening.

- PAC-05: roles with ID, instructions, write flag, supported providers, and basis profile revision; built-in implementer (write, all providers) and reviewer (read-only, claude) seeded per project; custom role CRUD; four-member ceiling; implementer required when any member writes; no launch on task creation or without explicit confirmation. Tests cover seeding, validation, and history stability.
- PAC-06: per-member managed worktrees under `worktrees/<taskId>/runs/<runId>` with provider-neutral branches, reserved atomically before any spawn with rollback creating nothing on reservation failure; partial spawn failures stay visible as member outcomes. Adapter read-only declarations verified from installed CLIs (opencode: no flags, unsupported; claude: plan mode with Edit/Write/NotebookEdit denied; codex: unverified, unsupported); read-only members run read-only invocations on separate paths, never shared writable paths; unsupported pairs report unavailable. Overlap semantics confirmed: distinct git roots never overlap.
- PAC-07: team groups independent runs with per-member provider/role/revision identity, outcome, changed files, checks, and blockers; successful members stay ready-for-review; per-member merge reuses identical ff-only, clean-tree, reviewed-head guards directly into source with sequential merges, explicit rebase guidance on non-ff, and guarded cleanup reporting. Nothing merges or verifies implicitly.
- PAC-08: restart reconciles members as interrupted with team records intact; relaunch blocked (409, zero duplicates) while members run or are interrupted; acknowledge-then-relaunch succeeds with exactly one added run; UI A-B-A restores selection with the team following the task.

Verification: full Vitest 24 files / 139 tests, `test:terminal` (2 Rust + 17 Vitest), `cargo test` 8/8, `tsc`, production build with checksum-verified sidecar staging. Headless Chromium closeout 14/14 with two real opencode runs to `done`, plus the full interrupt-reconcile-recover cycle proven against the production server build.

Kill-mechanics note (2026-10-08, not a defect): when the server process dies, provider children die on the broken output pipe within seconds (verified: no orphans survive), so restart reconciliation to `interrupted` is honest — never falsely running or completed. Under violent kills, close handlers may record `error` instead of `interrupted`; this is cosmetic (error runs hold no locks and block nothing) and needs no fix unless it appears in normal app-close usage.

Remaining gaps: native Tauri-window checks; authenticated Claude smoke (no account); clean-account/VM install; codex read-only verification (CLI not installed).

## Design self-review

- Scope is one coherent vertical slice across project profile, immutable context capture, and opt-in bounded specialists; no cloud service or independent editor is introduced.
- Profiles are reviewed, revisioned snapshots. Repository references cannot silently pull changing or out-of-project content into an active run.
- Parallel editing is bounded to four specialists, requires explicit launch, and reserves isolated workspaces before starting any process.
- Task/run ownership, provider-native session ownership, ready-for-review semantics, and explicit merge behavior match existing approved product requirements.
- Failure cases cover unsupported context capabilities, oversized payloads, missing Git isolation, interrupted processes, and partial team provisioning.
- No placeholders remain. Design is draft pending user review; implementation planning and code are intentionally not started.
