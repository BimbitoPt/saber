# Project-aware agent context and specialist teams

## Status and authorization

Design approved by the user on 2026-09-28. Written specification is draft pending user review. This document authorizes requirements definition only; implementation requires review of this written spec and a separate implementation plan.

## Problem and user workflow

A solo developer moves between several agent-driven projects and coding tools. Today, each tool session can require the developer to restate a project's architecture, conventions, commands, constraints, decisions, and task state. Generic agent roles also lack project-specific working knowledge. Saber should preserve that knowledge with the project and attach a stable snapshot to each task run, so returning to work does not depend on one provider's hidden session.

The developer registers or opens a project, reviews a source-linked project profile, and saves an approved revision. They create or resume a task with a spec and checkpoint. Saber supplies the task's captured profile revision to a selected provider run. One agent is the default. When requested, the developer can start a small project-configured specialist team in parallel. Each specialist works in its own task worktree; Saber presents outcomes and diffs for human review without merging automatically. Switching away and back restores the task, workspace, task state, and latest outcomes while provider-native sessions remain provider-owned.

## Scope and exclusions

This slice defines and implements the first project-aware context workflow over the existing task, run, provider, and isolated-workspace foundations.

Included:

- A durable project knowledge profile with revision history and references to the repository files or user decisions that support each entry.
- A review/edit step before a profile revision becomes active. Repository-derived facts must identify their source; user-entered decisions are identified as user-authored.
- An immutable profile revision captured by every new run, alongside the existing immutable task spec revision and checkpoint input.
- A project-level set of specialist role instructions, based on the approved profile. The user chooses the provider for each run from supported installed providers.
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
- PAC-03: Immutable run context. Launching any provider run captures the task spec revision, active profile revision, role instructions, and checkpoint used for that run. Later edits do not mutate prior run inputs. A provider change creates a new run with an explicit context handoff and does not claim hidden model state was transferred. Verify with two runs for one task using different profile revisions and providers, then inspect stored inputs and run history.
- PAC-04: Low-friction single-agent path. A developer can launch the default single project-aware agent without configuring a specialist team. The run receives the project profile snapshot and task context through the provider adapter's supported interface. Missing/oversized context or unsupported provider capability must produce an actionable error or explicit omitted-context notice; it must never silently imply context was delivered. Verify supported and unsupported adapter paths and resulting run metadata.
- PAC-05: Explicit specialist team. A user may opt into a project-configured team for one task and select available role/provider combinations. The team is bounded to at most four specialists, with a project-aware implementer role required when any member edits files. No team launches on task creation or without explicit confirmation of the chosen roles. Verify default launch creates one run and opt-in team launch creates only the selected number of runs.
- PAC-06: Concurrent write isolation. Every simultaneously editing specialist run uses a distinct managed worktree for the same task and captures that worktree immutably. Read-only roles may share a read-only source snapshot but cannot write. Unsupported isolation, non-Git projects, or worktree provisioning failures prevent parallel editing and explain how to proceed serially. Verify with a temporary Git repository that simultaneous specialists cannot target the same writable path and that failures create no unowned worktree or run.
- PAC-07: Review, no implicit integration. Specialist completion never marks the task verified or merges changes. For each run, show provider, role, state, outcome, changed files, checks, and blockers. User explicitly selects a reviewed result or uses the existing reviewed commit/merge workflow; failed or interrupted runs retain their history. Verify that successful exits remain ready-for-review, failed runs remain failed, and no branch changes occur without the existing explicit merge action.
- PAC-08: Context continuity. Switching task A -> B -> A and restarting Saber restores the selected task's active project, task checkpoint/draft, workspace identity, and latest specialist states. Runs from other tasks keep their original profile revision, provider identity, and workspace. Verify with two tasks and at least two roles, including an interrupted run, without starting duplicate processes.
- PAC-09: Secret and scope hygiene. Profiles and task handoffs exclude environment variable values, credentials, unrelated files, and content outside the registered project unless the user explicitly adds a source. Provider auth stays with the provider CLI. Verify redaction/exclusion against fixture secrets in environment files and a sibling directory; show what context sources will be sent before launch.

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

## Design self-review

- Scope is one coherent vertical slice across project profile, immutable context capture, and opt-in bounded specialists; no cloud service or independent editor is introduced.
- Profiles are reviewed, revisioned snapshots. Repository references cannot silently pull changing or out-of-project content into an active run.
- Parallel editing is bounded to four specialists, requires explicit launch, and reserves isolated workspaces before starting any process.
- Task/run ownership, provider-native session ownership, ready-for-review semantics, and explicit merge behavior match existing approved product requirements.
- Failure cases cover unsupported context capabilities, oversized payloads, missing Git isolation, interrupted processes, and partial team provisioning.
- No placeholders remain. Design is draft pending user review; implementation planning and code are intentionally not started.
