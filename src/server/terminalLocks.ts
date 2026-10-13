import { workspacesOverlap } from "./workspaceIdentity";
import type { TaskStore } from "./taskStore";
import type { TerminalSessionRecord } from "../lib/tasks";

export interface TerminalLock {
  id: string;
  taskId: string;
  workdir: string;
  createdAt: number;
}

/**
 * Terminal ownership is persisted in TaskStore. This service deliberately has
 * no in-memory lock cache: every decision is derived from the same SQLite
 * records used by API reads and restart reconciliation.
 */
export class TerminalLocks {
  reconcile(store: TaskStore, liveSessionIds: string[]) {
    return store.reconcileTerminalSessions(liveSessionIds);
  }

  reserve(store: TaskStore, taskId: string, workdir: string): TerminalLock {
    const runConflict = store.listRuns().find((run) =>
      ["running", "interrupted"].includes(run.status) && workspacesOverlap(run.project, workdir));
    if (runConflict) throw new Error(runConflict.status === "interrupted"
      ? "An interrupted run owns this workspace. Confirm its old process has stopped before opening a terminal."
      : "An agent run is already using this workspace. Wait or stop it before opening a terminal.");
    if (this.hasActiveWorkspace(store, workdir)) throw new Error("Another terminal session is already using this workspace.");

    const lock = { id: crypto.randomUUID(), taskId, workdir, createdAt: Date.now() };
    store.createTerminalSession({ ...lock, status: "starting" });
    return lock;
  }

  hasActiveWorkspace(store: TaskStore, workdir: string): boolean {
    return store.listTerminalSessions().some((record) =>
      record.status !== "stopped" && workspacesOverlap(record.workdir, workdir));
  }
}

const runtime = globalThis as typeof globalThis & { saberTerminalLocks?: TerminalLocks };

export function getTerminalLocks() {
  return runtime.saberTerminalLocks ??= new TerminalLocks();
}
