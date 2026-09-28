# Task Terminal View Persistence Implementation Plan

> **For agentic workers:** Execute this plan inline in the current task, one task at a time, and record results against the feature spec.

**Goal:** Preserve task-owned terminal sessions and xterm output while users switch between Saber Terminal, List, and Board views.

**Architecture:** Keep the terminal workspace at a stable React tree position and change its visibility/focus rather than unmounting it. While Board/List is visible, mount only opened sessions that already have a non-stopped session record; defer a newly selected task's terminal start until Terminal view is active. Test lifecycle through React in jsdom with a mocked terminal surface and real Board selection wiring.

**Tech Stack:** Bun, React 19, Vitest, jsdom, Tauri v2, xterm.js, Rust portable-pty.

## Global Constraints

- Preserve task/run separation and immutable run scope.
- Keep the Tauri process as the sole owner of PTYs.
- Never edit src/routeTree.gen.* or src-tauri/gen/**.
- Keep the hidden terminal layer dimensioned, hidden, and non-interactive; do not use display:none for live xterm surfaces.
- Do not start a newly selected task terminal while the user is in Board or List.
- Continue using Bun as package manager and Vitest for frontend tests.
- Do not mark M7 complete until each LDR criterion has its own receipt.

---

### Task 1: Add a lifecycle regression test

**Files:**
- Modify: package.json and bun.lock to add jsdom as a test dependency.
- Modify: vitest.config.ts to include .test.tsx files.
- Create: src/components/TaskWorkspace.test.tsx.

**Interfaces:** Mount TaskWorkspace, use the real TaskBoard to select tasks, and mock API calls plus TerminalSurface lifecycle. The mock terminal records per-task mount/unmount counts and exposes a unique marker while mounted.

- [x] **Step 1: Install jsdom with Bun**

Run: `bun add --dev jsdom`

Expected: jsdom appears in devDependencies and bun.lock; no other package-manager files are created.

- [x] **Step 2: Extend Vitest test discovery**

Set the include pattern in vitest.config.ts to:

```ts
include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.ts"]
```

Expected: existing .test.ts suites remain discovered and the new .test.tsx suite is included.

- [x] **Step 3: Write the failing lifecycle test**

Create a jsdom test that supplies tasks task-a and task-b, sets localStorage["saber.selectedTask"] to task-a, mocks terminal_list to return no live sessions, and mocks TerminalSurface with a useEffect that increments a per-task mount counter and cleanup counter. Render TaskWorkspace and wait for task data and terminal reconciliation, then:

1. Click Terminal's Start terminal button for task A and verify A mounts once.
2. Click the Board view button and verify A has not unmounted.
3. Click task B in the real Board and verify selection moves to the task details/List view while A remains mounted and B's terminal surface has not mounted.
4. Click Terminal and verify B mounts once while A remains mounted.
5. Click Board, select task A, then click Terminal and verify A still has exactly one mount, zero unmounts, and its unique marker remains rendered.

Mock listProjects, listTasks, reconcileTerminalSessions, and Tauri invoke so the test makes no local service requests. Unmount the React root at test end and assert cleanup occurs then.

- [x] **Step 4: Run the focused test and confirm the current behavior fails**

Run: `bun run test -- src/components/TaskWorkspace.test.tsx`

Expected before implementation: the test fails because switching Terminal → Board unmounts task A's terminal surface.

### Task 2: Keep the terminal layer mounted while subviews change

**Files:**
- Modify: src/components/TaskWorkspace.tsx.
- Test: src/components/TaskWorkspace.test.tsx.

**Interfaces:** Preserve existing TaskBoard, TaskDetail, TerminalSurface, and task selection callbacks. A terminal is active only when view === "terminal" and taskId === selected.

- [x] **Step 1: Create a stable terminal workspace layer**

Keep the terminal panel rendered at the same JSX position for all three subviews. Apply visible only when view === "terminal"; otherwise apply invisible pointer-events-none and aria-hidden=true. Use an absolute, dimensioned wrapper so xterm retains its size and buffer behind Board/List content.

- [x] **Step 2: Preserve existing PTY-backed surfaces outside Terminal view**

Derive the hidden view's preserved task IDs from terminalSessions whose status is starting, running, or interrupted. While Terminal view is active, render all openedTerminalTasks as before. While List/Board is active, render only those preserved IDs. This keeps live sessions mounted but omits a newly selected task that has not started yet.

- [x] **Step 3: Gate focus and new starts by the active Terminal view**

Pass active={view === "terminal" && taskId === selected}. Keep the existing startOnOpen request stable for previously started tasks. Do not set a hidden newly selected task active; it must mount and start only after Terminal view is selected.

- [x] **Step 4: Run the focused test and verify lifecycle assertions pass**

Run: `bun run test -- src/components/TaskWorkspace.test.tsx`

Expected: task A remains mounted exactly once through Board/List changes; task B remains absent until Terminal view; returning to A retains the same mock marker without a second start.

### Task 3: Run regressions and record evidence

**Files:**
- Modify: docs/superpowers/specs/2026-09-25-task-terminal-view-persistence.md.
- Modify: docs/superpowers/specs/2026-09-24-linux-desktop-runtime.md.
- Modify: docs/superpowers/plans/2026-09-25-task-terminal-view-persistence.md.

**Interfaces:** The completion receipt maps automated and manual results to TVP-01 through TVP-03 and LDR-05.

- [x] **Step 1: Run frontend typecheck and full tests**

Run: `bunx tsc --noEmit` and `bun run test`

Expected: both pass, including the new lifecycle regression test.

- [x] **Step 2: Run terminal and production build checks**

Run: `bun run test:terminal`, `bun run build`, and `bun run tauri:linux:build` in Ubuntu 26.04 WSL.

Expected: Linux Rust/terminal checks pass and refreshed .deb/AppImage artifacts build.

- [ ] **Step 3: Repeat the Omarchy A-to-B-to-A check on the refreshed AppImage**

Copy the new AppImage to /mnt/host, launch it, run a unique marker in A and B, switch through Board and Terminal/List views, and confirm A's original marker and shell return with the same session. Close Saber and repeat the launcher-PID and exact process cleanup check.

Expected: A and B markers/cwds remain separate; neither session is duplicated during switching; all Saber-owned processes exit after close.

- [x] **Step 4: Record automated checks and remaining manual acceptance**

Record every passing command and actual Omarchy observation under its requirement ID. Leave any unobserved packaged behavior pending; do not infer completion from a successful build.
