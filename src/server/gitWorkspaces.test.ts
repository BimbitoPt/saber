import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { TaskStore } from "./taskStore";
import { GitWorkspaceService, taskWorkdir } from "./gitWorkspaces";
import { AgentRuns } from "./agentRuns";
import type { AgentProvider } from "./providers/types";

const fixtures: Array<{ root: string; store: TaskStore }> = [];
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
const savedOnyxDisabled = process.env.ONYX_DISABLED;
process.env.ONYX_DISABLED = "1";
afterEach(() => {
  for (const { root, store } of fixtures.splice(0)) { store.close(); rmSync(root, { recursive: true, force: true }); }
  if (savedOnyxDisabled === undefined) delete process.env.ONYX_DISABLED;
  else process.env.ONYX_DISABLED = savedOnyxDisabled;
});

function setup() {
  const root = mkdtempSync(join(tmpdir(), "saber-worktree-test-"));
  const source = join(root, "source");
  mkdirSync(source);
  git(source, "init", "-b", "main");
  git(source, "config", "user.email", "saber-test@example.invalid");
  git(source, "config", "user.name", "Saber Test");
  git(source, "config", "commit.gpgsign", "false");
  git(source, "config", "core.autocrlf", "false");
  writeFileSync(join(source, "tracked.txt"), "base\n");
  writeFileSync(join(source, ".gitignore"), "cache/\n");
  git(source, "add", ".");
  git(source, "commit", "-m", "base");
  const store = new TaskStore(":memory:");
  fixtures.push({ root, store });
  const makeTask = () => store.createTask({ project: source, title: "Isolation", spec: "Work", criteria: "Verify" });
  const task = makeTask();
  const service = new GitWorkspaceService(store, () => false, join(root, "managed"));
  return { root, source, store, task, service, makeTask };
}

describe("isolated task workspaces", { timeout: 30000 }, () => {
  it("creates and reuses a committed snapshot without copying source edits", () => {
    const { source, task, service } = setup();
    writeFileSync(join(source, "tracked.txt"), "unfinished source\n");
    writeFileSync(join(source, "private.txt"), "local\n");
    const isolated = service.create(task.id);
    expect(readFileSync(join(isolated.workspace!.path, "tracked.txt"), "utf8")).toBe("base\n");
    expect(existsSync(join(isolated.workspace!.path, "private.txt"))).toBe(false);
    expect(readFileSync(join(source, "tracked.txt"), "utf8")).toBe("unfinished source\n");
    expect((await service.create(task.id)).workspace).toEqual(isolated.workspace);
  });

  it("allows parallel runs in separate worktrees and blocks same-worktree runs", async () => {
    const { task, service, makeTask, store } = setup();
    const first = service.create(task.id);
    const second = service.create(makeTask().id);
    const spawn = vi.fn<AgentProvider["spawn"]>(() => Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() }) as unknown as ReturnType<AgentProvider["spawn"]>);
    const runs = new AgentRuns(store, () => ({ name: "codex", contextBudget: { maxPromptChars: 200_000, supportsProfileContext: true }, readOnly: { supported: true, args: [] }, args: () => [], spawn }), (prompt) => prompt);
    const a = await runs.start(first.id, { provider: "codex" });
    const b = await runs.start(second.id, { provider: "codex" });
    expect(store.getRun(a)?.project).toBe(first.workspace!.path);
    expect(store.getRun(b)?.project).toBe(second.workspace!.path);
    expect(spawn.mock.calls.map(([options]) => options.workdir)).toEqual([first.workspace!.path, second.workspace!.path]);
    await expect(runs.start(first.id)).rejects.toThrow("still closing");
    await expect(service.remove(first.id)).rejects.toThrow("running");
    store.finishRun(a, "interrupted", null);
    expect(() => store.createRun(first.id, "retry")).toThrow("interrupted");
  });

  it("never resumes native state from a previous checkout", async () => {
    const { store, task, service } = setup();
    const old = store.createRun(task.id, "old", undefined, "codex");
    store.setNativeSession(old.id, "source-session");
    store.finishRun(old.id, "done", 0);
    service.create(task.id);
    const spawn = vi.fn<AgentProvider["spawn"]>();
    const runs = new AgentRuns(store, () => ({ name: "codex", contextBudget: { maxPromptChars: 200_000, supportsProfileContext: true }, readOnly: { supported: true, args: [] }, args: () => [], spawn }), (prompt) => prompt);
    await expect(runs.start(task.id, { provider: "codex", followup: "continue" })).rejects.toThrow("No codex session");
    expect(spawn).not.toHaveBeenCalled();
    expect(store.getRun(old.id)?.project).toBe(task.project);
  });

  it("reviews tracked and untracked changes, rejects dirty or stale merges, and fast-forwards reviewed commits", () => {
    const { source, task, service } = setup();
    const workspace = service.create(task.id).workspace!;
    writeFileSync(join(workspace.path, "tracked.txt"), "task edit\n");
    writeFileSync(join(workspace.path, "new.txt"), "new\n");
    const before = service.review(task.id);
    expect(before.diff).toContain("+task edit");
    expect(before.status).toContain("new.txt");
    expect(() => service.merge(task.id, before.head)).toThrow("Commit task changes");
    git(workspace.path, "add", "."); git(workspace.path, "commit", "-m", "task change");
    expect(() => service.merge(task.id, before.head)).toThrow("stale");
    const review = service.review(task.id);
    writeFileSync(join(source, "local.txt"), "keep");
    expect(() => service.merge(task.id, review.head)).toThrow("Source checkout has local changes");
    rmSync(join(source, "local.txt"));
    service.merge(task.id, review.head);
    expect(git(source, "rev-parse", "HEAD")).toBe(review.head);
    expect(readFileSync(join(source, "new.txt"), "utf8")).toBe("new\n");
  });

  it("rejects non-fast-forward histories without modifying either branch", () => {
    const { source, task, service } = setup();
    const workspace = service.create(task.id).workspace!;
    writeFileSync(join(workspace.path, "task.txt"), "task");
    git(workspace.path, "add", "."); git(workspace.path, "commit", "-m", "task");
    writeFileSync(join(source, "source.txt"), "source");
    git(source, "add", "."); git(source, "commit", "-m", "source");
    const before = git(source, "rev-parse", "HEAD");
    expect(() => service.merge(task.id, service.review(task.id).head)).toThrow("Git operation failed");
    expect(git(source, "rev-parse", "HEAD")).toBe(before);
  });

  it("does not overwrite ignored source files during merge", () => {
    const { source, task, service } = setup();
    const workspace = service.create(task.id).workspace!;
    mkdirSync(join(source, "cache")); writeFileSync(join(source, "cache", "local.txt"), "preserve me");
    mkdirSync(join(workspace.path, "cache")); writeFileSync(join(workspace.path, "cache", "local.txt"), "incoming");
    git(workspace.path, "add", "-f", "cache/local.txt"); git(workspace.path, "commit", "-m", "tracked cache");
    expect(() => service.merge(task.id, service.review(task.id).head)).toThrow("Git operation failed");
    expect(readFileSync(join(source, "cache", "local.txt"), "utf8")).toBe("preserve me");
  });

  it("refuses ignored files during cleanup and preserves branch and history on removal", () => {
    const { source, task, service, store } = setup();
    const workspace = service.create(task.id).workspace!;
    mkdirSync(join(workspace.path, "cache")); writeFileSync(join(workspace.path, "cache", "keep"), "data");
    expect(() => service.remove(task.id)).toThrow("ignored files");
    expect(existsSync(join(workspace.path, "cache", "keep"))).toBe(true);
    rmSync(join(workspace.path, "cache"), { recursive: true });
    const run = store.createRun(task.id, "history"); store.finishRun(run.id, "done", 0);
    const removed = service.remove(task.id);
    expect(removed.workspace?.state).toBe("removed");
    expect(existsSync(workspace.path)).toBe(false);
    expect(git(source, "rev-parse", workspace.branch)).toBe(workspace.baseCommit);
    expect(store.getRun(run.id)?.project).toBe(workspace.path);
    await expect(taskWorkdir(removed)).rejects.toThrow("not ready");
  });

  it("rejects non-Git tasks and missing or changed workspaces", () => {
    const { root, store, task, service } = setup();
    const nonGit = store.createTask({ project: root, title: "Plain", spec: "work", criteria: "check" });
    expect(() => service.create(nonGit.id)).toThrow("Git operation failed");
    const isolated = service.create(task.id);
    git(isolated.workspace!.path, "checkout", "--detach");
    await expect(taskWorkdir(isolated)).rejects.toThrow("Git operation failed");
    git(isolated.workspace!.path, "checkout", isolated.workspace!.branch);
    git(isolated.workspace!.source, "worktree", "remove", isolated.workspace!.path);
    await expect(taskWorkdir(isolated)).rejects.toThrow("missing");
  });
});

describe("per-run member worktrees", { timeout: 30000 }, () => {
  it("provisions isolated run worktrees, reviews, and merges with cleanup", () => {
    const { source, task, service, store } = setup();
    const first = service.createRunWorktree(task.id, "run-aaa");
    const second = service.createRunWorktree(task.id, "run-bbb");
    expect(first.path).not.toBe(second.path);
    expect(first.branch).not.toBe(second.branch);
    expect(first.baseCommit).toBe(second.baseCommit);
    writeFileSync(join(first.path, "member.txt"), "member work\n");
    git(first.path, "add", ".");
    git(first.path, "commit", "-m", "member change");
    const review = service.reviewRunWorktree(task.id, "run-aaa");
    expect(review.branch).toBe(first.branch);
    expect(review.diff).toContain("member work");
    const merged = service.mergeRunWorktree(task.id, "run-aaa", review.head);
    expect(merged).toMatchObject({ ok: true, head: review.head, cleanedUp: true });
    expect(readFileSync(join(source, "member.txt"), "utf8")).toBe("member work\n");
    expect(existsSync(first.path)).toBe(false);
    expect(store.getRunWorktree("run-aaa")?.state).toBe("removed");
    expect(existsSync(second.path)).toBe(true);
    const removed = service.removeRunWorktree(task.id, "run-bbb");
    expect(removed.state).toBe("removed");
    expect(existsSync(second.path)).toBe(false);
  });

  it("rejects stale heads and dirty worktrees on member merge", () => {
    const { task, service } = setup();
    const record = service.createRunWorktree(task.id, "run-ccc");
    writeFileSync(join(record.path, "draft.txt"), "uncommitted\n");
    expect(() => service.mergeRunWorktree(task.id, "run-ccc", "0".repeat(40))).toThrow("stale");
    const head = git(record.path, "rev-parse", "HEAD");
    expect(() => service.mergeRunWorktree(task.id, "run-ccc", head)).toThrow("Commit task changes");
    expect(() => service.reviewRunWorktree(task.id, "missing-run")).toThrow("not found");
    expect(() => service.mergeRunWorktree("missing-task", "run-ccc", head)).toThrow("Task not found");
  });
});

