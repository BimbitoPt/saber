import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { PassThrough } from "node:stream";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "./taskStore";
import { AgentRuns } from "./agentRuns";
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
