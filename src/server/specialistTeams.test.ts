import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { TaskStore } from "./taskStore";
import { SpecialistTeams } from "./specialistTeams";
import { ProjectProfiles } from "./projectProfiles";
import { AgentRuns } from "./agentRuns";
import { GitWorkspaceService } from "./gitWorkspaces";
import { TerminalLocks } from "./terminalLocks";
import type { AgentProvider } from "./providers/types";

const stores: TaskStore[] = [];
const directories: string[] = [];
const savedOnyxDisabled = process.env.ONYX_DISABLED;
process.env.ONYX_DISABLED = "1";
afterEach(() => {
  stores.splice(0).forEach((store) => store.close());
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
  if (savedOnyxDisabled === undefined) delete process.env.ONYX_DISABLED;
  else process.env.ONYX_DISABLED = savedOnyxDisabled;
  delete process.env.ONYX_BASE_URL;
});

function setup() {
  const store = new TaskStore(":memory:");
  stores.push(store);
  const directory = mkdtempSync(join(tmpdir(), "saber-roles-"));
  directories.push(directory);
  writeFileSync(join(directory, "AGENTS.md"), "Stack: Bun.");
  const teams = new SpecialistTeams(store);
  const profiles = new ProjectProfiles(store);
  profiles.registerProject(directory);
  return { store, directory, teams, profiles };
}

function approveFirst(directory: string, profiles: ProjectProfiles) {
  return profiles.approveRevision(profiles.discoverDraft(directory).id);
}

describe("specialist roles", () => {
  it("seeds implementer and reviewer roles once an approved profile exists", () => {
    const { directory, teams, profiles } = setup();
    expect(teams.listRoles(directory)).toEqual([]);
    const approved = approveFirst(directory, profiles);
    const seeded = teams.listRoles(directory);
    expect(seeded.map((role) => role.id)).toEqual(["implementer", "reviewer"]);
    expect(seeded[0]).toMatchObject({ write: true, enabled: true, basedOnProfileRevisionId: approved.id });
    expect(seeded[0].providers).toEqual(["opencode", "codex", "claude"]);
    expect(seeded[1]).toMatchObject({ write: false, enabled: true, basedOnProfileRevisionId: approved.id });
    expect(seeded[1].providers).toEqual(["claude", "codex"]);
    expect(teams.listRoles(directory)).toHaveLength(2);
  });

  it("rejects duplicate, invalid, and unknown-provider roles", () => {
    const { directory, teams, profiles } = setup();
    approveFirst(directory, profiles);
    teams.listRoles(directory);
    expect(() => teams.createRole(directory, { id: "implementer", displayName: "Dup", instructions: "x", write: true, providers: ["opencode"] })).toThrow("already exists");
    expect(() => teams.createRole(directory, { id: "  ", displayName: "Empty", instructions: "x", write: true, providers: ["opencode"] })).toThrow("Role ID is required");
    expect(() => teams.createRole(directory, { id: "x".repeat(101), displayName: "Long", instructions: "x", write: true, providers: ["opencode"] })).toThrow("too long");
    expect(() => teams.createRole(directory, { id: "custom", displayName: "", instructions: "x", write: true, providers: ["opencode"] })).toThrow("display name");
    expect(() => teams.createRole(directory, { id: "custom", displayName: "Custom", instructions: "  ", write: true, providers: ["opencode"] })).toThrow("instructions");
    expect(() => teams.createRole(directory, { id: "custom", displayName: "Custom", instructions: "x", write: "yes", providers: ["opencode"] })).toThrow("write flag");
    expect(() => teams.createRole(directory, { id: "custom", displayName: "Custom", instructions: "x", write: false, providers: [] })).toThrow("At least one provider");
    expect(() => teams.createRole(directory, { id: "custom", displayName: "Custom", instructions: "x", write: false, providers: ["sms"] })).toThrow("Unknown provider");
    expect(teams.createRole(directory, { id: "custom", displayName: "Custom", instructions: "x", write: false, providers: ["opencode"] })).toMatchObject({ id: "custom", enabled: true });
  });

  it("updates and disables roles without touching other definitions", () => {
    const { directory, teams, profiles } = setup();
    approveFirst(directory, profiles);
    teams.listRoles(directory);
    const updated = teams.updateRole(directory, "reviewer", { instructions: "Review carefully.", providers: ["claude"], enabled: false });
    expect(updated).toMatchObject({ instructions: "Review carefully.", enabled: false });
    expect(teams.listRoles(directory).find((role) => role.id === "implementer")).toMatchObject({ enabled: true });
    expect(() => teams.updateRole(directory, "ghost", { enabled: false })).toThrow("Role not found");
    expect(() => teams.updateRole(directory, "reviewer", { providers: ["pager"] })).toThrow("Unknown provider");
  });

  it("requires a registered project", () => {
    const store = new TaskStore(":memory:");
    stores.push(store);
    const teams = new SpecialistTeams(store);
    expect(() => teams.listRoles("C:/missing-project")).toThrow("Project not found");
    expect(() => teams.createRole("C:/missing-project", { id: "r", displayName: "R", instructions: "x", write: true, providers: ["opencode"] })).toThrow("Project not found");
  });
});

const teamGit = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), "saber-team-"));
  directories.push(root);
  const source = join(root, "source");
  mkdirSync(source);
  teamGit(source, "init", "-b", "main");
  teamGit(source, "config", "user.email", "saber-test@example.invalid");
  teamGit(source, "config", "user.name", "Saber Test");
  teamGit(source, "config", "commit.gpgsign", "false");
  writeFileSync(join(source, "AGENTS.md"), "Stack: Bun.");
  writeFileSync(join(source, "tracked.txt"), "base\n");
  teamGit(source, "add", ".");
  teamGit(source, "commit", "-m", "base");
  return { root, source };
}

function makeChild() {
  return Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => true) });
}

function teamSetup(source: string, root: string, spawnImpl?: (opts: unknown) => unknown, providerImpl?: (name?: string) => AgentProvider) {
  const store = new TaskStore(":memory:");
  stores.push(store);
  const task = store.createTask({ project: source, title: "Team", spec: "Work", criteria: "Done" });
  const profiles = new ProjectProfiles(store);
  profiles.registerProject(source);
  profiles.approveRevision(profiles.discoverDraft(source).id);
  const spawn = vi.fn<AgentProvider["spawn"]>((opts) => (spawnImpl?.(opts) ?? makeChild()) as ReturnType<AgentProvider["spawn"]>);
  const stub = (name = "opencode"): AgentProvider => providerImpl?.(name) ?? ({
    name, contextBudget: { maxPromptChars: 200_000, supportsProfileContext: true },
    readOnly: { supported: true, args: ["--read-only"] }, args: () => [], spawn,
  });
  const locks = new TerminalLocks();
  const agentRuns = new AgentRuns(store, stub, (prompt) => prompt, locks);
  const workspaces = new GitWorkspaceService(store, () => false, join(root, "managed"));
  const teams = new SpecialistTeams(store, stub, locks).withServices(agentRuns, workspaces);
  teams.listRoles(source);
  return { store, task, teams, spawn, profiles };
}

describe("specialist team launch", { timeout: 30000 }, () => {
  it("validates selection size, implementer rule, and role state", () => {
    const { root, source } = makeRepo();
    const { task, teams } = teamSetup(source, root);
    expect(() => teams.planTeam(task.id, [])).toThrow("at least one");
    expect(() => teams.planTeam(task.id, [
      { role: "implementer", provider: "opencode" }, { role: "reviewer", provider: "claude" },
      { role: "implementer", provider: "codex" }, { role: "reviewer", provider: "claude" },
      { role: "implementer", provider: "opencode" },
    ])).toThrow("at most 4");
    expect(() => teams.planTeam(task.id, [{ role: "reviewer", provider: "claude" }])).not.toThrow();
    expect(() => teams.planTeam(task.id, [{ role: "implementer", provider: "opencode" }])).not.toThrow();
    teams.updateRole(source, "implementer", { enabled: false });
    expect(() => teams.planTeam(task.id, [{ role: "implementer", provider: "opencode" }])).toThrow("disabled");
    expect(() => teams.planTeam(task.id, [{ role: "ghost", provider: "opencode" }])).toThrow("Role not found");
    expect(() => teams.planTeam(task.id, [{ role: "reviewer", provider: "sms" }])).toThrow("Unknown provider");
    expect(() => teams.planTeam("missing-task", [{ role: "reviewer", provider: "claude" }])).toThrow("Task not found");
  });

  it("requires the implementer when any member edits and honors read-only support", () => {
    const { root, source } = makeRepo();
    const { task, teams, store } = teamSetup(source, root);
    teams.createRole(source, { id: "writer", displayName: "Writer", instructions: "Write.", write: true, providers: ["opencode"] });
    expect(() => teams.planTeam(task.id, [{ role: "writer", provider: "opencode" }])).toThrow("implementer");
    expect(() => teams.planTeam(task.id, [
      { role: "writer", provider: "opencode" }, { role: "implementer", provider: "opencode" },
    ])).not.toThrow();
    const realTeams = new SpecialistTeams(store);
    teams.createRole(source, { id: "observer", displayName: "Observer", instructions: "Observe.", write: false, providers: ["opencode", "claude"] });
    expect(() => realTeams.planTeam(task.id, [{ role: "observer", provider: "opencode" }])).toThrow("cannot review");
    expect(realTeams.planTeam(task.id, [{ role: "observer", provider: "claude" }]).members[0].readOnly).toBe(true);
  });

  it("refuses non-Git projects and busy workspaces", () => {
    const { root, source } = makeRepo();
    const plain = mkdtempSync(join(tmpdir(), "saber-team-plain-"));
    directories.push(plain);
    const { store, teams, profiles } = teamSetup(source, root);
    const other = store.createTask({ project: plain, title: "Plain", spec: "x", criteria: "y" });
    profiles.registerProject(plain);
    profiles.approveRevision(profiles.saveDraft(plain, [{ key: "note", origin: "user", author: "test", content: "plain project" }]).id);
    expect(() => teams.planTeam(other.id, [{ role: "reviewer", provider: "claude" }])).toThrow("Git");
    const task = store.listTasks().find((t) => t.project === source)!;
    store.createRun(task.id, "blocking prompt");
    expect(() => teams.planTeam(task.id, [{ role: "reviewer", provider: "claude" }])).toThrow("already using");
    store.finishRun(store.listRuns(task.id)[0].id, "done", 0);
    const locked = new TerminalLocks();
    locked.reserve(store, other.id, source);
    const blocked = new SpecialistTeams(store, () => ({
      name: "claude", contextBudget: { maxPromptChars: 200_000, supportsProfileContext: true },
      readOnly: { supported: true, args: [] }, args: () => [], spawn: () => { throw new Error("no spawn"); },
    }), locked);
    expect(() => blocked.planTeam(task.id, [{ role: "reviewer", provider: "claude" }])).toThrow("interactive terminal");
  });

  it("launches members in distinct worktrees with captured roles", async () => {
    const { root, source } = makeRepo();
    const { store, task, teams, spawn } = teamSetup(source, root);
    const team = await teams.launchTeam(task.id, [
      { role: "implementer", provider: "opencode" },
      { role: "reviewer", provider: "claude" },
    ]);
    expect(team.taskId).toBe(task.id);
    expect(team.members.map((member) => member.role)).toEqual(["implementer", "reviewer"]);
    const runs = store.listRuns(task.id);
    expect(runs).toHaveLength(2);
    const [first, second] = team.members.map((member) => store.getRun(member.runId)!);
    expect(first.project).not.toBe(second.project);
    expect(first.project).toContain(join("managed", task.id, "runs"));
    expect(existsSync(first.project)).toBe(true);
    expect(existsSync(second.project)).toBe(true);
    expect(first).toMatchObject({ roleId: "implementer", provider: "opencode", status: "running" });
    expect(second).toMatchObject({ roleId: "reviewer", provider: "claude", status: "running" });
    expect(second.task).toContain("Review the workspace changes");
    expect(store.listTeams(task.id)).toHaveLength(1);
    const reviewerCall = spawn.mock.calls.find((call) => call[0].task.includes("Review the workspace changes"));
    expect(reviewerCall?.[0]).toMatchObject({ readOnly: true });
    const implementerCall = spawn.mock.calls.find((call) => call[0].task.includes("Implement the task"));
    expect(implementerCall?.[0].readOnly).toBeFalsy();
    const branches = new Set(team.members.map((member) => store.getRunWorktree(member.runId)!.branch));
    expect(branches.size).toBe(2);
  });

  it("rolls back reservations when provisioning fails, creating nothing", async () => {
    const { root, source } = makeRepo();
    const { store, task, teams } = teamSetup(source, root);
    const created: string[] = [];
    const removed: string[] = [];
    const failing = {
      createRunWorktree: (_taskId: string, runId: string) => {
        if (created.length >= 1) throw new Error("disk full");
        created.push(runId);
        return { runId, taskId: task.id, path: join(root, runId), source, sourceBranch: "main", baseCommit: "base", branch: "br", state: "ready" as const };
      },
      removeRunWorktree: (_taskId: string, runId: string) => {
        removed.push(runId);
        return { runId, taskId: task.id, path: join(root, runId), source, sourceBranch: "main", baseCommit: "base", branch: "br", state: "removed" as const };
      },
    };
    teams.withServices(new AgentRuns(store), failing as unknown as GitWorkspaceService);
    await expect(teams.launchTeam(task.id, [
      { role: "implementer", provider: "opencode" },
      { role: "reviewer", provider: "claude" },
    ])).rejects.toThrow("disk full");
    expect(created).toHaveLength(1);
    expect(removed).toEqual(created);
    expect(store.listRuns(task.id)).toHaveLength(0);
    expect(store.listTeams(task.id)).toHaveLength(0);
  });

  it("keeps partial spawn failure visible without hiding members", async () => {
    const { root, source } = makeRepo();
    let calls = 0;
    const { store, task, teams } = teamSetup(source, root, () => {
      calls += 1;
      if (calls > 1) throw new Error("spawn failed");
      return makeChild();
    });
    const team = await teams.launchTeam(task.id, [
      { role: "implementer", provider: "opencode" },
      { role: "reviewer", provider: "claude" },
    ]);
    expect(team.members).toHaveLength(2);
    const states = team.members.map((member) => store.getRun(member.runId)?.status);
    expect(states).toEqual(["running", "error"]);
    const failed = store.getRun(team.members[1].runId)!;
    expect(store.events(failed.id, 0).lines[0]).toContain("spawn failed");
    expect(store.listTeams(task.id)).toHaveLength(1);
  });

  it("blocks a second team while members are active, but allows one after terminal states", async () => {
    const { root, source } = makeRepo();
    const { store, task, teams } = teamSetup(source, root);
    const members = [
      { role: "implementer", provider: "opencode" },
      { role: "reviewer", provider: "claude" },
    ];
    await teams.launchTeam(task.id, members);
    await expect(teams.launchTeam(task.id, [{ role: "reviewer", provider: "claude" }])).rejects.toThrow("already active");
    expect(() => teams.planTeam(task.id, [{ role: "reviewer", provider: "claude" }])).toThrow("already active");
    for (const team of store.listTeams(task.id)) {
      for (const member of team.members) store.finishRun(member.runId, "done", 0);
    }
    expect((await teams.launchTeam(task.id, [{ role: "reviewer", provider: "claude" }])).members).toHaveLength(1);
  });

  it("shares one onyx reference across members with a single query", async () => {
    const { root, source } = makeRepo();
    const { store, task, teams } = teamSetup(source, root);
    let requests = 0;
    const server = createServer((req, res) => {
      requests += 1;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ hits: [{ sourcePath: "C:/corpus/Saber.md", heading: "Saber", excerpt: "A workspace.", mtime: "2026-09-18T11:12:56.943Z", score: 2 }] }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    delete process.env.ONYX_DISABLED;
    process.env.ONYX_BASE_URL = `http://127.0.0.1:${port}`;
    try {
      const team = await teams.launchTeam(task.id, [
        { role: "implementer", provider: "opencode" },
        { role: "reviewer", provider: "claude" },
      ]);
      expect(requests).toBe(1);
      const shas = team.members.map((member) => store.getRun(member.runId)?.onyxContextSha);
      expect(shas[0]).toMatch(/^[0-9a-f]{64}$/);
      expect(shas[1]).toBe(shas[0]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
