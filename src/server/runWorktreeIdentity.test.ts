import { describe, expect, it } from "vitest";
import { TaskStore } from "./taskStore";

describe("run worktree persistence invariants", () => {
  it("keeps run worktree identity immutable and removed state terminal", () => {
    const store = new TaskStore(":memory:");
    try {
      const input = { project: "/projects/one", title: "First", spec: "Work", criteria: "Check" };
      const first = store.createTask(input);
      const second = store.createTask({ ...input, project: "/projects/two", title: "Second" });
      const record = store.createRunWorktree({
        runId: "run-one",
        taskId: first.id,
        path: "/managed/one/runs/run-one",
        source: "/projects/one",
        sourceBranch: "main",
        baseCommit: "a".repeat(40),
        branch: "saber/one/run-one",
        state: "ready",
      });

      expect(() => store.writeRunWorktree({ ...record, taskId: second.id })).toThrow("identity cannot change");
      expect(() => store.writeRunWorktree({ ...record, path: "/outside/worktree" })).toThrow("identity cannot change");
      expect(() => store.writeRunWorktree({ ...record, source: "/other/repository" })).toThrow("identity cannot change");
      expect(() => store.writeRunWorktree({ ...record, sourceBranch: "release" })).toThrow("identity cannot change");
      expect(() => store.writeRunWorktree({ ...record, baseCommit: "b".repeat(40) })).toThrow("identity cannot change");
      expect(() => store.writeRunWorktree({ ...record, branch: "attacker/branch" })).toThrow("identity cannot change");
      expect(() => store.writeRunWorktree({ ...record, runId: "run-two" })).toThrow("not found");
      expect(store.getRunWorktree(record.runId)).toEqual(record);

      const removed = store.writeRunWorktree({ ...record, state: "removed" });
      expect(removed.state).toBe("removed");
      expect(() => store.writeRunWorktree({ ...removed, state: "ready" })).toThrow("cannot be restored");
      expect(store.getRunWorktree(record.runId)).toEqual(removed);
    } finally {
      store.close();
    }
  });
});
