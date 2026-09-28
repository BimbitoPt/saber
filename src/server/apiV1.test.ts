import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskStore } from "./taskStore";
import { handleApiV1 } from "./apiV1";
import { openApiDocument } from "./openapi";

const dataDirs: string[] = [];
const stores: TaskStore[] = [];
const token = "s".repeat(43);
function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), "saber-api-v1-"));
  dataDirs.push(dataDir);
  const store = new TaskStore(join(dataDir, "tasks.sqlite"));
  stores.push(store);
  const task = store.createTask({ project: "C:\\Users\\private\\sample-project", title: "Inspect task", spec: "Keep run scope fixed", criteria: "AC-1: expose only review data" });
  const run = store.createRun(task.id, "private prompt", undefined, "codex");
  store.appendEvent(run.id, JSON.stringify({ type: "saber_event", provider: "codex", raw: "secret-provider-output", items: [{ kind: "agent_message", text: "secret response text" }] }));
  return { store, task, run };
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of dataDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function request(path: string, options: { method?: string; token?: string; host?: string; origin?: string; body?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { host: options.host ?? "127.0.0.1:8082", ...options.headers };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.origin) headers.origin = options.origin;
  if (options.body !== undefined) { headers["content-length"] = String(Buffer.byteLength(options.body)); }
  return new Request(`http://127.0.0.1:8082${path}`, { method: options.method ?? "GET", headers, body: options.body });
}

describe("Saber v1 read API", () => {
  it("returns only minimal health and OpenAPI routes require authentication", async () => {
    const healthy = await handleApiV1(request("/api/v1/health"));
    expect(await healthy?.json()).toEqual({ data: { status: "ok", apiVersion: "1.0.0" } });
    const openapi = await handleApiV1(request("/api/v1/openapi.json"), { token });
    expect(openapi?.status).toBe(401);
    expect(await (await handleApiV1(request("/api/v1/openapi.json", { token }), { token }))?.json()).toMatchObject({ openapi: "3.1.0" });
  });

  it("documents only GET operations for the read API", () => {
    for (const path of Object.values(openApiDocument.paths)) {
      const operations = Object.keys(path).filter((key) => ["get", "post", "put", "patch", "delete", "options"].includes(key));
      expect(operations).toEqual(["get"]);
    }
    expect(openApiDocument.paths["/api/v1/health"].get.security).toEqual([]);
  });

  it("applies one generic auth failure to every protected resource", async () => {
    const { task, run, store } = fixture();
    const paths = ["/api/v1/openapi.json", "/api/v1/providers", "/api/v1/tasks", `/api/v1/tasks/${task.id}`,
      `/api/v1/tasks/${task.id}/runs`, `/api/v1/runs/${run.id}`, `/api/v1/runs/${run.id}/events`,
      `/api/v1/tasks/${task.id}/verifications`, `/api/v1/tasks/${task.id}/workspace`];
    const invalidCredentials = [undefined, "Bearer short", `Bearer ${"x".repeat(43)}`];
    const cases = paths.flatMap((path) => invalidCredentials.map((authorization) => ({ path, authorization })));
    const responses = await Promise.all(cases.map(({ path, authorization }) => handleApiV1(request(path, {
      headers: authorization ? { authorization } : {},
    }), { token, store })));
    expect(responses.map((response) => response?.status)).toEqual(cases.map(() => 401));
    const bodies = await Promise.all(responses.map((response) => response!.json()));
    expect(bodies.map(({ error }) => ({ code: error.code, message: error.message }))).toEqual(cases.map(() => ({ code: "unauthorized", message: "A valid Saber API token is required." })));
  });

  it("maps task and run records without leaking machine paths or native identities", async () => {
    const { task, run, store } = fixture();
    store.setNativeSession(run.id, "private-native-id");
    const taskResponse = await handleApiV1(request(`/api/v1/tasks/${task.id}`, { token }), { token, store });
    const taskBody = await taskResponse!.json();
    expect(taskBody.data.projectName).toBe("sample-project");
    expect(taskBody.data.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(taskBody.data.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(taskBody.data.project).toBeUndefined();
    expect(JSON.stringify(taskBody)).not.toContain("C:\\Users");
    const runResponse = await handleApiV1(request(`/api/v1/runs/${run.id}`, { token }), { token, store });
    const runBody = await runResponse!.json();
    expect(runBody.data).toMatchObject({ id: run.id, provider: "codex", status: "running" });
    expect(JSON.stringify(runBody)).not.toContain("nativeSessionId");
    expect(JSON.stringify(runBody)).not.toContain("private-native-id");
    expect(runBody.data.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it("returns ordered event summaries without provider output text", async () => {
    const { run, store } = fixture();
    const response = await handleApiV1(request(`/api/v1/runs/${run.id}/events?after=0&limit=10`, { token }), { token, store });
    const body = await response!.json();
    expect(body.data.events).toEqual([{ sequence: 1, type: "provider_event", provider: "codex", categories: ["agent_message"] }]);
    expect(body.data.nextCursor).toBe(1);
    expect(JSON.stringify(body)).not.toContain("secret-provider-output");
    expect(JSON.stringify(body)).not.toContain("secret response text");
    const nextPage = await handleApiV1(request(`/api/v1/runs/${run.id}/events?after=1&limit=10`, { token }), { token, store });
    expect((await nextPage!.json()).data).toMatchObject({ nextCursor: 1, events: [], hasMore: false });
  });

  it("scopes run and verification collections to their task and paginates", async () => {
    const { task, run, store } = fixture();
    const otherTask = store.createTask({ project: task.project, title: "Second", spec: "Other", criteria: "AC-2: isolated" });
    store.finishRun(run.id, "done", 0);
    const otherRun = store.createRun(otherTask.id, "another", undefined, "opencode");
    store.createVerification({ id: "verification-1", taskId: task.id, criterionId: "AC-1", criterionText: "expose only review data", revision: 1,
      outcome: "passed", check: "test", evidence: "checked", runId: run.id, checkedAt: Date.now() });
    const response = await handleApiV1(request(`/api/v1/tasks/${task.id}/runs?limit=1&cursor=0`, { token }), { token, store });
    const body = await response!.json();
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0].id).toBe(run.id);
    expect(body.data.items[0].taskId).toBe(task.id);
    const verifications = await handleApiV1(request(`/api/v1/tasks/${task.id}/verifications`, { token }), { token, store });
    expect((await verifications!.json()).data.items).toHaveLength(1);
    expect(otherRun.taskId).not.toBe(task.id);
  });

  it("returns provider and workspace review projections without paths or diffs", async () => {
    const { task, store } = fixture();
    store.setWorkspace(task.id, { path: "C:\\private\\workspace", source: task.project, baseCommit: "abc", targetBranch: "main", branch: "codex/saber", state: "ready" });
    const providers = await handleApiV1(request("/api/v1/providers", { token }), {
      token, store, providerStatus: async (id) => ({ id, installed: true, auth: "ready" }),
    });
    expect((await providers!.json()).data).toHaveLength(3);
    const workspace = await handleApiV1(request(`/api/v1/tasks/${task.id}/workspace`, { token }), {
      token, store, workspaceReview: () => ({ head: "abc123", branch: "codex/saber", status: " M src/main.ts", diff: "private diff" }),
    });
    const result = await workspace!.json();
    expect(result.data).toEqual({ head: "abc123", branch: "codex/saber", changedFileCount: 1 });
    expect(JSON.stringify(result)).not.toContain("private diff");
    expect(JSON.stringify(result)).not.toContain("C:\\private");
  });

  it("rejects bad pagination, hostile origins, foreign hosts, and oversized input", async () => {
    const { store } = fixture();
    const sameOrigin = await handleApiV1(request("/api/v1/tasks", { token, origin: "http://127.0.0.1:8082" }), { token, store });
    expect(sameOrigin?.status).toBe(200);
    const badCursor = await handleApiV1(request("/api/v1/tasks?cursor=-1", { token }), { token, store });
    expect(badCursor?.status).toBe(400);
    expect((await badCursor!.json()).error.code).toBe("cursor_invalid");
    const badOrigin = await handleApiV1(request("/api/v1/tasks", { token, origin: "http://evil.example" }), { token, store });
    expect(badOrigin?.status).toBe(403);
    const badHost = await handleApiV1(request("/api/v1/tasks", { token, host: "192.168.1.8:8082" }), { token, store });
    expect(badHost?.status).toBe(403);
    const tooLarge = await handleApiV1(request("/api/v1/tasks", { token, headers: { "content-length": "9000" } }), { token, store });
    expect(tooLarge?.status).toBe(413);
    const tooLongQuery = await handleApiV1(request(`/api/v1/tasks?${"x".repeat(2050)}`, { token }), { token, store });
    expect(tooLongQuery?.status).toBe(413);
    const malformedId = await handleApiV1(request("/api/v1/tasks/%E0%A4%A", { token }), { token, store });
    expect(malformedId?.status).toBe(400);
    const missingTask = await handleApiV1(request("/api/v1/tasks/missing-task", { token }), { token, store });
    expect(missingTask?.status).toBe(404);
  });

  it("rejects mutations and unknown routes without changing task data", async () => {
    const { task, store } = fixture();
    const before = store.getTask(task.id);
    const documentedPaths = Object.keys(openApiDocument.paths);
    for (const path of documentedPaths) {
      const resolvedPath = path.replace("{taskId}", task.id).replace("{runId}", "missing-run");
      for (const method of ["POST", "PATCH", "DELETE"]) {
        const mutation = await handleApiV1(request(resolvedPath, { token, method }), { token, store, providerStatus: async (id) => ({ id, installed: true, auth: "unknown" }) });
        expect(mutation?.status, `${method} ${resolvedPath}`).toBe(405);
        expect(mutation?.headers.get("allow")).toBe("GET");
      }
    }
    expect(store.getTask(task.id)).toEqual(before);
    const missing = await handleApiV1(request("/api/v1/unknown", { token }), { token, store });
    expect(missing?.status).toBe(404);
    const apiRoot = await handleApiV1(request("/api/v1", { token }), { token, store });
    expect(apiRoot?.status).toBe(404);
    expect(store.getTask(task.id)).toEqual(before);
  });

  it("uses safe errors and does not log exception details", async () => {
    const { task, store } = fixture();
    store.setWorkspace(task.id, { path: "C:\\private\\workspace", source: task.project, baseCommit: "abc", targetBranch: "main", branch: "codex/saber", state: "ready" });
    const sentinel = "secret C:\\private\\token-path";
    const log = vi.fn();
    const response = await handleApiV1(request(`/api/v1/tasks/${task.id}/workspace`, { token }), {
      token, store, workspaceReview: () => { throw new Error(sentinel); }, logError: log,
    });
    const body = await response!.text();
    expect(response?.status).toBe(500);
    expect(body).not.toContain(sentinel);
    expect(body).toContain("internal_error");
    expect(JSON.stringify(log.mock.calls)).not.toContain(sentinel);
  });

  it("returns no wildcard CORS and no-store on v1 reads", async () => {
    const { store } = fixture();
    const response = await handleApiV1(request("/api/v1/tasks", { token }), { token, store });
    expect(response?.headers.get("access-control-allow-origin")).toBeNull();
    expect(response?.headers.get("cache-control")).toBe("no-store");
  });

  it("caps oversized page responses", async () => {
    const { task, store } = fixture();
    for (let index = 0; index < 24; index++) {
      store.createTask({ project: task.project, title: `Large ${index}`, spec: "s".repeat(100_000), criteria: "AC-1: bounded" });
    }
    const response = await handleApiV1(request("/api/v1/tasks?limit=100", { token }), { token, store });
    expect(response?.status).toBe(413);
    expect((await response!.json()).error.code).toBe("response_too_large");
  });
});
