# Saber: spec-driven agentic development

Status: Approved product direction. Delivery is incremental; requirements are not claims of shipped functionality.
Date: 2026-09-21

## Product clarification (2026-09-22)

The user clarified that Saber must be a terminal-first desktop workspace, not a dashboard for launching agents. Saber opens into interactive Windows/Linux/macOS shells where developers can type commands such as `herdr`, `opencode`, `codex`, and other tools directly. Task switching, context checkpoints, provider adapters, verification, and the task board support this terminal workflow. They do not replace it. The terminal-first specification and roadmap supersede the dashboard-first presentation described below wherever they differ.

The proposed implementation direction is a native Tauri PTY service with an xterm.js terminal surface. This keeps interactive process ownership in the desktop runtime, while the task/workspace model supplies the initial directory and context. The first feature spec will define session ownership, process lifetime, and coordination with existing provider runs before implementation.

## Container boundary (approved 2026-09-23)

Keep Saber itself local-first. Do not add Docker containers for Saber-owned UI, API, or task storage unless a concrete requirement demonstrates a benefit; containerization alone is not a performance optimization. The current desktop app can keep its local Tauri process, local server, and SQLite task store.

User project environments are user-owned. A developer may install and configure Docker or another runtime and invoke it through Saber’s ordinary terminal. Saber does not provision, build, start, stop, or remove project containers on the user's behalf. A future feature may offer user-triggered environment detection, preflight checks, or setup guidance, but it must not assume or silently create an environment and requires its own spec.

## Product purpose

Saber is a local workspace for agentic engineering. It helps a developer define work, execute it through OpenCode, Codex, or Claude Code, supervise multiple tasks, and verify results without repeatedly reconstructing context.

Saber is the production name. Mstudio is the maker; mstudio-ade remains the repository directory name.

Two commitments guide development:

1. Develop Saber from versioned specifications with explicit acceptance criteria and verification evidence.
2. Make that same workflow available inside Saber for projects managed by its users.

## Current foundation

The inspected working tree contains a Bun/TanStack Start application, Tailwind v4, and a Tauri v2 shell. It has an OpenCode provider, session selection, dev-server controls, and a browser pane. The provider registry currently registers only OpenCode. Session records use an in-memory Map and include an OpenCode-specific session identifier.

Existing uncommitted application changes were present during this assessment. This draft does not establish that those changes have been validated.

## Approach

Recommended: incrementally introduce persistent tasks and context above the current provider layer. Reuse the existing application and verification surfaces, then expand provider support.

Alternatives considered:

- Add all providers first: delivers tool choice sooner, but leaves context and task persistence fragmented.
- Rebuild as a full editor: offers deeper editing control, but greatly expands scope before proving the core workflow.

## Development contract

Every behavior change starts with a versioned feature spec. Small fixes may use a short spec; larger features need separate bounded specs. A spec contains the problem, user workflow, scope, exclusions, requirements with stable IDs, acceptance criteria, dependencies, failure cases, and verification method.

The workflow is spec -> review -> implementation plan -> implementation -> verification -> completion. Explicit user authorization may approve a spec without an additional ritual. An agent must surface material scope changes and update the spec before implementing them.

Plans map implementation steps to requirement IDs. Completion records map those same IDs to test results, browser checks, or other appropriate evidence. A successful agent process exit is evidence of execution, not proof that the task meets its acceptance criteria.

Specs and plans live in the repository. Historical plans remain historical; this direction becomes authoritative only after review. An approved follow-up should link the development contract from AGENTS.md and README.md so all coding agents discover it.

## Core concepts

- Project: repository identity, project instructions, and development commands.
- Spec: versioned intent, scope, requirements, and acceptance criteria.
- Task: a persistent unit of work linked to a specific spec revision.
- Run: one provider execution attempt belonging to a task. A task may have several runs.
- Workspace: the checkout or isolated worktree where a task executes.
- Context checkpoint: goal, decisions, relevant files, latest outcome, blockers, and next action, with source references and timestamps.
- Verification record: criterion, command or check, outcome, time, and relevant revision.

Task and run identities are provider-independent. Provider-native session IDs belong to runs and remain namespaced by provider.

## Requirements

### SDD-01: Specifications govern work

A task links to its spec revision and acceptance criteria. Runs capture that revision at launch. Editing a spec does not silently change the scope of an active run. Changed requirements invalidate affected completion evidence until rechecked.

Acceptance: a completed task exposes its original scope, implemented revision, and evidence for each criterion. Missing or failed criteria prevent a verified completion state.

### CTX-01: Tasks survive context switches

Persist task metadata, run history, checkpoints, and workspace references. Restore task selection, draft input, and associated preview state when returning to a task. Show the latest outcome, blocker, and next action without requiring the user to reread the full transcript.

Acceptance: switching A -> B -> A restores A's draft and context without restarting either run. Restarting Saber restores task records. Previously running processes are reconciled; unverifiable processes appear interrupted, never falsely running or completed.

### AGT-01: Providers share a capability contract

Support OpenCode, Codex, and Claude Code through adapters that report installation/authentication readiness and supported capabilities. Common operations include launching, observing output, cancelling, and reporting outcome. Native continuation is offered only when verified for that provider/version.

Normalize lifecycle events while retaining raw provider output for diagnosis. Represent missing capabilities explicitly. Discover and verify each installed CLI's interface during its adapter implementation; this spec assumes no particular Codex or Claude Code command flags.

Acceptance: each adapter passes lifecycle contract checks for launch, streamed output, failure, cancellation, and cleanup. Missing tools produce actionable setup states. Switching providers creates a new run with an explicit context handoff; it does not claim to transfer hidden model state or native sessions.

### MULTI-01: Parallel work remains understandable

Provide an overview of queued, running, waiting-for-input, interrupted, failed, ready-for-review, and verified tasks. Distinguish task state from process state. Notify on meaningful transitions and deduplicate repeated notices.

Use isolated worktrees by default for concurrent editing tasks in a Git repository. Serialize editing tasks that share a writable checkout. For non-Git projects, serialize writes until a separately specified isolation mechanism exists. Scope previews and development processes to their owning workspace.

Acceptance: two tasks in one repository can execute in distinct worktrees without writing into one another's checkout. Selecting one task cannot redirect another's run or preview. A task awaiting input is visible without inspecting every transcript.

### PERF-01: Responsiveness is measured

Set configurable concurrency limits and queue excess runs. Bound retained output in memory, persist history separately, and load older output on demand. Use stable event sequence IDs so reconnects and buffer truncation do not silently skip output. Surface any unrecoverable gaps.

Proposed initial budgets: task selection to restored local content p95 <= 200 ms; server-received event to visible output p95 <= 500 ms, with 10 saved tasks and 3 active simulated streams at 20 events/second each. Provider generation and network latency are excluded. Record reference hardware and measurement procedure with the implementing spec.

Acceptance: repeatable measurements meet these budgets and memory retention plateaus under sustained output. These are targets, not claims about current performance.

### VERIFY-01: Results remain inspectable

Attach changed files, checks, browser evidence where relevant, and a concise outcome to the task. Failed verification preserves the run and explains the remaining work. Retrying creates a new attempt without erasing history.

Acceptance: the developer can trace a claimed result to its criterion and evidence. Browser evidence identifies the workspace and revision checked. Verification never silently merges or publishes changes.

## Delivery sequence

1. Adopt the development contract: approve this direction, link it from repository guidance, and introduce a reusable feature-spec template.
2. Persistent tasks and checkpoints: specify storage, restart reconciliation, task/run separation, and restoration; prove the workflow with OpenCode.
3. Provider adapters: specify the shared lifecycle contract; add and validate Codex and Claude Code independently.
4. Concurrent workspaces: add worktree ownership, write exclusion, queue limits, task attention states, and scoped previews.
5. Verification and optimization: link evidence to criteria, measure switching and streaming, and optimize demonstrated bottlenecks.

Each stage requires its own approved feature spec and bounded implementation plan. Complete one usable vertical slice before expanding the next stage.

## First implementation slice

Create a persistent task from a short spec, launch OpenCode, switch to another task, return with the draft and checkpoint restored, and restart Saber without losing either task's history. Handle interrupted execution explicitly. This validates the primary context-switching problem before adding more providers.

## Boundaries

The initial scope excludes a full code editor, autonomous agent swarms, cloud execution, team collaboration, billing, automatic merging, and automatic deployment. Provider credentials remain under their existing authentication mechanisms; checkpoints must not copy secrets or unrelated project context.

Storage technology, detailed pane design, provider commands, and worktree lifecycle policies belong in their feature specs. The current Bun, TanStack Start, Tailwind, Tauri, and port 8082 constraints remain in force.
