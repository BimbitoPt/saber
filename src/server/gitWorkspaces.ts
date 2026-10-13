import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, realpathSync } from "node:fs";

const execFileAsync = promisify(execFile);
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { TaskRecord, TaskWorkspaceRecord, WorkspaceReview, RunWorktreeRecord } from "../lib/tasks";
import { TaskStore } from "./taskStore";
import { workspacesOverlap } from "./workspaceIdentity";

const managedRoot = () => join(process.env.SABER_DATA_DIR ?? join(homedir(), ".saber"), "worktrees");
const canonical = (path: string) => {
  const result = existsSync(path) ? realpathSync(path) : resolve(path);
  return process.platform === "win32" ? result.toLowerCase() : result;
};

type GitCommandResult = { stdout: string; stderr: string; code: number };

async function runGitCommand(cwd: string, args: string[], signal?: AbortSignal): Promise<GitCommandResult> {
  try {
    const result = await execFileAsync("git", ["-C", cwd, ...args], {
      encoding: "utf8", windowsHide: true, timeout: 15000, maxBuffer: 2 * 1024 * 1024, signal,
    });
    return { stdout: result.stdout, stderr: result.stderr, code: 0 };
  } catch (error) {
    const failure = error as { stderr?: string; code?: string | number };
    if (signal?.aborted) throw new Error("Git operation was cancelled");
    if (failure.code === "ENOBUFS") throw new Error("Git output is too large to review in Saber. Review it locally.");
    throw new Error(`Git operation failed: ${String(failure.stderr || failure.code || error).slice(0, 1500)}`);
  }
}

async function git(cwd: string, args: string[], signal?: AbortSignal): Promise<string> {
  return (await runGitCommand(cwd, args, signal)).stdout.trimEnd();
}

async function assertWorkspace(workspace: TaskWorkspaceRecord, signal?: AbortSignal) {
  if (workspace.state !== "ready") throw new Error("Task workspace is not ready. Create or recover it before launching.");
  if (!existsSync(workspace.path)) throw new Error("Task workspace is missing. Restore it before launching; Saber will not use the source checkout.");
  if (canonical(await git(workspace.path, ["rev-parse", "--show-toplevel"], signal)) !== canonical(workspace.path)) throw new Error("Workspace root changed");
  if (await git(workspace.path, ["symbolic-ref", "--short", "HEAD"], signal) !== workspace.branch) throw new Error("Workspace branch changed. Restore the task branch first.");
  if (canonical(await git(workspace.path, ["rev-parse", "--path-format=absolute", "--git-common-dir"], signal)) !== canonical(await git(workspace.source, ["rev-parse", "--path-format=absolute", "--git-common-dir"], signal))) throw new Error("Workspace repository changed");
}

export async function taskWorkdir(task: TaskRecord, signal?: AbortSignal) {
  if (!task.workspace) return task.project;
  await assertWorkspace(task.workspace, signal);
  return task.workspace.path;
}

export async function taskSourceRoot(task: TaskRecord, signal?: AbortSignal) {
  if (task.workspace) {
    if (task.workspace.state !== "ready") throw new Error("Task workspace is not ready. Create or recover it before launching.");
    await assertWorkspace(task.workspace, signal);
    return task.workspace.source;
  }
  const source = realpathSync(await git(task.project, ["rev-parse", "--show-toplevel"], signal));
  if (canonical(source) !== canonical(task.project)) throw new Error("Use the Git checkout root as the task project to create a worktree");
  return source;
}

export class GitWorkspaceService {
  constructor(private store: TaskStore, private active: (path: string) => boolean = () => false, private root = managedRoot(), private signal?: AbortSignal) {}

  private task(id: string) {
    const task = this.store.getTask(id);
    if (!task) throw new Error("Task not found");
    return task;
  }

  private idle(paths: string[]) {
    if (paths.some((path) => this.active(path) || this.store.listRuns().some((run) =>
      ["running", "interrupted"].includes(run.status) && workspacesOverlap(run.project, path)))) {
      throw new Error("Workspace has a running, closing, or interrupted process. Stop or reconcile it first.");
    }
  }

  private owned(task: TaskRecord) {
    const workspace = task.workspace;
    if (!workspace) throw new Error("Create an isolated workspace first");
    if (canonical(workspace.path) !== canonical(join(this.root, task.id))) throw new Error("Workspace is outside its managed location");
    return workspace;
  }

  async create(id: string) {
    const task = this.task(id);
    this.idle([task.project, ...(task.workspace ? [task.workspace.path] : [])]);
    if (task.workspace?.state === "removed") throw new Error("This workspace was removed. Create a new task to continue; the branch and history are preserved.");
    if (task.workspace?.state === "ready") { this.owned(task); await assertWorkspace(task.workspace, this.signal); return task; }
    let workspace = task.workspace;
    if (!workspace) {
      const source = realpathSync(await git(task.project, ["rev-parse", "--show-toplevel"], this.signal));
      if (canonical(source) !== canonical(task.project)) throw new Error("Use the Git checkout root as the task project to create a worktree");
      const baseCommit = await git(source, ["rev-parse", "--verify", "HEAD^{commit}"], this.signal);
      const targetBranch = await git(source, ["symbolic-ref", "--short", "HEAD"], this.signal);
      mkdirSync(this.root, { recursive: true });
      workspace = { source, path: join(realpathSync(this.root), task.id), baseCommit, targetBranch,
        branch: `codex/saber-${task.id}`, state: "provisioning" };
      this.store.setWorkspace(id, workspace);
    }
    this.owned({ ...task, workspace });
    if (!existsSync(workspace.path)) {
      const registered = await git(workspace.source, ["worktree", "list", "--porcelain"], this.signal);
      if (registered.split("\n").some((line) => line.startsWith("worktree ") && canonical(line.slice(9)) === canonical(workspace.path))) {
        throw new Error("A registered workspace is missing. Restore it or repair its Git registration before retrying.");
      }
      const existing = await git(workspace.source, ["branch", "--list", workspace.branch], this.signal);
      if (existing) {
        if (await git(workspace.source, ["rev-parse", workspace.branch], this.signal) !== workspace.baseCommit) throw new Error("Recovery branch has changes. Restore its worktree manually to preserve them.");
        await git(workspace.source, ["worktree", "add", "--", workspace.path, workspace.branch], this.signal);
      } else {
        await git(workspace.source, ["worktree", "add", "-b", workspace.branch, "--", workspace.path, workspace.baseCommit], this.signal);
      }
    }
    const ready = { ...workspace, state: "ready" as const };
    await assertWorkspace(ready, this.signal);
    return this.store.setWorkspace(id, ready);
  }

  async review(id: string): Promise<WorkspaceReview> {
    const task = this.task(id);
    const workspace = this.owned(task);
    this.idle([workspace.path]);
    await assertWorkspace(workspace, this.signal);
    return {
      head: await git(workspace.path, ["rev-parse", "HEAD"], this.signal), branch: workspace.branch,
      status: await git(workspace.path, ["status", "--short", "--untracked-files=all"], this.signal),
      diff: await git(workspace.path, ["diff", "--no-ext-diff", "--no-textconv", workspace.baseCommit, "--"], this.signal),
    };
  }

  async merge(id: string, head: string) {
    const task = this.task(id);
    const workspace = this.owned(task);
    this.idle([workspace.source, workspace.path]);
    await assertWorkspace(workspace, this.signal);
    if (!/^[a-f0-9]{40,64}$/.test(head) || await git(workspace.path, ["rev-parse", "HEAD"], this.signal) !== head) throw new Error("Review is stale. Refresh changes before merging.");
    if (await git(workspace.path, ["status", "--porcelain", "--untracked-files=all"], this.signal)) throw new Error("Commit task changes and review again before merging");
    if (await git(workspace.source, ["symbolic-ref", "--short", "HEAD"], this.signal) !== workspace.targetBranch) throw new Error("Source branch changed. Restore the target branch before merging.");
    if (await git(workspace.source, ["status", "--porcelain", "--untracked-files=all"], this.signal)) throw new Error("Source checkout has local changes. Preserve them before merging.");
    await git(workspace.source, ["merge", "--ff-only", "--no-edit", "--no-overwrite-ignore", head], this.signal);
    return task;
  }

  async remove(id: string) {
    const task = this.task(id);
    const workspace = this.owned(task);
    this.idle([workspace.path]);
    if (workspace.state === "removed") return task;
    if (existsSync(workspace.path)) {
      await assertWorkspace(workspace, this.signal);
      if (await git(workspace.path, ["status", "--porcelain", "--untracked-files=all", "--ignored"], this.signal)) throw new Error("Workspace contains local or ignored files. Preserve them before removing it.");
      await git(workspace.source, ["worktree", "remove", "--", workspace.path], this.signal);
    } else {
      const registered = await git(workspace.source, ["worktree", "list", "--porcelain"], this.signal);
      if (registered.split("\n").some((line) => line.startsWith("worktree ") && canonical(line.slice(9)) === canonical(workspace.path))) throw new Error("Missing workspace is still registered. Restore it before removing it.");
    }
    return this.store.setWorkspace(id, { ...workspace, state: "removed" });
  }

  runWorktreePath(taskId: string, runId: string) {
    return canonical(join(this.root, taskId, "runs", runId));
  }

  private async assertRunWorktree(record: RunWorktreeRecord, signal?: AbortSignal) {
    if (canonical(await git(record.path, ["rev-parse", "--show-toplevel"], signal)) !== canonical(record.path)) throw new Error("Workspace root changed");
    if (await git(record.path, ["symbolic-ref", "--short", "HEAD"], signal) !== record.branch) throw new Error("Workspace branch changed. Restore the task branch first.");
    if (canonical(await git(record.path, ["rev-parse", "--path-format=absolute", "--git-common-dir"], signal)) !== canonical(await git(record.source, ["rev-parse", "--path-format=absolute", "--git-common-dir"], signal))) throw new Error("Workspace repository changed");
  }

  async createRunWorktree(taskId: string, runId: string) {
    const task = this.task(taskId);
    const source = await taskSourceRoot(task, this.signal);
    this.idle([task.project, source]);
    const baseCommit = await git(source, ["rev-parse", "--verify", "HEAD^{commit}"], this.signal);
    const sourceBranch = await git(source, ["symbolic-ref", "--short", "HEAD"], this.signal);
    const branch = `saber/${task.id.slice(0, 8)}/${runId.slice(0, 8)}`;
    const path = this.runWorktreePath(task.id, runId);
    mkdirSync(join(this.root, task.id, "runs"), { recursive: true });
    if (!existsSync(path)) {
      const registered = await git(source, ["worktree", "list", "--porcelain"], this.signal);
      if (registered.split("\n").some((line) => line.startsWith("worktree ") && canonical(line.slice(9)) === canonical(path))) {
        throw new Error("A registered workspace is missing. Restore it or repair its Git registration before retrying.");
      }
      const existing = await git(source, ["branch", "--list", branch], this.signal);
      if (existing) {
        if (await git(source, ["rev-parse", branch], this.signal) !== baseCommit) throw new Error("Recovery branch has changes. Restore its worktree manually to preserve them.");
        await git(source, ["worktree", "add", "--", path, branch], this.signal);
      } else {
        await git(source, ["worktree", "add", "-b", branch, "--", path, baseCommit], this.signal);
      }
    }
    const record: RunWorktreeRecord = { runId, taskId: task.id, path, source, sourceBranch, baseCommit, branch, state: "ready" };
    await this.assertRunWorktree(record, this.signal);
    return this.store.createRunWorktree(record);
  }

  async removeRunWorktree(taskId: string, runId: string) {
    const task = this.task(taskId);
    const record = this.store.getRunWorktree(runId);
    if (!record || record.taskId !== task.id) throw new Error("Run worktree not found");
    if (canonical(record.path) !== this.runWorktreePath(task.id, runId)) throw new Error("Workspace is outside its managed location");
    if (record.state === "removed") return record;
    this.idle([record.path]);
    if (existsSync(record.path)) {
      await this.assertRunWorktree(record, this.signal);
      if (await git(record.path, ["status", "--porcelain", "--untracked-files=all", "--ignored"], this.signal)) throw new Error("Workspace contains local or ignored files. Preserve them before removing it.");
      await git(record.source, ["worktree", "remove", "--", record.path], this.signal);
    } else {
      const registered = await git(record.source, ["worktree", "list", "--porcelain"], this.signal);
      if (registered.split("\n").some((line) => line.startsWith("worktree ") && canonical(line.slice(9)) === canonical(record.path))) throw new Error("Missing workspace is still registered. Restore it before removing it.");
    }
    return this.store.writeRunWorktree({ ...record, state: "removed" });
  }

  async reviewRunWorktree(taskId: string, runId: string): Promise<WorkspaceReview> {
    const task = this.task(taskId);
    const record = this.store.getRunWorktree(runId);
    if (!record || record.taskId !== task.id) throw new Error("Run worktree not found");
    if (record.state !== "ready") throw new Error("Run worktree is not ready");
    this.idle([record.path]);
    await this.assertRunWorktree(record, this.signal);
    return {
      head: await git(record.path, ["rev-parse", "HEAD"], this.signal), branch: record.branch,
      status: await git(record.path, ["status", "--short", "--untracked-files=all"], this.signal),
      diff: await git(record.path, ["diff", "--no-ext-diff", "--no-textconv", record.baseCommit, "--"], this.signal),
    };
  }

  async mergeRunWorktree(taskId: string, runId: string, head: string) {
    const task = this.task(taskId);
    const record = this.store.getRunWorktree(runId);
    if (!record || record.taskId !== task.id) throw new Error("Run worktree not found");
    if (record.state !== "ready") throw new Error("Run worktree is not ready");
    if (canonical(record.path) !== this.runWorktreePath(task.id, runId)) throw new Error("Workspace is outside its managed location");
    this.idle([record.source, record.path]);
    await this.assertRunWorktree(record, this.signal);
    if (!/^[a-f0-9]{40,64}$/.test(head) || await git(record.path, ["rev-parse", "HEAD"], this.signal) !== head) throw new Error("Review is stale. Refresh changes before merging.");
    if (await git(record.path, ["status", "--porcelain", "--untracked-files=all"], this.signal)) throw new Error("Commit task changes and review again before merging");
    if (await git(record.source, ["symbolic-ref", "--short", "HEAD"], this.signal) !== record.sourceBranch) throw new Error("Source branch changed. Restore the target branch before merging.");
    if (await git(record.source, ["status", "--porcelain", "--untracked-files=all"], this.signal)) throw new Error("Source checkout has local changes. Preserve them before merging.");
    await git(record.source, ["merge", "--ff-only", "--no-edit", "--no-overwrite-ignore", head], this.signal);
    let cleanedUp = true;
    try {
      await this.removeRunWorktree(taskId, runId);
    } catch {
      cleanedUp = false;
    }
    return { ok: true as const, head, cleanedUp };
  }
}
