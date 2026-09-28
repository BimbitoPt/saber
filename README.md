# SABER — by Mstudio

Saber is a terminal-first workspace for agentic engineering. Open a task's shell,
type commands for Herdr, OpenCode, Codex, Claude Code, or any other local tool, and
switch tasks while keeping each task's specification and handoff close at hand.
The desktop app provides the native PTY; browser preview cannot start local shells.
Agent adapters, task verification, the task board, dev servers, and browser tools
support the terminal workflow instead of replacing it.

Previously named "mstudio-ade" / "MSTUDIO ADE". The repo dir keeps the old
path for stability; the product name is Saber.

## Layers

- **Saber app** (this repo): Tauri shell + Bun/TanStack Start server on
  port 8082. Owns agent lifecycle (pluggable `src/server/providers/`),
  dev-server registry, and the embedded headless browser.
- **Mstudio profile** (`Desktop\mstudio-os`): the portable settings layer.
  Saber reads `projects.json` live for the project inventory and links
  the global AGENTS.md + skills into your harness.
  See mstudio-os/docs/USAGE.md for how the profile installs.

The current endpoint inventory, proposed versioned local API contract, module boundaries,
stack, and Codex readiness are documented in
[Saber API and platform architecture](docs/architecture/saber-api-and-platform.md).

## Run

```powershell
bun run dev        # web UI on http://localhost:8082
cargo run          # from /src-tauri: full product window
```

The terminal is the primary workspace. Task and run records stay separate; a shell
session is not an agent run and never marks a task complete or verified.

## Spec-driven development

The [product direction](docs/superpowers/specs/2026-09-21-saber-product-direction.md)
defines the roadmap. Every behavior change begins with a feature spec and
acceptance criteria, followed by an implementation plan and verification evidence.

The first slice adds persistent tasks, specification revisions, context checkpoints,
follow-up drafts, and separate provider runs. Create a task before launching its
specification. Save changes to persist context; unsaved edits also have a local
browser recovery copy. Successful runs are ready for review, not automatically verified.

SQLite data lives at `%USERPROFILE%\.saber\tasks.sqlite`. Set `SABER_DATA_DIR` to
use another directory. Use one Saber server per data directory. Node 24 is the
validated server runtime; Bun remains the package manager. The database contains
task text and agent output, so treat it as private project data.

After a server restart, unfinished runs appear interrupted. Check and stop the old
process before confirming it has stopped in Saber. This confirmation releases the
workspace; it does not terminate an orphan process. Concurrent runs in the same
checkout are blocked. Dev-server and browser panes are currently shared.

Choose a provider in each task. Saber checks installation and authentication,
preserves raw output, and resumes native sessions only within the same task and
provider. Changing providers sends the saved specification and checkpoint; native
conversation history stays with its original provider.

Git tasks can create a dedicated branch and worktree from the checkout's committed
HEAD. Existing checkout changes stay in place and are not copied. Runs in separate
task worktrees can proceed in parallel. Review changes before a fast-forward merge;
Saber refuses dirty source checkouts and stale reviews. Removing a workspace keeps
its branch and refuses any local, untracked, or ignored files.

Acceptance criteria can use one stable ID per line (`AC-01: expected result`). Saber
records explicit pass/fail evidence per criterion and spec revision. A successful
agent run remains ready for review; only current passing evidence for every criterion
marks the task Verified. Saber records what you checked but does not run checks or
infer outcomes for you.

The terminal-first direction and delivery sequence are recorded in
[the terminal-first roadmap](docs/roadmaps/2026-09-22-terminal-first-saber.md) and
[its feature spec](docs/superpowers/specs/2026-09-22-terminal-first-workspace.md).

The task list includes attention-state counts and filters for running, interrupted,
failed, review-ready, verified, stopped, and draft tasks. Counts reflect the full
task list; filtering never clears the selected task or its context.

Switch between List and Board in the task workspace. The board groups drafts under
To do, active runs under Running, completed runs under Ready for review, fully
verified tasks under Done, and failed/interrupted/stopped tasks under Needs attention.
Cards follow the real run and verification state; open a card to use the existing
task controls. Board and list share task selection and persisted state.

Install the provider's native CLI and authenticate externally (`codex login` or
`claude auth login`), then refresh providers. On Windows, discovery requires a
native executable; an installation exposing only a `.cmd` or `.ps1` shim is not
supported. Codex uses workspace-write with noninteractive approval refusal;
Claude uses its configured permissions. Saber does not bypass approval or sandbox
settings and does not provide an interactive permission prompt bridge.

The [adapter verification](docs/superpowers/specs/2026-09-22-provider-adapters-verification.md)
records live Codex launch and continuation, automated coverage, and the pending
authenticated Claude smoke test.

Sessions from before persistence was introduced cannot be recovered from an earlier
server's memory. Queuing and waiting-for-input attention states are not yet exposed.
