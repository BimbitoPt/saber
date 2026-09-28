import { describe, expect, it } from "vitest";
import { TaskStore } from "./taskStore";
import { TerminalLocks } from "./terminalLocks";

describe("terminal workspace locks", () => {
  it("allows only one writable session per overlapping workspace", () => {
    const store = new TaskStore(":memory:");
    const locks = new TerminalLocks();
    try {
      const first = store.createTask({ project: "C:/saber-locks/project", title: "First", spec: "Work", criteria: "Done" });
      const second = store.createTask({ project: "C:/saber-locks/project", title: "Second", spec: "Work", criteria: "Done" });
      const isolated = store.createTask({ project: "C:/saber-locks/worktree", title: "Isolated", spec: "Work", criteria: "Done" });
      const firstLock = locks.reserve(store, first.id, first.project);
      expect(() => locks.reserve(store, second.id, second.project)).toThrow("Another terminal session");
      const isolatedLock = locks.reserve(store, isolated.id, isolated.project);
      expect(locks.hasActiveWorkspace(first.project)).toBe(true);
      expect(locks.release(firstLock.id)).toBe(true);
      expect(locks.hasActiveWorkspace(first.project)).toBe(false);
      expect(locks.release(isolatedLock.id)).toBe(true);
    } finally {
      store.close();
    }
  });

  it("blocks a terminal while an agent run owns the workspace", () => {
    const store = new TaskStore(":memory:");
    try {
      const task = store.createTask({ project: "C:/saber-locks/agent", title: "Agent", spec: "Work", criteria: "Done" });
      store.createRun(task.id, "Run agent");
      expect(() => new TerminalLocks().reserve(store, task.id, task.project)).toThrow("agent run is already using");
    } finally {
      store.close();
    }
  });

  it("keeps an interrupted agent workspace locked", () => {
    const store = new TaskStore(":memory:");
    try {
      const task = store.createTask({ project: "C:/saber-locks/interrupted", title: "Interrupted", spec: "Work", criteria: "Done" });
      const run = store.createRun(task.id, "Run agent");
      store.finishRun(run.id, "interrupted", null);
      expect(() => new TerminalLocks().reserve(store, task.id, task.project)).toThrow("interrupted run owns this workspace");
    } finally {
      store.close();
    }
  });

  it("rehydrates terminal ownership and keeps missing native sessions locked until explicit recovery", () => {
    const store = new TaskStore(":memory:");
    try {
      const first = store.createTask({ project: "C:/saber-locks/restart", title: "First", spec: "Work", criteria: "Done" });
      const second = store.createTask({ project: "C:/saber-locks/restart", title: "Second", spec: "Work", criteria: "Done" });
      const original = new TerminalLocks();
      const lock = original.reserve(store, first.id, first.project);
      store.setTerminalSessionStatus(lock.id, "running");

      const restarted = new TerminalLocks();
      expect(restarted.reconcile(store, [lock.id]).find((item) => item.id === lock.id)?.status).toBe("running");
      expect(() => restarted.reserve(store, second.id, second.project)).toThrow("Another terminal session");
      expect(restarted.reconcile(store, []).find((item) => item.id === lock.id)?.status).toBe("interrupted");
      expect(() => restarted.reserve(store, second.id, second.project)).toThrow("Another terminal session");

      store.recoverTerminalSession(lock.id, true);
      restarted.release(lock.id);
      expect(restarted.reserve(store, second.id, second.project).taskId).toBe(second.id);
    } finally {
      store.close();
    }
  });
});
