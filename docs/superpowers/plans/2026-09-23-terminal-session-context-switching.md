# Terminal session context switching implementation plan

**Status:** Complete on Windows, 2026-09-23. Requirement-level results are recorded in `docs/superpowers/specs/2026-09-22-terminal-first-workspace-verification.md`.

**Goal:** Preserve each task's live terminal while switching tasks, make saved task context easy to copy without sending it, and recover conservatively after Saber restarts.

**Architecture:** The Tauri process remains the only owner of PTYs. Keep each opened task's `TerminalSurface` mounted while Saber is open; task selection changes visibility and active focus, not PTY ownership. Persist terminal-session metadata in the existing SQLite task store. On WebView startup, reconcile persisted session IDs against the current Tauri process's live session list; absent previously-live sessions become interrupted and keep their workspace locked until the user explicitly confirms recovery. Never replay a command or relaunch a shell automatically.

**Tech stack:** Bun, TanStack Start, React, Tauri v2, `portable-pty`, xterm.js, existing `TaskStore` SQLite database and Vitest.

## Constraints

- Preserve the M1 terminal shell, browser fallback, command permission boundary, and task/run separation.
- Do not edit generated `src/routeTree.gen.*` or `src-tauri/gen/**` files.
- Keep one live terminal per task and serialize all writers to overlapping effective directories.
- Capture the effective directory when a terminal starts; task metadata changes do not mutate the existing PTY scope.
- Do not store keystrokes or shell command history.
- Do not auto-inject checkpoint text, draft text, or commands into xterm.
- A UI reload or task switch must not start a duplicate shell for a Tauri session already in memory.
- A previous session missing from the new Tauri process is interrupted, not stopped; only an explicit recovery action releases its workspace lock.
- Keep current testing Windows-specific and report Linux/macOS as untested.

## Task 1: Persist terminal session metadata — TFW-08

**Status:** Complete. Existing task data and terminal-session records persist through SQLite; focused task-store tests passed.

**Files:** `src/lib/tasks.ts`, `src/server/taskStore.ts`, `src/server/taskStore.test.ts`.

Add a `TerminalSessionRecord` with opaque ID, task ID, immutable workdir, state (`starting`, `running`, `interrupted`, `stopped`), and timestamps. Add a SQLite table in the existing task database, plus methods to create, list, transition, and explicitly recover sessions. Startup must not blindly mark every running terminal interrupted: the Vite/task server may restart independently of Saber. Keep persisted state until the desktop runtime reconciles its live Tauri session IDs.

Tests: migration with existing task data; immutable captured path; valid state transitions; task relation; startup recovery data survives database reopen.

## Task 2: Reconcile native sessions and durable workspace locks — TFW-05, TFW-08

**Status:** Complete. Native session listing, reconciliation, lock hydration, and explicit recovery are implemented and covered by focused backend tests.

**Files:** `src-tauri/src/terminal.rs`, `src-tauri/src/main.rs`, `src-tauri/build.rs`, `src-tauri/capabilities/default.json`, `src/server/terminalLocks.ts`, `src/server/terminalLocks.test.ts`, `src/server.ts`, `src/lib/api.ts`.

Add a narrowly permissioned `terminal_list` Tauri command that reports IDs owned by the current process. Add server routes to list task terminal records, reconcile persisted `starting`/`running` records against that native list, transition start/exit states, and explicitly recover an interrupted record. Hydrate workspace locks from persisted live/interrupted records so server reloads cannot accidentally permit concurrent writers. Recovery must update the record and release only its exact lock atomically; it must not terminate arbitrary processes.

Tests: exact live-ID reconciliation; missing live ID becomes interrupted and stays locked; matching live ID stays active; explicit recovery unlocks exactly one path; competing agent run remains rejected until recovery; overlapping directories remain serialized.

## Task 3: Keep live PTYs mounted across task changes — TFW-04

**Status:** Complete. Windows Tauri A -> B -> A -> B test retained both shells and marker scrollback without duplicate starts.

**Files:** `src/components/TaskWorkspace.tsx`, `src/components/TerminalSurface.tsx`, `src/lib/api.ts`, focused component/runtime tests.

Maintain a set of task terminal surfaces opened during the app lifetime. Keep inactive surfaces mounted but hidden and unfocused; on return, resize/refit and refocus the existing xterm instance. Return to an existing live session without acquiring a second lock or invoking `terminal_start`. When the session exits, record that transition and permit a future explicit start. Restore prior terminal selection only as an interrupted card until Tauri reconciliation finishes; never auto-start from a saved ID.

Acceptance: in the Tauri app open task A and run a unique marker, open task B in a different worktree and run a second marker, then return A -> B -> A. Both processes, working directories, and scrollbacks remain distinct, and no duplicate start occurs.

## Task 4: Show saved context with an explicit copy action — TFW-06

**Status:** Complete. Windows clipboard read-back confirmed the saved checkpoint copy action and task switching produced no shell input.

**Files:** `src/components/TaskWorkspace.tsx`, a new focused context-pane component if needed, focused component tests.

Show saved `task.context` as “Saved checkpoint” and saved `task.draft` as “Next action” beside the active terminal. Provide an explicit copy action with visible success feedback. Switching tasks only changes what is displayed; it never writes to terminal input. An empty field remains visibly empty and does not use stale local draft content as saved context.

Acceptance: copy each field and verify it appears only in the system clipboard; switch tasks without copying and confirm no shell input or command is produced.

## Task 5: Verify M2 recovery and switching — TFW-04, TFW-05, TFW-06, TFW-08

**Status:** Complete on Windows. See the M2 checks and desktop evidence in the verification receipt. Linux/macOS remain untested.

Run the focused terminal-store, lock, and agent-run tests; run TypeScript, the production build, and `bun run test:terminal`. Relaunch the Tauri app on Windows and perform A -> B -> A, context copy, and a simulated interrupted-record reconciliation. Confirm interrupted work stays locked until explicit recovery. Close the app and verify current-process shell cleanup; relaunch and ensure no shell is silently started. Record observed process/session states in the terminal-first verification file.

**M2 receipt:** `bun run test -- src/server/taskStore.test.ts src/server/terminalLocks.test.ts src/server/agentRuns.test.ts` plus the Tauri desktop flow above. Stop after the M2 evidence is recorded; plan any further slice separately.
