import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TaskStore } from "../taskStore";

vi.mock("../providers/executables", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    providerStatus: async (id: string) => ({ id, installed: true, auth: "ok", message: "" }),
  };
});

const runtime = globalThis as typeof globalThis & { saberTaskStore?: TaskStore; saberSpecialistTeams?: unknown };
const previousDataDir = process.env.SABER_DATA_DIR;
let directory: string;
let handleApi: (request: Request) => Promise<Response | null>;

function api(path: string, init?: RequestInit) {
  return handleApi(new Request(`http://localhost${path}`, init));
}

function post(path: string, body: unknown) {
  return api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function json(response: Response | null): Promise<any> {
  expect(response).not.toBeNull();
  return response!.json();
}

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "saber-routes-"));
  process.env.SABER_DATA_DIR = directory;
  ({ handleApi } = await import("./index"));
});

afterAll(() => {
  runtime.saberTaskStore?.close();
  runtime.saberTaskStore = undefined;
  runtime.saberSpecialistTeams = undefined;
  if (previousDataDir === undefined) delete process.env.SABER_DATA_DIR;
  else process.env.SABER_DATA_DIR = previousDataDir;
  rmSync(directory, { recursive: true, force: true });
});

describe("api dispatcher", () => {
  it("MOD-09 passes non-API paths through and rejects unknown API paths", async () => {
    expect(await api("/")).toBeNull();
    expect(await api("/api")).toBeNull();

    const missing = await api("/api/nothing-here");
    expect(missing?.status).toBe(404);
    expect(missing?.headers.get("content-type")).toContain("application/json");
    expect(missing?.headers.get("cache-control")).toBe("no-store");
    expect(await json(missing)).toEqual({ error: "not found" });
  });

  it("MOD-09 falls back to 404 for a known path with the wrong method", async () => {
    expect((await api("/api/tasks", { method: "PUT" }))?.status).toBe(404);
    expect((await api("/api/browser/screenshot", { method: "POST" }))?.status).toBe(404);
  });
});

describe("tasks routes", () => {
  let taskId = "";
  let updatedAt = 0;

  it("MOD-03 lists providers", async () => {
    const response = await api("/api/providers");
    expect(response?.status).toBe(200);
    expect(await json(response)).toHaveLength(3);
  }, 30_000);

  it("MOD-03 creates a task and lists it", async () => {
    expect((await post("/api/tasks", {}))?.status).toBe(400);

    const created = await post("/api/tasks", {
      project: directory,
      title: "Decompose the server",
      spec: "Move routes into modules",
      criteria: "Every route is still reachable",
    });
    expect(created?.status).toBe(201);
    const task = await json(created);
    taskId = task.id;
    updatedAt = task.updatedAt;
    expect(taskId).toBeTruthy();

    const listed = await json(await api("/api/tasks"));
    expect(Array.isArray(listed)).toBe(true);
    expect(listed.map((entry: { id: string }) => entry.id)).toContain(taskId);
  });

  it("MOD-03 enforces the update preconditions", async () => {
    const missing = await api(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Renamed" }),
    });
    expect(missing?.status).toBe(428);
    expect((await json(missing)).code).toBe("precondition_required");

    const stale = await api(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Renamed", expectedUpdatedAt: updatedAt - 1 }),
    });
    expect(stale?.status).toBe(409);
    expect((await json(stale)).code).toBe("stale_task");

    const accepted = await api(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Renamed", expectedUpdatedAt: updatedAt }),
    });
    expect(accepted?.status).toBe(200);
    const updated = await json(accepted);
    expect(updated.title).toBe("Renamed");
    expect(updated.updatedAt).toBeGreaterThan(updatedAt);
    updatedAt = updated.updatedAt;
  });

  it("MOD-03 serves verifications, workspace, and teams for a task", async () => {
    const verifications = await api(`/api/tasks/${taskId}/verifications`);
    expect(verifications?.status).toBe(200);
    const summary = await json(verifications);
    expect(summary.records).toEqual([]);
    expect(summary.summary).toBeTruthy();
    expect((await post(`/api/tasks/${taskId}/verifications`, {}))?.status).toBe(400);

    const unknownWorkspace = await api("/api/tasks/missing/workspace");
    expect(unknownWorkspace?.status).toBe(404);
    expect((await json(unknownWorkspace)).error).toBe("Task not found");
    expect((await api(`/api/tasks/${taskId}/teams`))?.status).toBe(200);

    const terminals = await api(`/api/tasks/${taskId}/terminals`);
    expect(terminals?.status).toBe(200);
    expect(await json(terminals)).toEqual([]);

    const runs = await api(`/api/tasks/${taskId}/runs`);
    expect(runs?.status).toBe(200);
    expect(await json(runs)).toEqual([]);
    expect((await post(`/api/tasks/${taskId}/runs`, { provider: "nope" }))?.status).toBe(400);
  });
});

describe("terminal routes", () => {
  it("MOD-04 lists, reconciles, and rejects an unknown session", async () => {
    const list = await api("/api/terminals");
    expect(list?.status).toBe(200);
    expect(await json(list)).toEqual([]);

    expect((await post("/api/terminals/reconcile", { liveSessionIds: [] }))?.status).toBe(200);
    expect((await post("/api/terminals/reconcile", {}))?.status).toBe(400);
    const missing = await api("/api/terminals/missing", { method: "DELETE" });
    expect(missing?.status).toBe(404);
    expect((await json(missing)).error).toBe("Terminal session not found");
    expect((await post("/api/terminals/missing/running", {}))?.status).toBe(409);
    expect((await post("/api/terminals/missing/recover", { confirmedStopped: true }))?.status).toBe(409);
  });
});

describe("session routes", () => {
  it("MOD-05 lists sessions and reports the default model", async () => {
    const sessions = await api("/api/sessions");
    expect(sessions?.status).toBe(200);
    expect(await json(sessions)).toEqual([]);

    const model = await api("/api/default-model");
    expect(model?.status).toBe(200);
    expect(typeof (await json(model)).default).toBe("string");
  });

  it("MOD-05 rejects an unknown run and invalid session input", async () => {
    expect((await api("/api/sessions/missing/events?after=0"))?.status).toBe(404);
    expect((await post("/api/sessions/missing/acknowledge", { processStopped: true }))?.status).toBe(409);
    expect((await api("/api/sessions", { method: "POST", body: "{" }))?.status).toBe(400);
    expect((await post("/api/sessions", {}))?.status).toBe(400);
    expect((await post("/api/sessions/missing/stop", {}))?.status).toBe(404);
    const followup = await post("/api/sessions/missing/followup", {});
    expect(followup?.status).toBe(400);
    expect((await json(followup)).error).toBe("task is required");
  });
});

describe("project routes", () => {
  it("MOD-06 lists projects and records", async () => {
    expect((await api("/api/projects"))?.status).toBe(200);
    const records = await api("/api/project-records");
    expect(records?.status).toBe(200);
    expect(await json(records)).toEqual([]);
  });

  it("MOD-06 validates project records and profiles", async () => {
    expect((await post("/api/project-records", {}))?.status).toBe(400);
    const registered = await post("/api/project-records", { path: directory, displayName: "Workspace" });
    expect(registered?.status).toBe(201);
    expect((await api("/api/project-profiles"))?.status).toBe(400);
    expect((await post("/api/project-profiles/drafts", {}))?.status).toBe(400);
    expect((await post("/api/project-profiles/refresh", {}))?.status).toBe(400);
  });

  it("MOD-06 reaches project revisions without a handler for GET", async () => {
    expect((await api("/api/project-revisions/missing"))?.status).toBe(405);
    const discarded = await post("/api/project-revisions/missing/discard", {});
    expect(discarded?.status).toBe(404);
    expect((await json(discarded)).error).toBe("Request could not be completed");
  });
});

describe("role routes", () => {
  it("MOD-07 requires a project root", async () => {
    expect((await api("/api/roles"))?.status).toBe(400);
    expect((await post("/api/roles", {}))?.status).toBe(400);
    expect((await api("/api/roles/missing", { method: "PATCH", body: "{}" }))?.status).toBe(400);
  });

  it("MOD-07 lists teams and validates a plan request", async () => {
    const teams = await api("/api/tasks/missing/teams");
    expect(teams?.status).toBe(200);
    expect((await post("/api/tasks/missing/teams/plan", {}))?.status).toBe(400);
    expect((await post("/api/tasks/missing/teams", {}))?.status).toBe(400);
  });
});

describe("environment routes", () => {
  it("MOD-08 lists dev servers and stops an unknown project idempotently", async () => {
    const servers = await api("/api/dev-servers");
    expect(servers?.status).toBe(200);
    expect(await json(servers)).toEqual([]);

    const stopped = await post("/api/dev-servers/stop", { project: "ghost" });
    expect(stopped?.status).toBe(200);
    expect(await json(stopped)).toEqual({ ok: true });
  });

  it("MOD-08 fails a start for an unknown project and validates browser input", async () => {
    expect((await post("/api/dev-servers/start", { project: "ghost" }))?.status).toBe(500);
    expect((await post("/api/dev-servers/start", {}))?.status).toBe(400);
    expect((await post("/api/browser/goto", {}))?.status).toBe(400);
    expect((await post("/api/browser/act", {}))?.status).toBe(400);
  });
});
