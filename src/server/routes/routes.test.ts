import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  return handleApi(new Request(`http://localhost${path}`, { ...init, headers: { host: "localhost", ...init?.headers } }));
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

describe("legacy api transport gate", () => {
  const savedRemote = process.env.SABER_ALLOW_REMOTE_API;
  delete process.env.SABER_ALLOW_REMOTE_API;

  function loopback(path: string, init?: RequestInit) {
    return handleApi(new Request(`http://127.0.0.1:8082${path}`, { ...init, headers: { host: "127.0.0.1:8082", ...init?.headers } }));
  }

  function foreign(path: string, init?: RequestInit) {
    return handleApi(new Request(`http://127.0.0.1:8082${path}`, {
      ...init,
      headers: { ...init?.headers, host: "192.168.1.50:8082" },
    }));
  }

  it("accepts loopback requests with a matching host and no origin", async () => {
    expect((await loopback("/api/nothing-here"))?.status).toBe(404);
  });

  it("accepts loopback same-origin requests", async () => {
    const response = await loopback("/api/tasks", { method: "POST", headers: { origin: "http://127.0.0.1:8082", "content-type": "application/json" }, body: "{}" });
    expect(response?.status).toBe(400);
  });

  it("rejects foreign-host requests and cross-site origins", async () => {
    expect((await foreign("/api/nothing-here"))?.status).toBe(403);
    const crossSite = await loopback("/api/sessions", { method: "POST", headers: { origin: "https://evil.example", "content-type": "text/plain" }, body: "{}" });
    expect(crossSite?.status).toBe(403);
  });

  it("rejects a loopback url whose host header disagrees", async () => {
    const response = await handleApi(new Request("http://127.0.0.1:8082/api/nothing-here", { headers: { host: "localhost:9999" } }));
    expect(response?.status).toBe(403);
  });

  it("allows non-loopback access only when SABER_ALLOW_REMOTE_API=1", async () => {
    process.env.SABER_ALLOW_REMOTE_API = "1";
    try {
      expect((await foreign("/api/nothing-here"))?.status).toBe(404);
    } finally {
      if (savedRemote === undefined) delete process.env.SABER_ALLOW_REMOTE_API;
      else process.env.SABER_ALLOW_REMOTE_API = savedRemote;
    }
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
    expect((await api(`/api/tasks/${taskId}/workspace`))?.status).toBe(409);
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

  it("MOD-05 reads the opencode model from SABER_OPENCODE_CONFIG on any platform", async () => {
    const config = join(directory, "opencode.jsonc");
    writeFileSync(config, JSON.stringify({ model: "opencode/grok-code" }));
    const previous = process.env.SABER_OPENCODE_CONFIG;
    process.env.SABER_OPENCODE_CONFIG = config;
    try {
      const model = await api("/api/default-model");
      expect(model?.status).toBe(200);
      expect(await json(model)).toEqual({ default: "opencode/grok-code" });
    } finally {
      if (previous === undefined) delete process.env.SABER_OPENCODE_CONFIG;
      else process.env.SABER_OPENCODE_CONFIG = previous;
    }
  });
});

describe("project routes", () => {
  it("MOD-06 lists projects and records", async () => {
    expect((await api("/api/projects"))?.status).toBe(200);
    const records = await api("/api/project-records");
    expect(records?.status).toBe(200);
    expect(await json(records)).toEqual([]);
  });

  it("ENV-01 serves dev-server log cursors with validation", async () => {
    expect((await api("/api/dev-servers/logs"))?.status).toBe(400);
    expect((await api("/api/dev-servers/logs?project=ghost&after=0"))?.status).toBe(404);
    expect((await api("/api/dev-servers/logs?project=ghost&after=-1"))?.status).toBe(400);
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
    expect((await json(discarded)).error).toBe("Revision not found");
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

describe("launch routes", () => {
  const savedLaunchCwd = process.env.SABER_LAUNCH_CWD;
  let repository: string;

  function restoreEnv() {
    if (savedLaunchCwd === undefined) delete process.env.SABER_LAUNCH_CWD;
    else process.env.SABER_LAUNCH_CWD = savedLaunchCwd;
  }

  afterAll(restoreEnv);

  it("REPO-FIRST-02/03 registers a launched repository once with its detected context", async () => {
    repository = mkdtempSync(join(tmpdir(), "saber-launch-route-"));
    const nested = join(repository, "packages", "app");
    mkdirSync(nested, { recursive: true });
    execFileSync("git", ["-C", repository, "init", "-q"]);
    execFileSync("git", ["-C", repository, "config", "user.email", "saber@example.com"]);
    execFileSync("git", ["-C", repository, "config", "user.name", "Saber"]);
    writeFileSync(join(repository, "AGENTS.md"), "Stack: Bun.\n");
    execFileSync("git", ["-C", repository, "add", "."]);
    execFileSync("git", ["-C", repository, "commit", "-q", "-m", "init"]);

    const launched = await post("/api/launch", { cwd: nested });
    expect(launched?.status).toBe(201);
    const context = await json(launched);
    expect(context.status).toBe("repository");
    expect(context.project.root).toBe(repository);
    expect(context.project.displayName).toBe(repository.split("/").pop());
    expect(context.repository.dirty).toBe(false);
    expect(context.guidance.agentsFile).toBe(join(repository, "AGENTS.md"));

    const records = await json(await api("/api/project-records"));
    expect(records.filter((record: { root: string }) => record.root === repository)).toHaveLength(1);
    rmSync(repository, { recursive: true, force: true });
  });

  it("REPO-FIRST-07 explains a launch outside git and offers the last project", async () => {
    const outside = mkdtempSync(join(tmpdir(), "saber-launch-outside-"));
    const response = await post("/api/launch", { cwd: outside });
    expect(response?.status).toBe(201);
    const context = await json(response);
    expect(context.status).toBe("outside-git");
    expect(context.fallback.reason).toContain("not inside a Git repository");
    rmSync(outside, { recursive: true, force: true });

    expect((await post("/api/launch", { cwd: join(tmpdir(), "saber-launch-missing") }))?.status).toBe(400);
    expect((await post("/api/launch", {}))?.status).toBe(400);
  });

  it("REPO-FIRST-01 resolves the launcher cwd handoff from the environment", async () => {
    repository = mkdtempSync(join(tmpdir(), "saber-launch-env-"));
    execFileSync("git", ["-C", repository, "init", "-q"]);
    process.env.SABER_LAUNCH_CWD = repository;
    const context = await json(await api("/api/launch-context"));
    expect(context.status).toBe("repository");
    expect(context.project.root).toBe(repository);
    rmSync(repository, { recursive: true, force: true });

    delete process.env.SABER_LAUNCH_CWD;
    const unavailable = await json(await api("/api/launch-context"));
    expect(unavailable.status).toBe("unavailable");
    expect(unavailable.fallback.reason).toContain("without a working directory");
  });
});
