# Terminal-first Saber workspace

## Status and authorization

Approved direction from the user's 2026-09-22 correction: Saber is a terminal-first app where people type commands for Herdr, OpenCode, Codex, Claude Code, and other tools. This spec defines the first bounded desktop implementation slice. Delivery is incremental; these requirements are not claims of shipped behavior.

## Problem and user workflow

Saber currently opens into a task dashboard. Its terminal-like activity is hidden behind task details and provider-run buttons, so a developer cannot treat Saber as their everyday command-line workspace. The user wants an interactive OS shell where they choose what to run, with Saber preserving task context and making task switching quick.

The target workflow is: open a task/workspace in Saber, start its native shell, type any command normally, switch to another task without killing or mixing the first task's shell, then return to the live shell and its saved task context.

## Scope and exclusions

This slice makes the primary desktop surface a task/workspace terminal. Use a native Tauri PTY service and xterm.js presentation; use the OS user's normal shell, with an explicit shell choice available when discovery fails. Each terminal is associated with one task and starts in that task's effective working directory: its managed worktree when present and valid, otherwise its source project path.

Keep the task list and approved Kanban board as secondary task-switching/overview surfaces. Keep provider adapters available as optional structured run controls. Terminal sessions are separate from provider runs and never mark a task done, failed, or verified. Show the saved checkpoint and next action alongside the active terminal, with an explicit copy action; never inject context or commands into the shell without a user action.

Do not add terminal multiplexing/splits, SSH, remote/cloud shells, a new database, shell command recording/replay, automatic agent launch, automatic context injection, or automatic task-state changes from arbitrary shell output. Browser-only mode cannot open an OS process; it must show a clear desktop-runtime-required state. App exit ends Saber-owned shell processes. Returning to another task while Saber stays open does not end them. After restart, a previously active terminal is shown as interrupted and is never silently relaunched.

Concurrent writable sessions must respect workspace ownership: one active terminal or provider run per overlapping checkout/worktree. Starting a terminal or provider run for an already occupied working directory fails with a clear explanation; separate task worktrees may run in parallel. Active terminal locks are acquired and released through the existing task service, not only the frontend. An interrupted owner keeps the existing conservative recovery rule until the old process is confirmed stopped.

## Requirements and acceptance criteria

- TFW-01: Opening the desktop app presents terminal-first navigation and a terminal as the primary task surface. The task list/board remains reachable as secondary views. If no task is selected, Saber provides a visible path to select/create a task before starting a shell. Verify in the Tauri app at desktop size.
- TFW-02: Starting a terminal for a task opens the host OS shell in that task's effective working directory. Windows uses the discovered user shell, preferring PowerShell 7 and falling back to Windows PowerShell; Linux/macOS uses `$SHELL` when valid and otherwise `/bin/sh`. Missing executables produce an actionable error without creating a phantom session. Verify working directory and startup failure paths on available hosts; report untested platforms.
- TFW-03: The terminal supports typed input, streamed output, ANSI/VT rendering, interactive full-screen tools, paste, and resize. A shell command can print a unique marker and return to a prompt; an interactive test such as `herdr` may be used when installed. Verify PTY lifecycle at the backend and actual rendering/interactivity in Tauri.
- TFW-04: Switching tasks preserves each live PTY process, scrollback, active terminal selection, task draft, and saved checkpoint. Returning to a task restores its shell without starting a duplicate process. Verify A -> B -> A with distinguishable working directories and markers.
- TFW-05: Terminal sessions and agent runs remain distinct. Starting either is rejected while an overlapping writable session owns the effective directory; separate managed worktrees can run simultaneously. Releasing a terminal lock only happens after its process has exited or been explicitly stopped and reaped. Verify competing launches in both directions and worktree independence.
- TFW-06: The task context pane shows saved checkpoint and next action and offers explicit copy. It does not write to the terminal automatically. Verify copying and confirm a task switch never types or executes content.
- TFW-07: Browser-only mode explains that native terminals require the Saber desktop app and never exposes a network endpoint that can spawn arbitrary local shells. Verify at `http://localhost:8082/` and inspect the configured Tauri permissions.
- TFW-08: Closing Saber terminates its owned terminal process trees. If a terminal cannot be confirmed stopped after an abnormal restart, show it as interrupted and keep the checkout locked pending explicit recovery. Never silently relaunch it. Verify normal close and restart reconciliation.

## Data and lifecycle

Tasks and provider runs retain their current identities and persistence. A terminal session is a separate task-owned process with a session ID and a captured effective directory that does not change if task metadata changes later. The PTY itself is owned by the desktop runtime; the existing task service owns the active workspace lock so agent-run creation and terminal creation use the same exclusion boundary. M1 locks live for the server process lifetime. M2 adds persistent terminal records, restart reconciliation, and explicit recovery of interrupted sessions. Do not persist keystrokes or shell commands. On normal desktop exit, terminate owned PTYs and release locks only after process termination is confirmed.

Create one session per task for the initial slice. If two tasks resolve to overlapping directories, they contend for the same write lock. Selection changes only the visible terminal and context; it does not change another session's directory or owner. The native bridge is available only to the Tauri app. Web preview uses a non-spawning explanatory state.

## Verification plan

- TFW-01: launch the desktop app and inspect that the terminal is primary while list/board can be reached.
- TFW-02: PTY integration tests assert actual shell startup directory and missing-shell diagnostics.
- TFW-03: PTY integration tests assert input/output/exit/resize; Tauri app browser inspection verifies VT rendering and interactive input.
- TFW-04: Tauri browser flow switches task A -> task B -> task A and checks each process and scrollback remain distinct.
- TFW-05: backend tests cover terminal-terminal, terminal-agent, agent-terminal conflicts, stopped-session release, interrupted-session retention, and separate worktrees.
- TFW-06: Tauri browser flow explicitly copies context and confirms it appears in clipboard only; session switch alone does not send input.
- TFW-07: browser-only smoke and Tauri capability review.
- TFW-08: PTY process-tree shutdown and restart recovery checks.

Run focused Rust and Vitest checks first, then TypeScript and production build. Restart development on strict port 8082 and inspect both the browser fallback and the Tauri terminal pane. Record actual platform and shell coverage in completion evidence. Authenticated Claude Code testing remains skipped by prior user request.

## Incremental delivery map

- M1 (first receipt): TFW-01, TFW-02, TFW-03, TFW-05, and TFW-07. Ship the primary desktop PTY surface, same-workspace run exclusion, and truthful browser fallback for one selected task.
- M2 (replan after M1): TFW-04, TFW-06, and TFW-08. Add persistent task-owned sessions, context handoff, and restart/exit recovery.

## Completion evidence

M1 and M2 are complete on Windows. See `docs/superpowers/specs/2026-09-22-terminal-first-workspace-verification.md` for requirement-level evidence. Linux/macOS are untested, and the authenticated Claude Code live test remains skipped per the user's request.
