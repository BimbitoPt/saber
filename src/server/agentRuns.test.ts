import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { PassThrough } from "node:stream";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "./taskStore";
import { AGENT_STOP_ESCALATION_MS, AgentRuns } from "./agentRuns";
import { annotateQueuePositions } from "./runQueue";
import { ProjectProfiles } from "./projectProfiles";
import { TerminalLocks } from "./terminalLocks";
import type { AgentProvider } from "./providers/types";

const stores: TaskStore[] = [];
const savedOnyxDisabled = process.env.ONYX_DISABLED;
process.env.ONYX_DISABLED = "1";
afterEach(() => {
  stores.splice(0).forEach((store) => store.close());
  if (savedOnyxDisabled === undefined) delete process.env.ONYX_DISABLED;
  else process.env.ONYX_DISABLED = savedOnyxDisabled;
  delete process.env.ONYX_BASE_URL;
});

function adapter(spawn: AgentProvider["spawn"]): AgentProvider {
  return { name: "opencode", contextBudget: { maxPromptChars: 200_000, supportsProfileContext: true }, readOnly: { supported: true, args: [] }, args: () => [], spawn };
}

function setup() {
  const store = new TaskStore(":memory:");
  stores.push(store);
  const task = store.createTask({ project: "C:/saber-lifecycle-test", title: "Test", spec: "Do the work", criteria: "Prove it" });
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => true) });
  const spawn = vi.fn<AgentProvider["spawn"]>(() => child as unknown as ReturnType<AgentProvider["spawn"]>);
  const service = new AgentRuns(store, () => adapter(spawn), (prompt) => `${prompt}\nVerify http://localhost:9999`);
  return { store, task, child, spawn, service };
}

describe("agent runs", () => {
  it("automatically injects the visual-web harness for plain-language website tasks", () => {
    const { store, task, spawn, service } = setup();
    const updated = store.updateTask(task.id, {
      title: "Build a premium 3D website for my car company",
      spec: "Create a complete website with a cinematic vehicle experience.",
      criteria: "Responsive, polished, and usable on mobile.",
      expectedUpdatedAt: task.updatedAt,
    });

    const scope = service.assembleScope(updated, updated.project, adapter(spawn));

    expect(scope.prompt).toContain("# Visual Web Skill");
    expect(scope.prompt).toContain("# Visual Web Agent Harness");
    expect(scope.prompt).toContain("# Visual Web Task Template");
    expect(scope.contextSources).toEqual(expect.arrayContaining([
      "visual-web skill",
      "visual-web agent guide",
      "visual-web task template",
    ]));
  });

  it("frames split output, captures native identity, and preserves separate follow-up attempts", async () => {
    const { store, task, child, spawn, service } = setup();
    store.updateTask(task.id, { context: "Check routes", draft: "next instruction", expectedUpdatedAt: task.updatedAt });
    const id = await service.start(task.id, { model: "chosen-model" });
    expect(store.getRun(id)?.task).toBe(spawn.mock.calls[0][0].task);
    expect(store.getRun(id)?.task).toContain("Verify http://localhost:9999");
    child.stdout.write(Buffer.from('{"sessionID":"native-'));
    child.stdout.write(Buffer.from('123","type":"text","part":{"text":"hello"}}\n{"type":"step_finish"}\n'));
    child.emit("close", 0);
    expect(store.events(id, 0).lines).toHaveLength(2);
    expect(store.getRun(id)).toMatchObject({ status: "done", nativeSessionId: "native-123", context: "Check routes" });
    const second = await service.start(task.id, { followup: "next instruction" });
    expect(second).not.toBe(id);
    expect(spawn.mock.calls[1][0]).toMatchObject({ session: "native-123", model: "chosen-model" });
    expect(store.listRuns(task.id)).toHaveLength(2);
    expect(store.getTask(task.id)?.draft).toBe("next instruction");
  });

  it("keeps cancellation distinct from failure and blocks a closing child", async () => {
    const { store, task, child, service } = setup();
    const id = await service.start(task.id);
    await service.stop(id);
    child.stdout.write(Buffer.from('{"type":"text","part":{"text":"last output"}}\n'));
    await expect(service.start(task.id)).rejects.toThrow("still closing");
    child.emit("close", 1);
    expect(store.getRun(id)?.status).toBe("stopped");
    expect(store.events(id, 0).lines[0]).toContain("last output");
  });

  it("escalates a stop to SIGKILL when the provider ignores termination", async () => {
    const { store, task } = setup();
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn((signal?: NodeJS.Signals | number) => {
        if (signal === "SIGKILL") queueMicrotask(() => child.emit("close", null));
        return true;
      }),
    });
    const spawn = vi.fn<AgentProvider["spawn"]>(() => child as unknown as ReturnType<AgentProvider["spawn"]>);
    const stubborn = new AgentRuns(store, () => adapter(spawn), (prompt) => prompt);
    vi.useFakeTimers();
    try {
      const id = await stubborn.start(task.id);
      const stopped = stubborn.stop(id);
      await vi.advanceTimersByTimeAsync(AGENT_STOP_ESCALATION_MS);
      await stopped;
      await vi.advanceTimersByTimeAsync(1);
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");
      expect(store.getRun(id)?.status).toBe("stopped");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not escalate when the child exits before the deadline", async () => {
    const { store, task, child, service } = setup();
    vi.useFakeTimers();
    try {
      const id = await service.start(task.id);
      const stopped = service.stop(id);
      child.emit("close", 0);
      await stopped;
      await vi.advanceTimersByTimeAsync(AGENT_STOP_ESCALATION_MS + 1_000);
      expect(child.kill).toHaveBeenCalledTimes(1);
      expect(store.getRun(id)?.status).toBe("stopped");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stopAll escalates to SIGKILL when a provider ignores termination", async () => {
    const { store, task } = setup();
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn((signal?: NodeJS.Signals | number) => {
        if (signal === "SIGKILL") queueMicrotask(() => child.emit("close", null));
        return true;
      }),
    });
    const spawn = vi.fn<AgentProvider["spawn"]>(() => child as unknown as ReturnType<AgentProvider["spawn"]>);
    const escalating = new AgentRuns(store, () => adapter(spawn), (prompt) => prompt);
    const id = await escalating.start(task.id);
    await escalating.stopAll(200);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(store.getRun(id)?.status).toBe("stopped");
  });

  it("stopAll settles quickly when every child exits on termination", async () => {
    const { store, task, child, service } = setup();
    const id = await service.start(task.id);
    const pending = service.stopAll(500);
    queueMicrotask(() => child.emit("close", 0));
    await pending;
    expect(store.getRun(id)?.status).toBe("stopped");
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it("blocks an agent run while an interactive terminal owns the workspace", async () => {
    const { store, task, spawn } = setup();
    const locks = new TerminalLocks();
    locks.reserve(store, task.id, task.project);
    const service = new AgentRuns(store, undefined, undefined, locks);
    await expect(service.start(task.id)).rejects.toThrow("interactive terminal owns this workspace");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("preserves launch errors and retains a draft", async () => {
    const { store, task, spawn, service } = setup();
    store.updateTask(task.id, { draft: "keep me", expectedUpdatedAt: task.updatedAt });
    spawn.mockImplementation(() => { throw new Error("executable missing"); });
    await expect(service.start(task.id)).rejects.toThrow("executable missing");
    const run = store.listRuns(task.id)[0];
    expect(run.status).toBe("error");
    expect(store.events(run.id, 0).lines[0]).toContain("executable missing");
    expect(store.getTask(task.id)?.draft).toBe("keep me");
  });

  it("does not turn an asynchronous process error into success", async () => {
    const { store, task, child, service } = setup();
    const id = await service.start(task.id);
    child.stderr.write(Buffer.from("Provider diagnostic"));
    child.emit("error", new Error("spawn failed"));
    child.emit("close", 0);
    expect(store.getRun(id)?.status).toBe("error");
    expect(store.events(id, 0).lines[0]).toContain("Provider diagnostic");
  });

  it("isolates provider continuation and records the selected provider", async () => {
    const { store, task, child, spawn, service } = setup();
    const open = await service.start(task.id);
    child.stdout.write(Buffer.from('{"sessionID":"open-id","type":"step_start"}\n'));
    child.emit("close", 0);
    await expect(service.start(task.id, { provider: "codex", followup: "continue" })).rejects.toThrow("No codex session");
    const codex = await service.start(task.id, { provider: "codex" });
    expect(store.getRun(codex)?.provider).toBe("codex");
    expect(spawn.mock.calls[1][0].session).toBeUndefined();
    child.stdout.write(Buffer.from('{"type":"thread.started","thread_id":"codex-id"}\n'));
    child.emit("close", 0);
    await service.start(task.id, { provider: "opencode", followup: "continue" });
    expect(spawn.mock.calls[2][0].session).toBe("open-id");
    expect(store.getRun(open)?.provider).toBe("opencode");
  });

  it("does not turn a provider failure event into success on zero exit", async () => {
    const { store, task, child, service } = setup();
    const id = await service.start(task.id, { provider: "claude" });
    child.stdout.write(Buffer.from('{"type":"result","is_error":true,"result":"not signed in"}\n'));
    child.emit("close", 0);
    expect(store.getRun(id)?.status).toBe("error");
    expect(JSON.parse(store.events(id, 0).lines[0]).raw).toContain("not signed in");
  });

  it("captures profile and role snapshots that survive later profile edits", async () => {
    const { store, task, child, service } = setup();
    store.registerProject(task.project);
    const profiles = new ProjectProfiles(store);
    const first = profiles.approveRevision(profiles.saveDraft(task.project, [
      { key: "stack", origin: "user", author: "qa", content: "first profile" },
    ]).id);
    const firstRun = await service.start(task.id);
    const captured = store.getRun(firstRun)!;
    expect(captured.profileRevisionId).toBe(first.id);
    expect(captured.roleId).toBe("default");
    expect(captured.roleInstructions).toContain("implementing agent");
    expect(captured.contextSources).toContain("default role instructions");
    expect(captured.task).toContain("first profile");
    child.emit("close", 0);

    const second = profiles.approveRevision(profiles.saveDraft(task.project, [
      { key: "stack", origin: "user", author: "qa", content: "second profile" },
    ]).id);
    const secondRun = await service.start(task.id);
    expect(second).not.toBe(firstRun);
    expect(store.getRun(secondRun)?.profileRevisionId).toBe(second.id);
    expect(store.getRun(secondRun)?.task).toContain("second profile");
    expect(store.getRun(firstRun)?.task).toContain("first profile");
    expect(store.getRun(firstRun)?.task).not.toContain("second profile");
  });

  it("blocks oversized prompts before launch and names the over-budget source", async () => {
    const { store, task, spawn } = setup();
    const tiny = (name = "opencode"): AgentProvider => ({
      name, contextBudget: { maxPromptChars: 10, supportsProfileContext: true }, readOnly: { supported: true, args: [] }, args: () => [], spawn,
    });
    const service = new AgentRuns(store, tiny, (prompt) => prompt);
    await expect(service.start(task.id)).rejects.toThrow("context budget");
    await expect(service.start(task.id)).rejects.toThrow("largest source");
    expect(spawn).not.toHaveBeenCalled();
    expect(store.listRuns(task.id)).toHaveLength(0);
    const preview = await service.preview(task.id);
    expect(preview.verdict).toBe("oversized");
    expect(preview.notice).toContain("largest source");
  });

  it("is explicit when an adapter cannot carry profile context", async () => {
    const { store, task, spawn } = setup();
    const unsupported = (): AgentProvider => ({
      name: "legacy", contextBudget: { maxPromptChars: 200_000, supportsProfileContext: false }, readOnly: { supported: false, reason: "test stub" }, args: () => [], spawn,
    });
    const service = new AgentRuns(store, unsupported, (prompt) => prompt);
    await expect(service.start(task.id)).rejects.toThrow("does not support profile context");
    expect(spawn).not.toHaveBeenCalled();
    const preview = await service.preview(task.id);
    expect(preview.verdict).toBe("unsupported");
    expect(preview.notice).toContain("omit");
  });

  it("keeps secret-bearing files out of the assembled prompt and preview", async () => {
    const directory = mkdtempSync(join(tmpdir(), "saber-profile-hygiene-"));
    try {
      writeFileSync(join(directory, "AGENTS.md"), "Stack: Bun.");
      writeFileSync(join(directory, ".env"), "SECRET=top-secret-value");
      writeFileSync(join(directory, "secrets.json"), JSON.stringify({ token: "secret-token-value" }));
      const store = new TaskStore(":memory:");
      stores.push(store);
      const task = store.createTask({ project: directory, title: "Test", spec: "Do the work", criteria: "Prove it" });
      const profiles = new ProjectProfiles(store);
      profiles.registerProject(directory);
      const approved = profiles.approveRevision(profiles.discoverDraft(directory).id);
      expect(approved.entries.map((entry) => entry.key)).toEqual(["AGENTS.md"]);
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => true) });
      const spawn = vi.fn<AgentProvider["spawn"]>(() => child as unknown as ReturnType<AgentProvider["spawn"]>);
      const service = new AgentRuns(store, () => adapter(spawn), (prompt) => prompt);
      const id = await service.start(task.id);
      const run = store.getRun(id)!;
      expect(run.task).toContain("Stack: Bun.");
      expect(run.task).not.toContain("top-secret-value");
      expect(run.task).not.toContain("secret-token-value");
      const preview = await service.preview(task.id);
      expect(preview.verdict).toBe("ok");
      expect(JSON.stringify(preview)).not.toContain("top-secret-value");
      expect(JSON.stringify(preview)).not.toContain("secret-token-value");
      child.emit("close", 0);
      expect(store.getRun(id)?.status).toBe("done");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  const onyxHits = [
    { sourcePath: "C:/corpus/Mstudio-ade.md", note: "Mstudio-ade.md", heading: "Saber", excerpt: "A terminal-first workspace.", mtime: "2026-09-18T11:12:56.943Z", score: 3 },
  ];

  it("records the onyx sha and cites hits in the submitted prompt", async () => {
    const { store, task, child, service } = setup();
    const id = await service.start(task.id, { onyx: { ok: true, sha: "a".repeat(64), hits: onyxHits, query: "q" } });
    const run = store.getRun(id)!;
    expect(run.onyxContextSha).toBe("a".repeat(64));
    expect(run.onyxProvenance).toBe("onyx");
    expect(run.onyxNotice).toBeUndefined();
    expect(run.contextSources).toContain("project context from Onyx (cited, aaaaaaaa)");
    expect(run.task).toContain("Project context from Onyx (cited, aaaaaaaa):");
    expect(run.task).toContain("[1] A terminal-first workspace. (Mstudio-ade.md — Saber)");
    child.emit("close", 0);
  });

  it("launches with an explicit notice when onyx is unavailable", async () => {
    const { store, task, child, service } = setup();
    const id = await service.start(task.id, { onyx: { ok: false, notice: "Onyx context unavailable: the context service is unreachable. The run launches with the local profile snapshot." } });
    const run = store.getRun(id)!;
    expect(run.onyxContextSha).toBeUndefined();
    expect(run.onyxProvenance).toBe("unavailable");
    expect(run.onyxNotice).toContain("unreachable");
    expect(run.contextSources?.some((source) => source.includes("Onyx"))).toBe(false);
    child.emit("close", 0);
  });

  it("queries the configured onyx service once on the default launch path", async () => {
    const { store, task, child, service } = setup();
    let requests = 0;
    const server = createServer((req, res) => {
      requests += 1;
      expect(req.headers["x-tenant-id"]).toBe("default");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ hits: onyxHits }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    delete process.env.ONYX_DISABLED;
    process.env.ONYX_BASE_URL = `http://127.0.0.1:${port}`;
    try {
      const id = await service.start(task.id);
      const run = store.getRun(id)!;
      expect(requests).toBe(1);
      expect(run.onyxProvenance).toBe("onyx");
      expect(run.onyxContextSha).toMatch(/^[0-9a-f]{64}$/);
      expect(run.task).toContain("Project context from Onyx (cited,");
      child.emit("close", 0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("persists no onyx address or credential material on the run", async () => {
    const { store, task, child, service } = setup();
    const id = await service.start(task.id, { onyx: { ok: true, sha: "b".repeat(64), hits: onyxHits, query: "q" } });
    const dumped = JSON.stringify(store.getRun(id));
    expect(dumped).not.toContain("8083");
    expect(dumped).not.toContain("x-tenant-id");
    expect(dumped).toContain("b".repeat(64));
    child.emit("close", 0);
  });

  it("restores onyx fields byte-identically after reopening", async () => {
    const directory = mkdtempSync(join(tmpdir(), "saber-onyx-reopen-"));
    const path = join(directory, "tasks.sqlite");
    const first = new TaskStore(path);
    const task = first.createTask({ project: "C:/onyx-reopen", title: "Test", spec: "Do the work", criteria: "Prove it" });
    const run = first.createRun(task.id, "prompt", undefined, "opencode", undefined, {
      contextSources: ["project context from Onyx (cited, cccccccc)"],
      onyxContextSha: "c".repeat(64), onyxProvenance: "onyx",
    });
    first.close();
    const reopened = new TaskStore(path);
    try {
      expect(reopened.getRun(run.id)).toMatchObject({
        onyxContextSha: "c".repeat(64), onyxProvenance: "onyx",
        contextSources: ["project context from Onyx (cited, cccccccc)"],
      });
    } finally {
      reopened.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.runIf(!!process.env.SABER_LIVE_ONYX)("resolves cited context against the live onyx service", async () => {
    const { store, task, child, service } = setup();
    delete process.env.ONYX_DISABLED;
    delete process.env.ONYX_BASE_URL;
    const id = await service.start(task.id);
    const run = store.getRun(id)!;
    expect(run.onyxProvenance).toBe("onyx");
    expect(run.onyxContextSha).toMatch(/^[0-9a-f]{64}$/);
    child.emit("close", 0);
  });
  it("settles a running run that owns no process instead of leaving the workspace locked", async () => {
    const { store, task, service } = setup();
    const orphan = store.createRun(task.id, "prompt", undefined, "opencode");
    await service.stop(orphan.id);
    expect(store.getRun(orphan.id)?.status).toBe("interrupted");
    expect(() => store.createRun(task.id, "another")).toThrow("interrupted");
  });
});

describe("run queue", () => {
  const savedLimit = process.env.SABER_MAX_ACTIVE_RUNS;
  const makeChild = () => Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => true) });
  let children: ReturnType<typeof makeChild>[] = [];

  beforeEach(() => { children = []; });
  afterEach(() => {
    if (savedLimit === undefined) delete process.env.SABER_MAX_ACTIVE_RUNS;
    else process.env.SABER_MAX_ACTIVE_RUNS = savedLimit;
  });

  class FlippableLocks extends TerminalLocks {
    blocked = new Set<string>();
    override hasActiveWorkspace(store: TaskStore, workdir: string): boolean {
      return this.blocked.has(workdir) || super.hasActiveWorkspace(store, workdir);
    }
  }

  function queueSetup() {
    const store = new TaskStore(":memory:");
    stores.push(store);
    const task = store.createTask({ project: join(tmpdir(), "saber-queue-first"), title: "First", spec: "Do the work", criteria: "Prove it" });
    const spawn = vi.fn<AgentProvider["spawn"]>(() => {
      const child = makeChild();
      children.push(child);
      return child as unknown as ReturnType<AgentProvider["spawn"]>;
    });
    const service = new AgentRuns(store, () => adapter(spawn), (prompt) => prompt);
    return { store, task, spawn, service };
  }

  const secondTask = (store: TaskStore, project: string) =>
    store.createTask({ project, title: "Second", spec: "Do the work", criteria: "Prove it" });

  it("queues beyond the active-run limit without spawning and promotes on settle", async () => {
    process.env.SABER_MAX_ACTIVE_RUNS = "1";
    const { store, task, spawn, service } = queueSetup();
    const second = secondTask(store, join(tmpdir(), "saber-queue-second"));
    const a = await service.start(task.id);
    const b = await service.start(second.id);
    expect(store.getRun(a)).toMatchObject({ status: "running" });
    expect(store.getRun(b)).toMatchObject({ status: "queued", launch: { followup: false } });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(store.events(b, 0).lines[0]).toContain("run_queued");
    const listed = annotateQueuePositions(store.listRuns());
    expect(listed.find((run) => run.id === b)?.queuePosition).toBe(1);
    children[0].emit("close", 0);
    await service.recoverQueued();
    expect(store.getRun(a)?.status).toBe("done");
    expect(store.getRun(b)?.status).toBe("running");
    expect(spawn.mock.calls[1][0]).toMatchObject({ workdir: second.project });
    expect(store.events(b, 0).lines.some((line) => line.includes("run_promoted"))).toBe(true);
    children[1].emit("close", 0);
    expect(store.getRun(b)?.status).toBe("done");
  });

  it("keeps strict FIFO order and rejects a second run for a queued workspace", async () => {
    process.env.SABER_MAX_ACTIVE_RUNS = "1";
    const { store, task, service } = queueSetup();
    const second = secondTask(store, join(tmpdir(), "saber-queue-b"));
    const third = secondTask(store, join(tmpdir(), "saber-queue-c"));
    const a = await service.start(task.id);
    const b = await service.start(second.id);
    await expect(service.start(second.id)).rejects.toThrow("A queued run already owns this workspace");
    const c = await service.start(third.id);
    expect(store.getRun(c)?.status).toBe("queued");
    const listed = annotateQueuePositions(store.listRuns());
    expect(listed.find((run) => run.id === b)?.queuePosition).toBe(1);
    expect(listed.find((run) => run.id === c)?.queuePosition).toBe(2);
    children[0].emit("close", 0);
    await service.recoverQueued();
    expect(store.getRun(b)?.status).toBe("running");
    expect(store.getRun(c)?.status).toBe("queued");
  });

  it("cancels a queued run without spawning and keeps queued distinct from settled states", async () => {
    process.env.SABER_MAX_ACTIVE_RUNS = "1";
    const { store, task, spawn, service } = queueSetup();
    const second = secondTask(store, join(tmpdir(), "saber-queue-cancel"));
    const a = await service.start(task.id);
    const b = await service.start(second.id);
    await service.stop(b);
    expect(store.getRun(b)).toMatchObject({ status: "stopped" });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(store.events(b, 0).lines.some((line) => line.includes("run_cancelled"))).toBe(true);
    expect(() => store.finishRun(b, "done", 0)).toThrow("Cannot change run from stopped");
    // Cancellation releases the workspace: a fresh request is accepted even while a stays active.
    const requeued = await service.start(second.id);
    expect(store.getRun(requeued)).toMatchObject({ status: "queued" });
    expect(spawn).toHaveBeenCalledTimes(1);
    children[0].emit("close", 0);
    await service.recoverQueued();
    expect(store.getRun(requeued)?.status).toBe("running");
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("recovers queued work after restart without duplicating launches or retrying interrupted runs", async () => {
    process.env.SABER_MAX_ACTIVE_RUNS = "1";
    const { store, task, spawn, service } = queueSetup();
    const second = secondTask(store, join(tmpdir(), "saber-queue-restart"));
    const a = await service.start(task.id);
    const b = await service.start(second.id);
    store.finishRun(a, "interrupted", null);
    const restarted = new AgentRuns(store, () => adapter(spawn), (prompt) => prompt);
    await restarted.recoverQueued();
    expect(store.getRun(a)?.status).toBe("interrupted");
    expect(store.getRun(b)?.status).toBe("running");
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn.mock.calls[1][0]).toMatchObject({ workdir: second.project });
    children[1].emit("close", 0);
    expect(store.getRun(b)?.status).toBe("done");
  });

  it("keeps a terminal-blocked queued run waiting while promoting other eligible work", async () => {
    process.env.SABER_MAX_ACTIVE_RUNS = "1";
    const { store, task, spawn } = queueSetup();
    const second = secondTask(store, join(tmpdir(), "saber-queue-blocked"));
    const third = secondTask(store, join(tmpdir(), "saber-queue-free"));
    // A terminal claiming a workspace after a run was accepted is not reachable
    // through the public guards; simulate that state to prove promotion waits.
    const locks = new FlippableLocks();
    const guarded = new AgentRuns(store, () => adapter(spawn), (prompt) => prompt, locks);
    const a = await guarded.start(task.id);
    const b = await guarded.start(second.id);
    const c = await guarded.start(third.id);
    expect(store.getRun(b)).toMatchObject({ status: "queued" });
    locks.blocked.add(second.project);
    children[0].emit("close", 0);
    await guarded.recoverQueued();
    expect(store.getRun(b)?.status).toBe("queued");
    expect(store.getRun(c)?.status).toBe("running");
    locks.blocked.clear();
    children[1].emit("close", 0);
    await guarded.recoverQueued();
    expect(store.getRun(b)?.status).toBe("running");
  });

  it("settles a promoted run as failed when its provider cannot spawn and keeps the queue moving", async () => {
    process.env.SABER_MAX_ACTIVE_RUNS = "1";
    const { store, task, spawn, service } = queueSetup();
    const second = secondTask(store, join(tmpdir(), "saber-queue-fail"));
    const third = secondTask(store, join(tmpdir(), "saber-queue-after"));
    const a = await service.start(task.id);
    const b = await service.start(second.id);
    const c = await service.start(third.id);
    spawn.mockImplementationOnce(() => { throw new Error("executable missing at promotion"); });
    children[0].emit("close", 0);
    await service.recoverQueued();
    expect(store.getRun(b)?.status).toBe("error");
    expect(store.getRun(c)?.status).toBe("running");
    expect(store.events(b, 0).lines.some((line) => line.includes("executable missing at promotion"))).toBe(true);
  });

  it("replays readOnly and followup launch options when promoting queued runs", async () => {
    process.env.SABER_MAX_ACTIVE_RUNS = "1";
    const { store, task, spawn, service } = queueSetup();
    const review = secondTask(store, join(tmpdir(), "saber-queue-readonly"));
    const a = await service.start(task.id);
    const readOnlyRun = await service.start(review.id, { readOnly: true });
    expect(store.getRun(readOnlyRun)).toMatchObject({ status: "queued", launch: { readOnly: true } });
    children[0].emit("close", 0);
    await service.recoverQueued();
    expect(spawn.mock.calls[1][0]).toMatchObject({ workdir: review.project, readOnly: true });
    children[1].emit("close", 0);
    await service.recoverQueued();

    const holder = secondTask(store, join(tmpdir(), "saber-queue-holder"));
    const hold = await service.start(holder.id);
    children[2].stdout.write(Buffer.from('{"sessionID":"captured-session","type":"step_start"}\n'));
    children[2].emit("close", 0);
    expect(store.getRun(hold)?.nativeSessionId).toBe("captured-session");

    const blocker = secondTask(store, join(tmpdir(), "saber-queue-blocker"));
    const blocking = await service.start(blocker.id);
    expect(store.getRun(blocking)?.status).toBe("running");

    const followup = await service.start(holder.id, { followup: "next instruction" });
    expect(store.getRun(followup)).toMatchObject({ status: "queued", launch: { followup: true } });
    children[3].emit("close", 0);
    await service.recoverQueued();
    expect(spawn.mock.calls[4][0]).toMatchObject({ session: "captured-session" });
    expect(spawn.mock.calls[4][0].task).toBe(store.getRun(followup)?.task);
  });
});
