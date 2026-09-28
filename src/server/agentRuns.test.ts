import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { TaskStore } from "./taskStore";
import { AgentRuns } from "./agentRuns";
import { TerminalLocks } from "./terminalLocks";
import type { AgentProvider } from "./providers/types";

const stores: TaskStore[] = [];
afterEach(() => { stores.splice(0).forEach((store) => store.close()); });

function setup() {
  const store = new TaskStore(":memory:");
  stores.push(store);
  const task = store.createTask({ project: "C:/saber-lifecycle-test", title: "Test", spec: "Do the work", criteria: "Prove it" });
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => true) });
  const spawn = vi.fn<AgentProvider["spawn"]>(() => child as unknown as ReturnType<AgentProvider["spawn"]>);
  const service = new AgentRuns(store, () => ({ name: "opencode", args: () => [], spawn }), (prompt) => `${prompt}\nVerify http://localhost:9999`);
  return { store, task, child, spawn, service };
}

describe("agent runs", () => {
  it("frames split output, captures native identity, and preserves separate follow-up attempts", () => {
    const { store, task, child, spawn, service } = setup();
    store.updateTask(task.id, { context: "Check routes", draft: "next instruction" });
    const id = service.start(task.id, { model: "chosen-model" });
    expect(store.getRun(id)?.task).toBe(spawn.mock.calls[0][0].task);
    expect(store.getRun(id)?.task).toContain("Verify http://localhost:9999");
    child.stdout.write(Buffer.from('{"sessionID":"native-'));
    child.stdout.write(Buffer.from('123","type":"text","part":{"text":"hello"}}\n{"type":"step_finish"}\n'));
    child.emit("close", 0);
    expect(store.events(id, 0).lines).toHaveLength(2);
    expect(store.getRun(id)).toMatchObject({ status: "done", nativeSessionId: "native-123", context: "Check routes" });
    const second = service.start(task.id, { followup: "next instruction" });
    expect(second).not.toBe(id);
    expect(spawn.mock.calls[1][0]).toMatchObject({ session: "native-123", model: "chosen-model" });
    expect(store.listRuns(task.id)).toHaveLength(2);
    expect(store.getTask(task.id)?.draft).toBe("next instruction");
  });

  it("keeps cancellation distinct from failure and blocks a closing child", async () => {
    const { store, task, child, service } = setup();
    const id = service.start(task.id);
    await service.stop(id);
    child.stdout.write(Buffer.from('{"type":"text","part":{"text":"last output"}}\n'));
    expect(() => service.start(task.id)).toThrow("still closing");
    child.emit("close", 1);
    expect(store.getRun(id)?.status).toBe("stopped");
    expect(store.events(id, 0).lines[0]).toContain("last output");
  });

  it("blocks an agent run while an interactive terminal owns the workspace", () => {
    const { store, task, spawn } = setup();
    const locks = new TerminalLocks();
    locks.reserve(store, task.id, task.project);
    const service = new AgentRuns(store, undefined, undefined, locks);
    expect(() => service.start(task.id)).toThrow("interactive terminal owns this workspace");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("preserves launch errors and retains a draft", () => {
    const { store, task, spawn, service } = setup();
    store.updateTask(task.id, { draft: "keep me" });
    spawn.mockImplementation(() => { throw new Error("executable missing"); });
    expect(() => service.start(task.id)).toThrow("executable missing");
    const run = store.listRuns(task.id)[0];
    expect(run.status).toBe("error");
    expect(store.events(run.id, 0).lines[0]).toContain("executable missing");
    expect(store.getTask(task.id)?.draft).toBe("keep me");
  });

  it("does not turn an asynchronous process error into success", () => {
    const { store, task, child, service } = setup();
    const id = service.start(task.id);
    child.stderr.write(Buffer.from("Provider diagnostic"));
    child.emit("error", new Error("spawn failed"));
    child.emit("close", 0);
    expect(store.getRun(id)?.status).toBe("error");
    expect(store.events(id, 0).lines[0]).toContain("Provider diagnostic");
  });

  it("isolates provider continuation and records the selected provider", () => {
    const { store, task, child, spawn, service } = setup();
    const open = service.start(task.id);
    child.stdout.write(Buffer.from('{"sessionID":"open-id","type":"step_start"}\n'));
    child.emit("close", 0);
    expect(() => service.start(task.id, { provider: "codex", followup: "continue" })).toThrow("No codex session");
    const codex = service.start(task.id, { provider: "codex" });
    expect(store.getRun(codex)?.provider).toBe("codex");
    expect(spawn.mock.calls[1][0].session).toBeUndefined();
    child.stdout.write(Buffer.from('{"type":"thread.started","thread_id":"codex-id"}\n'));
    child.emit("close", 0);
    service.start(task.id, { provider: "opencode", followup: "continue" });
    expect(spawn.mock.calls[2][0].session).toBe("open-id");
    expect(store.getRun(open)?.provider).toBe("opencode");
  });

  it("does not turn a provider failure event into success on zero exit", () => {
    const { store, task, child, service } = setup();
    const id = service.start(task.id, { provider: "claude" });
    child.stdout.write(Buffer.from('{"type":"result","is_error":true,"result":"not signed in"}\n'));
    child.emit("close", 0);
    expect(store.getRun(id)?.status).toBe("error");
    expect(JSON.parse(store.events(id, 0).lines[0]).raw).toContain("not signed in");
  });
});
