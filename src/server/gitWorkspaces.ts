import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { TaskRecord, TaskWorkspaceRecord, WorkspaceReview } from "../lib/tasks";
import { TaskStore } from "./taskStore";
import { workspacesOverlap } from "./workspaceIdentity";

const managedRoot = () => join(process.env.SABER_DATA_DIR ?? join(homedir(), ".saber"), "worktrees");
const canonical = (path: string) => {
  const result = existsSync(path) ? realpathSync(path) : resolve(path);
  return process.platform === "win32" ? result.toLowerCase() : result;
};

function git(cwd: string, args: string[]) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8", windowsHide: true, timeout: 15000, maxBuffer: 2 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }).trimEnd();
  } catch (error) {
    const failure = error as { stderr?: string; code?: string };
    throw new Error(failure.code === "ENOBUFS" ? "Git output is too large to review in Saber. Review it locally."
      : `Git operation failed: ${String(failure.stderr || failure.code || error).slice(0, 1500)}`);
  }
}

function assertWorkspace(workspace: TaskWorkspaceRecord) {
  if (workspace.state !== "ready") throw new Error("Task workspace is not ready. Create or recover it before launching.");
  if (!existsSync(workspace.path)) throw new Error("Task workspace is missing. Restore it before launching; Saber will not use the source checkout.");
  if (canonical(git(workspace.path, ["rev-parse", "--show-toplevel"])) !== canonical(workspace.path)) throw new Error("Workspace root changed");
  if (git(workspace.path, ["symbolic-ref", "--short", "HEAD"]) !== workspace.branch) throw new Error("Workspace branch changed. Restore the task branch first.");
  if (canonical(git(workspace.path, ["rev-parse", "--path-format=absolute", "--git-common-dir"])) !== canonical(git(workspace.source, ["rev-parse", "--path-format=absolute", "--git-common-dir"]))) throw new Error("Workspace repository changed");
}

export function taskWorkdir(task: TaskRecord) {
  if (!task.workspace) return task.project;
  assertWorkspace(task.workspace);
  return task.workspace.path;
}

export class GitWorkspaceService {
  constructor(private store: TaskStore, private active: (path: string) => boolean = () => false, private root = managedRoot()) {}

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

  create(id: string) {
    const task = this.task(id);
    this.idle([task.project, ...(task.workspace ? [task.workspace.path] : [])]);
    if (task.workspace?.state === "removed") throw new Error("This workspace was removed. Create a new task to continue; the branch and history are preserved.");
    if (task.workspace?.state === "ready") { this.owned(task); assertWorkspace(task.workspace); return task; }
    let workspace = task.workspace;
    if (!workspace) {
      const source = realpathSync(git(task.project, ["rev-parse", "--show-toplevel"]));
      if (canonical(source) !== canonical(task.project)) throw new Error("Use the Git checkout root as the task project to create a worktree");
      const baseCommit = git(source, ["rev-parse", "--verify", "HEAD^{commit}"]);
      const targetBranch = git(source, ["symbolic-ref", "--short", "HEAD"]);
      mkdirSync(this.root, { recursive: true });
      workspace = { source, path: join(realpathSync(this.root), task.id), baseCommit, targetBranch,
        branch: `codex/saber-${task.id}`, state: "provisioning" };
      this.store.setWorkspace(id, workspace);
    }
    this.owned({ ...task, workspace });
    if (!existsSync(workspace.path)) {
      const registered = git(workspace.source, ["worktree", "list", "--porcelain"]);
      if (registered.split("\n").some((line) => line.startsWith("worktree ") && canonical(line.slice(9)) === canonical(workspace.path))) {
        throw new Error("A registered workspace is missing. Restore it or repair its Git registration before retrying.");
      }
      const existing = git(workspace.source, ["branch", "--list", workspace.branch]);
      if (existing) {
        if (git(workspace.source, ["rev-parse", workspace.branch]) !== workspace.baseCommit) throw new Error("Recovery branch has changes. Restore its worktree manually to preserve them.");
        git(workspace.source, ["worktree", "add", "--", workspace.path, workspace.branch]);
      } else {
        git(workspace.source, ["worktree", "add", "-b", workspace.branch, "--", workspace.path, workspace.baseCommit]);
      }
    }
    const ready = { ...workspace, state: "ready" as const };
    assertWorkspace(ready);
    return this.store.setWorkspace(id, ready);
  }

  review(id: string): WorkspaceReview {
    const task = this.task(id);
    const workspace = this.owned(task);
    this.idle([workspace.path]);
    assertWorkspace(workspace);
    return {
      head: git(workspace.path, ["rev-parse", "HEAD"]), branch: workspace.branch,
      status: git(workspace.path, ["status", "--short", "--untracked-files=all"]),
      diff: git(workspace.path, ["diff", "--no-ext-diff", "--no-textconv", workspace.baseCommit, "--"]),
    };
  }

  merge(id: string, head: string) {
    const task = this.task(id);
    const workspace = this.owned(task);
    this.idle([workspace.source, workspace.path]);
    assertWorkspace(workspace);
    if (!/^[a-f0-9]{40,64}$/.test(head) || git(workspace.path, ["rev-parse", "HEAD"]) !== head) throw new Error("Review is stale. Refresh changes before merging.");
    if (git(workspace.path, ["status", "--porcelain", "--untracked-files=all"])) throw new Error("Commit task changes and review again before merging");
    if (git(workspace.source, ["symbolic-ref", "--short", "HEAD"]) !== workspace.targetBranch) throw new Error("Source branch changed. Restore the target branch before merging.");
    if (git(workspace.source, ["status", "--porcelain", "--untracked-files=all"])) throw new Error("Source checkout has local changes. Preserve them before merging.");
    git(workspace.source, ["merge", "--ff-only", "--no-edit", "--no-overwrite-ignore", head]);
    return task;
  }

  remove(id: string) {
    const task = this.task(id);
    const workspace = this.owned(task);
    this.idle([workspace.path]);
    if (workspace.state === "removed") return task;
    if (existsSync(workspace.path)) {
      assertWorkspace(workspace);
      if (git(workspace.path, ["status", "--porcelain", "--untracked-files=all", "--ignored"])) throw new Error("Workspace contains local or ignored files. Preserve them before removing it.");
      git(workspace.source, ["worktree", "remove", "--", workspace.path]);
    } else {
      const registered = git(workspace.source, ["worktree", "list", "--porcelain"]);
      if (registered.split("\n").some((line) => line.startsWith("worktree ") && canonical(line.slice(9)) === canonical(workspace.path))) throw new Error("Missing workspace is still registered. Restore it before removing it.");
    }
    return this.store.setWorkspace(id, { ...workspace, state: "removed" });
  }
}
