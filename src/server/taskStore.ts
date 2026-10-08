import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { TaskInput, TaskPatch, TaskRecord, TaskSummary, RunRecord, RunStatus, ProviderId, TaskWorkspaceRecord, TerminalSessionRecord, TerminalSessionStatus, VerificationRecord, ProjectRecord, ProfileRevision, RunContextCapture } from "../lib/tasks";
import { canonicalizeProjectRoot, workspacesOverlap } from "./workspaceIdentity";
import { summarizeVerification } from "../lib/verification";

export class TaskStore {
  private db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS runs_task ON runs(task_id);
      CREATE TABLE IF NOT EXISTS events (
        run_id TEXT NOT NULL REFERENCES runs(id), seq INTEGER NOT NULL, line TEXT NOT NULL,
        PRIMARY KEY (run_id, seq)
      );
      CREATE TABLE IF NOT EXISTS verifications (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id),
        run_id TEXT REFERENCES runs(id), data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS verifications_task ON verifications(task_id);
      CREATE TABLE IF NOT EXISTS terminal_sessions (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS terminal_sessions_task ON terminal_sessions(task_id);
      CREATE TABLE IF NOT EXISTS projects (
        root TEXT PRIMARY KEY, data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS profile_revisions (
        id TEXT PRIMARY KEY, project_root TEXT NOT NULL REFERENCES projects(root) ON DELETE CASCADE, data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS profile_revisions_project ON profile_revisions(project_root);
    `);
    for (const run of this.listRuns()) {
      if (run.status === "running") this.finishRun(run.id, "interrupted", null);
    }
  }

  close() { this.db.close(); }

  private decode<T>(row: unknown): T | undefined {
    return row ? JSON.parse((row as { data: string }).data) as T : undefined;
  }

  getTask(id: string) {
    return this.decode<TaskRecord>(this.db.prepare("SELECT data FROM tasks WHERE id = ?").get(id));
  }

  listTasks(): TaskSummary[] {
    return this.db.prepare("SELECT data FROM tasks").all()
      .map((row) => this.decode<TaskRecord>(row)!)
      .map((task) => ({ ...task, latestRun: this.listRuns(task.id)[0], verificationSummary: summarizeVerification(task.criteria, task.revision, this.listVerifications(task.id)) }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  createTask(input: TaskInput): TaskRecord {
    for (const key of ["project", "title", "spec", "criteria"] as const) {
      if (typeof input[key] !== "string" || !input[key].trim()) throw new Error(`${key} is required`);
      if (input[key].length > 100_000) throw new Error(`${key} is too long`);
    }
    const now = Date.now();
    const task: TaskRecord = {
      id: crypto.randomUUID(), project: input.project, title: input.title.trim(),
      spec: input.spec.trim(), criteria: input.criteria.trim(), revision: 1,
      context: "", draft: "", createdAt: now, updatedAt: now,
    };
    this.db.prepare("INSERT INTO tasks VALUES (?, ?)").run(task.id, JSON.stringify(task));
    return task;
  }

  updateTask(id: string, patch: TaskPatch): TaskRecord {
    const task = this.getTask(id);
    if (!task) throw new Error("Task not found");
    for (const key of Object.keys(patch)) {
      if (!["title", "spec", "criteria", "context", "draft"].includes(key)) throw new Error(`Unknown field: ${key}`);
      const value = patch[key as keyof TaskPatch];
      if (typeof value !== "string" || value.length > 100_000) throw new Error(`Invalid ${key}`);
      if (["title", "spec", "criteria"].includes(key) && !value.trim()) throw new Error(`${key} is required`);
    }
    const changed = (patch.spec !== undefined && patch.spec !== task.spec)
      || (patch.criteria !== undefined && patch.criteria !== task.criteria);
    const updated = { ...task, ...patch, revision: task.revision + Number(changed), updatedAt: Date.now() };
    this.db.prepare("UPDATE tasks SET data = ? WHERE id = ?").run(JSON.stringify(updated), id);
    return updated;
  }

  getRun(id: string) {
    return this.decode<RunRecord>(this.db.prepare("SELECT data FROM runs WHERE id = ?").get(id));
  }

  listVerifications(taskId: string): VerificationRecord[] {
    return (this.db.prepare("SELECT data FROM verifications WHERE task_id = ? ORDER BY rowid ASC").all(taskId))
      .map((row) => this.decode<VerificationRecord>(row)!);
  }

  createVerification(record: VerificationRecord) {
    if (!this.getTask(record.taskId)) throw new Error("Task not found");
    if (record.runId && !this.getRun(record.runId)) throw new Error("Run not found");
    this.db.prepare("INSERT INTO verifications VALUES (?, ?, ?, ?)")
      .run(record.id, record.taskId, record.runId ?? null, JSON.stringify(record));
    return record;
  }

  setWorkspace(id: string, workspace: TaskWorkspaceRecord) {
    const task = this.getTask(id);
    if (!task) throw new Error("Task not found");
    const updated = { ...task, workspace, updatedAt: Date.now() };
    this.db.prepare("UPDATE tasks SET data = ? WHERE id = ?").run(JSON.stringify(updated), id);
    return updated;
  }

  createTerminalSession(record: TerminalSessionRecord) {
    if (!this.getTask(record.taskId)) throw new Error("Task not found");
    if (!record.id.trim() || !record.workdir.trim()) throw new Error("Terminal session ID and working directory are required");
    const active = this.listTerminalSessions(record.taskId).find((item) => item.status !== "stopped");
    if (active) throw new Error("This task already has a terminal session");
    this.db.prepare("INSERT INTO terminal_sessions VALUES (?, ?, ?)").run(record.id, record.taskId, JSON.stringify(record));
    return record;
  }

  getTerminalSession(id: string) {
    return this.decode<TerminalSessionRecord>(this.db.prepare("SELECT data FROM terminal_sessions WHERE id = ?").get(id));
  }

  listTerminalSessions(taskId?: string) {
    const rows = taskId
      ? this.db.prepare("SELECT data FROM terminal_sessions WHERE task_id = ? ORDER BY rowid DESC").all(taskId)
      : this.db.prepare("SELECT data FROM terminal_sessions ORDER BY rowid DESC").all();
    return rows.map((row) => this.decode<TerminalSessionRecord>(row)!);
  }

  setTerminalSessionStatus(id: string, status: TerminalSessionStatus) {
    const record = this.getTerminalSession(id);
    if (!record) throw new Error("Terminal session not found");
    const allowed: Record<TerminalSessionStatus, TerminalSessionStatus[]> = {
      starting: ["running", "interrupted", "stopped"],
      running: ["interrupted", "stopped"],
      interrupted: ["running", "stopped"],
      stopped: [],
    };
    if (record.status !== status && !allowed[record.status].includes(status)) throw new Error(`Cannot change terminal session from ${record.status} to ${status}`);
    const now = Date.now();
    const updated: TerminalSessionRecord = {
      ...record,
      status,
      ...(status === "running" && !record.startedAt ? { startedAt: now } : {}),
      ...(status === "stopped" ? { endedAt: now } : {}),
    };
    this.db.prepare("UPDATE terminal_sessions SET data = ? WHERE id = ?").run(JSON.stringify(updated), id);
    return updated;
  }

  reconcileTerminalSessions(liveSessionIds: string[]) {
    const live = new Set(liveSessionIds);
    return this.listTerminalSessions().map((record) => {
      if (record.status === "stopped") return record;
      if (live.has(record.id)) return this.setTerminalSessionStatus(record.id, "running");
      if (record.status === "interrupted") return record;
      return this.setTerminalSessionStatus(record.id, "interrupted");
    });
  }

  recoverTerminalSession(id: string, confirmedStopped: boolean) {
    if (!confirmedStopped) throw new Error("Confirm that the interrupted terminal process has stopped before recovery");
    const record = this.getTerminalSession(id);
    if (!record) throw new Error("Terminal session not found");
    if (record.status !== "interrupted") throw new Error("Only an interrupted terminal session can be recovered");
    return this.setTerminalSessionStatus(id, "stopped");
  }

  private normalizeProject(raw: ProjectRecord): ProjectRecord {
    return {
      root: raw.root,
      displayName: raw.displayName ?? raw.root,
      createdAt: raw.createdAt ?? Date.now(),
      ...(raw.activeRevisionId !== undefined ? { activeRevisionId: raw.activeRevisionId } : {}),
    };
  }

  private normalizeRevision(raw: ProfileRevision): ProfileRevision {
    return {
      id: raw.id,
      projectRoot: raw.projectRoot,
      entries: Array.isArray(raw.entries) ? raw.entries : [],
      sourceHashes: raw.sourceHashes && typeof raw.sourceHashes === "object" ? raw.sourceHashes : {},
      state: raw.state === "approved" ? "approved" : "draft",
      createdAt: raw.createdAt ?? Date.now(),
      updatedAt: raw.updatedAt ?? raw.createdAt ?? Date.now(),
      ...(raw.approvedAt !== undefined ? { approvedAt: raw.approvedAt } : {}),
    };
  }

  registerProject(root: string, displayName?: string): ProjectRecord {
    if (typeof root !== "string" || !root.trim()) throw new Error("Project root is required");
    const canonical = canonicalizeProjectRoot(root);
    const existing = this.getProject(canonical);
    if (existing) return existing;
    const record = this.normalizeProject({
      root: canonical,
      displayName: displayName?.trim() || canonical,
      createdAt: Date.now(),
    } as ProjectRecord);
    this.db.prepare("INSERT INTO projects VALUES (?, ?)").run(record.root, JSON.stringify(record));
    return record;
  }

  getProject(root: string): ProjectRecord | undefined {
    const canonical = canonicalizeProjectRoot(root);
    const row = this.db.prepare("SELECT data FROM projects WHERE root = ?").get(canonical) as { data: string } | undefined;
    if (!row) return undefined;
    return this.normalizeProject(JSON.parse(row.data) as ProjectRecord);
  }

  listProjects(): ProjectRecord[] {
    return (this.db.prepare("SELECT data FROM projects").all() as Array<{ data: string }>)
      .map((row) => this.normalizeProject(JSON.parse(row.data) as ProjectRecord))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  setProjectActiveRevision(root: string, revisionId: string | undefined): ProjectRecord {
    const canonical = canonicalizeProjectRoot(root);
    const project = this.getProject(canonical);
    if (!project) throw new Error("Project not found");
    if (revisionId !== undefined) {
      const revision = this.getProfileRevision(revisionId);
      if (!revision) throw new Error("Revision not found");
      if (canonicalizeProjectRoot(revision.projectRoot) !== project.root) throw new Error("Revision belongs to another project");
    }
    const updated = this.normalizeProject({ ...project, activeRevisionId: revisionId } as ProjectRecord);
    if (revisionId === undefined) delete updated.activeRevisionId;
    this.db.prepare("UPDATE projects SET data = ? WHERE root = ?").run(JSON.stringify(updated), project.root);
    return updated;
  }

  createProfileRevision(revision: ProfileRevision): ProfileRevision {
    const canonicalRoot = canonicalizeProjectRoot(revision.projectRoot);
    if (!this.getProject(canonicalRoot)) throw new Error("Project not found");
    const normalized = this.normalizeRevision({ ...revision, projectRoot: canonicalRoot });
    this.db.prepare("INSERT INTO profile_revisions VALUES (?, ?, ?)").run(normalized.id, canonicalRoot, JSON.stringify(normalized));
    return normalized;
  }

  getProfileRevision(id: string): ProfileRevision | undefined {
    const row = this.db.prepare("SELECT data FROM profile_revisions WHERE id = ?").get(id) as { data: string } | undefined;
    if (!row) return undefined;
    return this.normalizeRevision(JSON.parse(row.data) as ProfileRevision);
  }

  listProfileRevisions(projectRoot: string): ProfileRevision[] {
    const canonical = canonicalizeProjectRoot(projectRoot);
    return (this.db.prepare("SELECT data FROM profile_revisions WHERE project_root = ? ORDER BY rowid ASC").all(canonical) as Array<{ data: string }>)
      .map((row) => this.normalizeRevision(JSON.parse(row.data) as ProfileRevision));
  }

  writeProfileRevision(revision: ProfileRevision): ProfileRevision {
    const existing = this.getProfileRevision(revision.id);
    if (!existing) throw new Error("Revision not found");
    const canonicalRoot = canonicalizeProjectRoot(revision.projectRoot);
    if (canonicalRoot !== canonicalizeProjectRoot(existing.projectRoot)) throw new Error("Revision project cannot change");
    const normalized = this.normalizeRevision({ ...revision, projectRoot: canonicalRoot });
    this.db.prepare("UPDATE profile_revisions SET data = ? WHERE id = ?").run(JSON.stringify(normalized), normalized.id);
    return normalized;
  }

  deleteProfileRevision(id: string) {
    this.db.prepare("DELETE FROM profile_revisions WHERE id = ?").run(id);
  }

  listRuns(taskId?: string): RunRecord[] {
    const rows = taskId
      ? this.db.prepare("SELECT data FROM runs WHERE task_id = ? ORDER BY rowid DESC").all(taskId)
      : this.db.prepare("SELECT data FROM runs ORDER BY rowid DESC").all();
    return rows.map((row) => this.decode<RunRecord>(row)!);
  }

  createRun(taskId: string, prompt: string, model?: string, provider: ProviderId = "opencode", workdir?: string, capture: RunContextCapture = {}): RunRecord {
    const task = this.getTask(taskId);
    if (!task) throw new Error("Task not found");
    const project = workdir ?? task.workspace?.path ?? task.project;
    if (task.workspace && task.workspace.state !== "ready") throw new Error("Task workspace is not ready");
    const conflict = this.listRuns().find((run) =>
      ["running", "interrupted"].includes(run.status) && workspacesOverlap(run.project, project));
    if (conflict) throw new Error(conflict.status === "interrupted"
      ? "An interrupted run owns this workspace. Confirm its old process has stopped before retrying."
      : "Another run is already using this workspace. Wait or stop it before launching.");
    const run: RunRecord = {
      id: crypto.randomUUID(), taskId, project, task: prompt,
      provider, model, specRevision: task.revision, spec: task.spec,
      criteria: task.criteria, context: task.context,
      profileRevisionId: capture.profileRevisionId, roleId: capture.roleId,
      roleInstructions: capture.roleInstructions, contextSources: capture.contextSources,
      contextNotice: capture.contextNotice,
      status: "running", eventCount: 0,
      startedAt: Date.now(), exitCode: null,
    };
    this.db.prepare("INSERT INTO runs VALUES (?, ?, ?)").run(run.id, taskId, JSON.stringify(run));
    return run;
  }

  private writeRun(run: RunRecord) {
    this.db.prepare("UPDATE runs SET data = ? WHERE id = ?").run(JSON.stringify(run), run.id);
  }

  setNativeSession(id: string, nativeSessionId: string) {
    const run = this.getRun(id);
    if (run) this.writeRun({ ...run, nativeSessionId });
  }

  finishRun(id: string, status: RunStatus, exitCode: number | null) {
    const run = this.getRun(id);
    if (run) this.writeRun({ ...run, status, exitCode, endedAt: Date.now() });
  }

  appendEvent(id: string, line: string) {
    const run = this.getRun(id);
    if (!run) throw new Error("Run not found");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT INTO events VALUES (?, ?, ?)").run(id, ++run.eventCount, line);
      this.writeRun(run);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  events(id: string, after: number, limit = 300) {
    const run = this.getRun(id);
    if (!run) throw new Error("Run not found");
    const rows = this.db.prepare("SELECT seq, line FROM events WHERE run_id = ? AND seq > ? ORDER BY seq LIMIT ?")
      .all(id, Math.max(0, after), Math.max(1, Math.min(limit, 300))) as unknown as Array<{ seq: number; line: string }>;
    const next = rows.at(-1)?.seq ?? after;
    return { status: run.status, next, lines: rows.map((row) => row.line), hasMore: next < run.eventCount };
  }
}

const runtime = globalThis as typeof globalThis & { saberTaskStore?: TaskStore };

export function getTaskStore() {
  return runtime.saberTaskStore ??= new TaskStore(join(process.env.SABER_DATA_DIR ?? join(homedir(), ".saber"), "tasks.sqlite"));
}
