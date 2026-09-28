import { workspacesOverlap } from "./workspaceIdentity";
import type { TaskStore } from "./taskStore";
import type { TerminalSessionRecord } from "../lib/tasks";

export interface TerminalLock {
  id: string;
  taskId: string;
  workdir: string;
  createdAt: number;
}

export class TerminalLocks {
  private locks = new Map<string, TerminalLock>();

  hydrate(store: TaskStore) {
    for (const record of store.listTerminalSessions()) {
      if (record.status === "stopped") this.locks.delete(record.id);
      else if (!this.locks.has(record.id)) this.locks.set(record.id, this.toLock(record));
    }
  }

  reconcile(store: TaskStore, liveSessionIds: string[]) {
    const records = store.reconcileTerminalSessions(liveSessionIds);
    this.locks.clear();
    for (const record of records) if (record.status !== "stopped") this.locks.set(record.id, this.toLock(record));
    return records;
  }

  reserve(store: TaskStore, taskId: string, workdir: string): TerminalLock {
    this.hydrate(store);
    const runConflict = store.listRuns().find((run) =>
      ["running", "interrupted"].includes(run.status) && workspacesOverlap(run.project, workdir));
    if (runConflict) throw new Error(runConflict.status === "interrupted"
      ? "An interrupted run owns this workspace. Confirm its old process has stopped before opening a terminal."
      : "An agent run is already using this workspace. Wait or stop it before opening a terminal.");
    if (this.hasActiveWorkspace(workdir)) throw new Error("Another terminal session is already using this workspace.");
    const lock = { id: crypto.randomUUID(), taskId, workdir, createdAt: Date.now() };
    store.createTerminalSession({ ...lock, status: "starting" });
    this.locks.set(lock.id, lock);
    return lock;
  }

  private toLock(record: TerminalSessionRecord): TerminalLock {
    return { id: record.id, taskId: record.taskId, workdir: record.workdir, createdAt: record.createdAt };
  }

  release(id: string): boolean {
    return this.locks.delete(id);
  }

  hasActiveWorkspace(workdir: string): boolean {
    return [...this.locks.values()].some((lock) => workspacesOverlap(lock.workdir, workdir));
  }

  list(): TerminalLock[] {
    return [...this.locks.values()];
  }
}

const runtime = globalThis as typeof globalThis & { saberTerminalLocks?: TerminalLocks };

export function getTerminalLocks() {
  return runtime.saberTerminalLocks ??= new TerminalLocks();
}
