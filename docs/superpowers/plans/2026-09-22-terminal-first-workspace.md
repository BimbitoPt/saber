# Terminal-First Workspace Implementation Plan

> **Status:** M1 complete on Windows. Step evidence is recorded in `docs/superpowers/specs/2026-09-22-terminal-first-workspace-verification.md`. M2 work is tracked separately in `docs/superpowers/plans/2026-09-23-terminal-session-context-switching.md`.

**Goal:** Make Saber a desktop-first app with a usable native shell in the primary task workspace.

**Architecture:** The Tauri Rust process owns a native PTY session and exposes narrow start/write/resize/close commands to the frontend. xterm.js renders the PTY stream. The frontend resolves the selected task's effective directory and provides a clear browser-only fallback; no HTTP or WebSocket endpoint can spawn a shell. Provider conflict locks shipped in M1; task-owned live-session restoration and restart recovery remain M2.

**Tech Stack:** Tauri v2, Rust, portable-pty, Bun, React, xterm.js, Vitest.

## Global Constraints

- Use Bun as the JavaScript package manager.
- Run the web dev server on port 8082 with `--strictPort`.
- Do not edit generated `src/routeTree.gen.*` or `src-tauri/gen/**` files.
- Add no comments or emojis.
- Preserve task/run separation, immutable run scope, and effective workspace ownership.
- Do not expose shell spawning over HTTP/WebSocket.
- Do not auto-type or execute commands, provider prompts, or checkpoints.
- Do not claim untested operating systems or shells as supported.
- M1 stops before task-switch persistence; provider conflict locks are part of M1. Replan before M2.

---

### Task 1: Add and test the native PTY session core — TFW-02, TFW-03

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/build.rs`
- Modify: `src-tauri/src/main.rs`
- Create: `src-tauri/src/terminal.rs`

**Interfaces:**
- `TerminalSessions::start(app, session_id, cwd, cols, rows) -> Result<(), String>` selects the supported OS shell, starts it in `cwd`, retains its PTY master/writer/child, and streams output as `terminal-output:{session_id}` events.
- `TerminalSessions::write(session_id, data) -> Result<(), String>` writes bytes to that session only.
- `TerminalSessions::resize(session_id, cols, rows) -> Result<(), String>` resizes only that PTY.
- `TerminalSessions::close(session_id) -> Result<(), String>` terminates and reaps its shell; closing a missing/ended session returns a useful error.
- `TerminalSessions::close_all()` is called during normal Tauri exit and terminates all sessions owned by Saber.
- Windows shell discovery prefers `pwsh.exe`, then `powershell.exe`; Unix discovery uses a valid `$SHELL`, then `/bin/sh`.

- [x] **Step 1: Add a PTY round-trip integration test**

Create a test that opens a PTY in a temporary directory, launches the discovered shell with a harmless one-shot marker command, reads until the marker or a five-second deadline, asserts the marker and exit status, and closes the session. Use PowerShell `Write-Output SABER_TERM_OK` on Windows and `/bin/sh -c 'printf SABER_TERM_OK'` on Unix. The test must also assert the process starts in the requested working directory and that an invalid shell returns an actionable error.

- [x] **Step 2: Run the focused test and confirm it fails before implementation**

Run: `cargo test --manifest-path src-tauri/Cargo.toml terminal_session -- --nocapture`
Expected: FAIL because the terminal session module/API does not exist.

- [x] **Step 3: Add the cross-platform PTY dependency and session manager**

Add `portable-pty = "0.9"`. Implement a mutex-protected map keyed by session ID. Store the master for resize, a cloned writer for input, and the child handle for exit/termination. A reader thread emits raw UTF-8-lossy PTY chunks with the session ID and emits one ended event after EOF. Validate non-empty session IDs, positive dimensions, and an existing working directory before starting a process. Convert backend errors to actionable strings. Never accept a command or shell arguments from the UI; the backend chooses the shell and starts it interactively.

- [x] **Step 4: Register Tauri commands and process cleanup**

Manage one `TerminalSessions` state in `main.rs`. Register typed start/write/resize/close commands with Tauri. In `build.rs`, expose only those four custom commands through `AppManifest` so the existing localhost Tauri webview can call the shell API. Pass the Tauri app handle only to the reader event stream. On normal `RunEvent::Exit`, close all terminal children before finishing existing dev-server cleanup.

- [x] **Step 5: Run the focused Rust test and check the desktop crate**

Run: `cargo test --manifest-path src-tauri/Cargo.toml terminal_session -- --nocapture`
Expected: PTY marker and lifecycle tests pass on the current host.

---

### Task 2: Lock workspaces between terminals and provider runs — TFW-05

**Files:**
- Create: `src/server/terminalLocks.ts`
- Create: `src/server/terminalLocks.test.ts`
- Modify: `src/server/agentRuns.ts`
- Modify: `src/server/agentRuns.test.ts`
- Modify: `src/server.ts`
- Modify: `src/lib/api.ts`
- Modify: `src/components/TerminalSurface.tsx`

**Interfaces:**
- `TerminalLocks.reserve(store, taskId, workdir)` returns a random lock `{ id, taskId, workdir, createdAt }` or rejects overlap with an active/interrupted run or terminal.
- `TerminalLocks.release(id)` releases exactly one lock after PTY close succeeds.
- `TerminalLocks.hasActiveWorkspace(workdir)` is checked by `AgentRuns.start` before spawning.
- `POST /api/tasks/:id/terminals` derives the effective path with `taskWorkdir` and reserves it; `DELETE /api/terminals/:id` releases the lock.
- The frontend acquires the server lock before invoking native `terminal_start`, then closes the PTY before releasing its lock.

- [x] **Step 1: Add lock tests for overlap, release, and agent exclusion**

Use an in-memory `TaskStore` and isolated `TerminalLocks` instance. Verify two tasks with the same project cannot own two terminals, a separate project can, release permits a later acquisition, a running or interrupted run blocks a terminal, and an agent run is rejected while a lock overlaps its effective work directory.

- [x] **Step 2: Run the focused lock tests and confirm they fail**

Run: `bun run test -- src/server/terminalLocks.test.ts src/server/agentRuns.test.ts`
Expected: FAIL because no terminal lock service or agent guard exists.

- [x] **Step 3: Implement one server-owned lock registry**

Use `workspacesOverlap` for comparisons, keep the registry scoped to the task server runtime, and generate lock IDs with `crypto.randomUUID()`. Reserve synchronously so a second launch cannot pass between conflict check and insertion. `AgentRuns.start` must check this registry before generating or spawning a provider process.

- [x] **Step 4: Add task terminal lock APIs and wire lock lifetime to the PTY**

The POST route verifies the task exists, calls `taskWorkdir(task)`, and reserves against persisted running/interrupted provider runs. The DELETE route releases only the exact opaque lock ID. The frontend requests a lock first, uses the returned ID and directory for the native PTY, closes/reaps the PTY on shell exit or UI teardown, then releases that same lock. On start failure, release the reservation.

- [x] **Step 5: Run focused lock and agent lifecycle tests**

Run: `bun run test -- src/server/terminalLocks.test.ts src/server/agentRuns.test.ts`
Expected: all lock, blocking, and existing agent lifecycle tests pass.

---

### Task 3: Render and control the terminal — TFW-03, TFW-07

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`
- Create: `src/components/TerminalSurface.tsx`
- Create: `src/lib/terminalRuntime.ts`
- Create: `src/lib/terminalRuntime.test.ts`
- Modify: `src-tauri/capabilities/default.json` only if a Tauri command permission is required by the selected API.

**Interfaces:**
- `TerminalSurface` receives `{ sessionId, workingDirectory, active }` and owns one xterm instance and fit addon.
- It calls native `terminal_start`, `terminal_write`, `terminal_resize`, and `terminal_close` commands through `@tauri-apps/api/core` and subscribes to `terminal-output:{sessionId}` through `@tauri-apps/api/event`.
- The backend command names and payload fields match the Rust signatures from Task 1 exactly.

- [x] **Step 1: Install stable xterm packages using Bun**

Run: `bun add @xterm/xterm @xterm/addon-fit`
Expected: `package.json` and `bun.lock` contain both dependencies.

- [x] **Step 2: Add and test the desktop-runtime boundary**

Export a pure `isTerminalRuntimeAvailable(runtime)` helper that returns true only when Tauri's `__TAURI_INTERNALS__` bridge exists. Test both a browser-like object and a desktop-like object. Use this gate before creating xterm or invoking any native command.

- [x] **Step 3: Add the terminal component**

Instantiate xterm once per active session, import the official xterm stylesheet, fit to its container, send input and dimensions through Tauri commands, and dispose listeners/observers when unmounted. Render a bounded, visible startup/error state when Tauri APIs are unavailable. Do not provide a shell-spawning browser fallback.

- [x] **Step 4: Run type checking and production build**

Run: `node node_modules/typescript/bin/tsc --noEmit --pretty false`
Expected: exit code 0.

Run: `bun run build`
Expected: exit code 0.

---

### Task 4: Make the terminal the primary task surface — TFW-01, TFW-07

**Files:**
- Modify: `src/components/TaskWorkspace.tsx`
- Modify: `src/routes/index.tsx`
- Modify: `src/lib/terminalRuntime.test.ts`

**Interfaces:**
- The existing task list remains the authoritative task selector and selection persistence remains `saber.selectedTask`.
- The selected task's effective directory is its ready managed workspace path or, when it has no managed workspace, its project path.
- Board/List and agent controls stay reachable as secondary views; the primary default is the terminal workspace.
- No generated route tree is edited.

- [x] **Step 1: Write a focused test for terminal runtime detection**

Cover a browser-like object without the Tauri bridge and a desktop-like object with the bridge.

- [x] **Step 2: Run the focused frontend test and confirm it fails**

Run: `bun run test -- src/lib/terminalRuntime.test.ts`
Expected: FAIL before runtime detection exists.

- [x] **Step 3: Put the terminal in the primary workspace and preserve secondary task views**

Keep the current task list and selected task. Add a Terminal primary view and make List and Board secondary views. In Terminal view, replace the main selected-task detail surface with the native terminal and keep existing task/spec creation and controls reachable from secondary views. If there are no tasks, keep task creation available and explain that a task/workspace must be selected before the shell starts. When task selection changes in M1, close the old session before starting another; live-session restoration is M2. Do not relabel a provider run as a terminal session.

- [x] **Step 4: Run focused frontend checks**

Run: `bun run test -- src/lib/terminalRuntime.test.ts`
Expected: all terminal surface tests pass.

---

### Task 5: Verify the M1 desktop experience — TFW-01, TFW-02, TFW-03, TFW-05, TFW-07

**Files:**
- Update: `docs/superpowers/specs/2026-09-22-terminal-first-workspace.md`
- Create: `docs/superpowers/specs/2026-09-22-terminal-first-workspace-verification.md`

- [x] **Step 1: Run the focused Rust receipt**

Run: `cargo test --manifest-path src-tauri/Cargo.toml terminal_session -- --nocapture`
Expected: terminal round-trip, working directory, invalid shell, resize, and clean close checks pass on the current host.

- [x] **Step 2: Run Vitest, TypeScript, and production build**

Run: `bun run test -- --maxWorkers=1 --reporter=dot`
Expected: all existing and new tests pass.

Run: `node node_modules/typescript/bin/tsc --noEmit --pretty false`
Expected: exit code 0.

Run: `bun run build`
Expected: exit code 0.

- [x] **Step 3: Restart the strict-port server and inspect the web fallback**

Run: `bun run dev -- --port 8082 --strictPort`
Expected: Saber loads at `http://localhost:8082/`, identifies that native terminals require the desktop runtime, and never sends a shell-spawn request.

- [x] **Step 4: Launch Tauri and verify interactive rendering**

Run from `src-tauri`: `cargo run`
Expected: terminal is the main selected-task workspace; run a harmless marker command, verify VT output/input and resize, then close Saber and verify the shell process exits. Record current-host shell/OS evidence and any untested platform limits. Replan before M2.
