import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore, StaleTaskError, MissingPreconditionError, validateTaskPreconditions } from "./taskStore";
import type { TaskPatch } from "../lib/tasks";

const directories: string[] = [];
const stores: TaskStore[] = [];
const input = { project: "C:/projects/example", title: "Fix navigation", spec: "Restore selection", criteria: "Selection survives refresh" };
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "saber-test-"));
  directories.push(directory);
  const path = join(directory, "tasks.sqlite");
  const store = new TaskStore(path);
  stores.push(store);
  return { store, path };
}
afterEach(() => {
  for (const store of stores.splice(0)) { try { store.close(); } catch {} }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("persistent tasks", () => {
  it("restores context, drafts, run scope and interruption after reopening", () => {
    const { store, path } = setup();
    const task = store.createTask(input);
    store.updateTask(task.id, { context: "Next: check keyboard navigation", draft: "Also test refresh" });
    const run = store.createRun(task.id, "Implement revision 1", "test-model");
    store.setNativeSession(run.id, "native-123");
    store.appendEvent(run.id, "first event");
    store.updateTask(task.id, { spec: "Updated specification" });
    store.close();
    const reopened = new TaskStore(path);
    stores.push(reopened);
    expect(reopened.getTask(task.id)).toMatchObject({ revision: 2, context: "Next: check keyboard navigation", draft: "Also test refresh" });
    expect(reopened.getRun(run.id)).toMatchObject({ status: "interrupted", specRevision: 1, spec: input.spec, nativeSessionId: "native-123", model: "test-model" });
    expect(reopened.events(run.id, 0).lines).toEqual(["first event"]);
    expect(() => reopened.createRun(task.id, "retry")).toThrow("interrupted");
    reopened.finishRun(run.id, "stopped", null);
    expect(reopened.createRun(task.id, "retry").specRevision).toBe(2);
  });

  it("keeps completed attempts and blocks concurrent writes across tasks", () => {
    const { store, path } = setup();
    const first = store.createTask(input);
    const second = store.createTask({ ...input, title: "Another task" });
    const run = store.createRun(first.id, "first");
    expect(() => store.createRun(second.id, "second")).toThrow("already using");
    store.finishRun(run.id, "done", 0);
    const next = store.createRun(second.id, "second");
    store.finishRun(next.id, "error", 1);
    store.close();
    const reopened = new TaskStore(path);
    stores.push(reopened);
    expect(reopened.getRun(run.id)?.status).toBe("done");
    expect(reopened.listRuns(second.id)).toHaveLength(1);
  });

  it("pages more than 2000 events without cursor loss", () => {
    const { store } = setup();
    const task = store.createTask(input);
    const run = store.createRun(task.id, "go");
    for (let index = 0; index < 2105; index++) store.appendEvent(run.id, `event ${index}`);
    let cursor = 0;
    const lines: string[] = [];
    while (true) {
      const page = store.events(run.id, cursor);
      expect(page.lines.length).toBeLessThanOrEqual(300);
      lines.push(...page.lines);
      cursor = page.next;
      if (!page.hasMore) break;
    }
    expect(cursor).toBe(2105);
    expect(lines).toEqual(Array.from({ length: 2105 }, (_, index) => `event ${index}`));
  }, 15_000);

  it("rejects invalid patches without corrupting saved records", () => {
    const { store } = setup();
    const task = store.createTask(input);
    expect(() => store.updateTask(task.id, { spec: "" })).toThrow("spec is required");
    expect(() => store.updateTask(task.id, { revision: 44 } as never)).toThrow("Unknown field");
    expect(store.getTask(task.id)?.revision).toBe(1);
  });

  it("rejects a stale task form and preserves the newer revision", () => {
    const { store } = setup();
    const task = store.createTask(input);
    const staleRevision = task.revision;
    store.updateTask(task.id, { spec: "Newer specification" });
    const newer = store.getTask(task.id)!;
    expect(newer.revision).toBe(staleRevision + 1);

    expect(() => store.updateTask(task.id, { spec: "Older form text", expectedRevision: staleRevision })).toThrow(StaleTaskError);
    expect(() => store.updateTask(task.id, { title: "Older title", expectedUpdatedAt: newer.updatedAt - 1 })).toThrow("changed after the form was loaded");
    expect(store.getTask(task.id)?.spec).toBe("Newer specification");
    expect(store.getTask(task.id)?.title).toBe("Fix navigation");

    const accepted = store.updateTask(task.id, { title: "Fresh title", expectedRevision: newer.revision, expectedUpdatedAt: newer.updatedAt });
    expect(accepted.title).toBe("Fresh title");
  });

  it("blocks root and sibling directories belonging to the same checkout", () => {
    const { store, path } = setup();
    const root = join(path, "..", "repository");
    mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "docs"));
    const source = store.createTask({ ...input, project: join(root, "src") });
    const docs = store.createTask({ ...input, project: join(root, "docs") });
    const repo = store.createTask({ ...input, project: root });
    const run = store.createRun(source.id, "go");
    expect(() => store.createRun(docs.id, "go")).toThrow("already using");
    expect(() => store.createRun(repo.id, "go")).toThrow("already using");
    store.finishRun(run.id, "interrupted", null);
    expect(() => store.createRun(docs.id, "go")).toThrow("interrupted");
  });

  it("preserves append-only verification history and invalidates it after revision edits", () => {
    const { store, path } = setup();
    const task = store.createTask({ ...input, criteria: "AC-01: Selection survives refresh" });
    const first = store.createVerification({ id: "verification-1", taskId: task.id, criterionId: "AC-01", criterionText: "Selection survives refresh", revision: 1, outcome: "passed", check: "bun run test", evidence: "passed", checkedAt: 10 });
    const failed = store.createVerification({ ...first, id: "verification-2", outcome: "failed", evidence: "regression", checkedAt: 11 });
    expect(store.listTasks()[0].verificationSummary).toMatchObject({ state: "failed", failed: 1 });
    store.updateTask(task.id, { criteria: "AC-01: Selection survives refresh\nAC-02: No data is lost" });
    expect(store.listTasks()[0].verificationSummary).toMatchObject({ state: "incomplete", stale: 1, total: 2 });
    store.close();
    const reopened = new TaskStore(path);
    stores.push(reopened);
    expect(reopened.listVerifications(task.id)).toEqual([first, failed]);
    expect(reopened.listTasks()[0].verificationSummary).toMatchObject({ state: "incomplete", stale: 1 });
  });

  it("persists terminal scope, reconciles absent sessions as interrupted, and requires explicit recovery", () => {
    const { store, path } = setup();
    const task = store.createTask(input);
    const session = store.createTerminalSession({ id: "terminal-a", taskId: task.id, workdir: "C:/captured/worktree", status: "starting", createdAt: 10 });
    store.setTerminalSessionStatus(session.id, "running");
    store.close();

    const reopened = new TaskStore(path);
    stores.push(reopened);
    expect(reopened.getTerminalSession(session.id)).toMatchObject({ status: "running", workdir: "C:/captured/worktree", startedAt: expect.any(Number) });
    expect(reopened.reconcileTerminalSessions([])[0].status).toBe("interrupted");
    expect(() => reopened.recoverTerminalSession(session.id, false)).toThrow("Confirm that the interrupted terminal process has stopped");
    expect(reopened.reconcileTerminalSessions([])[0].status).toBe("interrupted");
    expect(reopened.recoverTerminalSession(session.id, true)).toMatchObject({ status: "stopped", endedAt: expect.any(Number) });
    expect(() => reopened.setTerminalSessionStatus(session.id, "running")).toThrow("Cannot change terminal session from stopped");
  });

  it("prevents an agent run from claiming a workspace owned by a terminal session", () => {
    const { store } = setup();
    const task = store.createTask(input);
    store.createTerminalSession({
      id: "terminal-owner",
      taskId: task.id,
      workdir: task.project,
      status: "running",
      createdAt: 12,
    });

    expect(() => store.createRun(task.id, "agent run")).toThrow("interactive terminal owns this workspace");
    expect(store.listRuns(task.id)).toHaveLength(0);
  });

  it("prevents terminal creation from claiming a workspace owned by an active run", () => {
    const { store } = setup();
    const task = store.createTask(input);
    store.createRun(task.id, "agent run");

    expect(() => store.createTerminalSession({
      id: "terminal-conflict",
      taskId: task.id,
      workdir: task.project,
      status: "starting",
      createdAt: 13,
    })).toThrow("agent run is already using this workspace");
    expect(store.listTerminalSessions()).toHaveLength(0);
  });

  it("keeps a session active only when its opaque ID exists in the live Tauri process", () => {
    const { store } = setup();
    const task = store.createTask(input);
    store.createTerminalSession({ id: "terminal-live", taskId: task.id, workdir: task.project, status: "starting", createdAt: 11 });
    expect(store.reconcileTerminalSessions(["terminal-live"])[0].status).toBe("running");
    expect(store.reconcileTerminalSessions([])[0].status).toBe("interrupted");
  });

  it("requires a usable form token and keeps every write strictly newer", () => {
    const { store } = setup();
    const task = store.createTask(input);
    expect(() => validateTaskPreconditions({ title: "No token" } as TaskPatch)).toThrow(MissingPreconditionError);
    expect(() => validateTaskPreconditions({ title: "Bad token", expectedUpdatedAt: "1" } as never)).toThrow(MissingPreconditionError);
    expect(() => validateTaskPreconditions({ title: "Bad token", expectedUpdatedAt: Number.NaN })).toThrow(MissingPreconditionError);
    expect(() => validateTaskPreconditions({ title: "Bad revision", expectedUpdatedAt: task.updatedAt, expectedRevision: "1" } as never)).toThrow("expectedRevision must be a number");
    validateTaskPreconditions({ title: "Good", expectedUpdatedAt: task.updatedAt, expectedRevision: task.revision });

    const first = store.updateTask(task.id, { context: "one", expectedUpdatedAt: task.updatedAt });
    const second = store.updateTask(task.id, { context: "two", expectedUpdatedAt: first.updatedAt });
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt);
    expect(() => store.updateTask(task.id, { context: "stale", expectedUpdatedAt: first.updatedAt })).toThrow(StaleTaskError);
    expect(store.getTask(task.id)?.context).toBe("two");
  });

  it("never resurrects an interrupted terminal session during reconciliation", () => {
    const { store } = setup();
    const task = store.createTask(input);
    store.createTerminalSession({ id: "terminal-dead", taskId: task.id, workdir: task.project, status: "running", createdAt: 14 });
    expect(store.reconcileTerminalSessions([])[0].status).toBe("interrupted");
    expect(store.reconcileTerminalSessions(["terminal-dead"])[0].status).toBe("interrupted");
    expect(() => store.setTerminalSessionStatus("terminal-dead", "running")).toThrow("Cannot change terminal session");
  });
});
