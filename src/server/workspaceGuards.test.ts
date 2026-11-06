import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { TaskStore } from "./taskStore";
import { AgentRuns } from "./agentRuns";
import { TerminalLocks } from "./terminalLocks";
import { workspaceActiveCheck } from "./workspaceGuards";
import type { AgentProvider } from "./providers/types";

function adapter(spawn: AgentProvider["spawn"]): AgentProvider {
  return { name: "opencode", contextBudget: { maxPromptChars: 200_000, supportsProfileContext: true }, readOnly: { supported: true, args: [] }, args: () => [], spawn };
}

describe("workspaceActiveCheck", () => {
  it("reports terminal locks even when no agent run is active", () => {
    const store = new TaskStore(":memory:");
    try {
      const task = store.createTask({ project: "/tmp/saber-guard-proj", title: "Guard", spec: "s", criteria: "c" });
      const locks = new TerminalLocks();
      const agentRuns = new AgentRuns(store, () => adapter(() => { throw new Error("must not spawn"); }), (prompt) => prompt, locks);
      const check = workspaceActiveCheck(store, agentRuns, locks);
      expect(check(task.project)).toBe(false);
      locks.reserve(store, task.id, task.project);
      expect(check(task.project)).toBe(true);
    } finally {
      store.close();
    }
  });

  it("reports active agent runs for the same workspace", async () => {
    process.env.ONYX_DISABLED = "1";
    const store = new TaskStore(":memory:");
    try {
      const task = store.createTask({ project: "/tmp/saber-guard-runs", title: "Guard", spec: "s", criteria: "c" });
      const locks = new TerminalLocks();
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
      const spawn = () => child as unknown as ReturnType<AgentProvider["spawn"]>;
      const agentRuns = new AgentRuns(store, () => adapter(spawn), (prompt) => prompt, locks);
      const check = workspaceActiveCheck(store, agentRuns, locks);
      expect(check(task.project)).toBe(false);
      await agentRuns.start(task.id);
      expect(check(task.project)).toBe(true);
      child.emit("close", 0);
    } finally {
      store.close();
      if (process.env.ONYX_DISABLED === "1") delete process.env.ONYX_DISABLED;
    }
  });
});
