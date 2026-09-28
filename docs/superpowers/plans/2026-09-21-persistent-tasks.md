# Persistent Tasks Implementation Plan

> Execute inline using the executing-plans workflow. Track acceptance criteria from ../specs/2026-09-21-persistent-tasks.md.

**Goal:** Restore task context and history across switching and restarts, with distinct OpenCode attempts.

**Architecture:** SQLite stores tasks, immutable run snapshots, and sequenced events. A process service owns active children and parses their streams. Task APIs feed a task workspace with explicit saves and local recovery of unsaved edits.

**Tech Stack:** Existing Bun, TanStack Start, React, Tailwind v4, Tauri; built-in node:sqlite.

## Constraints

Use Bun commands, port 8082 with strictPort, no generated-file edits, no new code comments. Preserve pre-existing working-tree edits. Build on codex/persistent-tasks. Keep OpenCode stdin ignored.

## Steps

- [x] Add src/lib/tasks.ts shared records and src/server/taskStore.ts SQLite repository. Implement createTask, updateTask, createRun, finishRun, appendEvent, events, and restart reconciliation. Cover PT-01/02/04/05/07 in src/server/taskStore.test.ts using temporary databases closed and reopened between assertions.
- [x] Add src/server/agentRuns.ts process ownership and JSON-line framing; replace sessionStore.ts usage in server.ts routes. Reject overlapping workspaces, preserve model/session identity, expose failures, and retain cancelled status. Cover PT-02/05/06/07 with fake process tests. The unused legacy store file retains pre-existing user edits.
- [x] Add task API methods, TaskWorkspace and TaskDetail components. Replace the index route's session launcher with the task workspace while retaining shared dev/browser panes. Save context and drafts explicitly, keep per-task unsaved copies in localStorage, and restore selection. Fix SessionPane polling identity and error display. Cover PT-03/06 through browser checks.
- [x] Link the approved direction and development contract from AGENTS.md and README.md. Run bun run test, bun x tsc --noEmit, bun run build; restart bun run dev and inspect the changed task pane in the browser. Record actual results and remaining scope.

## Verification cases

Persistence tests must close and reopen storage; assert an unfinished run becomes interrupted, completed runs remain ready for review, draft/context survive, spec snapshots remain unchanged after edits, events paginate beyond 2,000 entries without gaps, and duplicate active workspace launches are rejected. Lifecycle tests must emit split JSON, stderr, close, and error events and verify persisted outcomes. Browser checks must create two draft tasks, switch between them, restore unsaved text, save, refresh, and check restored selection/context. A stopped process must not become failed when its close event arrives.

Completion evidence: ../specs/2026-09-21-persistent-tasks-verification.md.
