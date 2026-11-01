import { jsonResponse, errorResponse, routeError } from "../http";
import { getTaskStore, MissingPreconditionError, StaleTaskError } from "../taskStore";
import { getAgentRuns } from "../agentRuns";
import { GitWorkspaceService, taskWorkdir } from "../gitWorkspaces";
import { getTerminalLocks } from "../terminalLocks";
import { createVerificationRecord, summarizeVerification } from "../../lib/verification";
import type { TaskInput, TaskPatch, ProviderId, ScopePreview } from "../../lib/tasks";
import { providerStatus } from "../providers/executables";
import { resolveWorkdir } from "./shared";
import type { RouteHandler } from "./types";

export const handle: RouteHandler = async (ctx) => {
  const { request, path } = ctx;

  if (path === "/api/providers" && request.method === "GET") {
    return jsonResponse(await Promise.all((["opencode", "codex", "claude"] as const).map((id) => providerStatus(id))));
  }

  if (path === "/api/tasks" && request.method === "GET") {
    return jsonResponse(getTaskStore().listTasks());
  }

  if (path === "/api/tasks" && request.method === "POST") {
    try {
      const body = await request.json() as TaskInput;
      if (!body || typeof body.project !== "string") throw new Error("project is required");
      return jsonResponse(getTaskStore().createTask({ ...body, project: resolveWorkdir(body.project) }), 201);
    } catch (error) { return errorResponse(error, 400); }
  }

  const taskMatch = /^\/api\/tasks\/([^/]+)$/.exec(path);
  const verificationMatch = /^\/api\/tasks\/([^/]+)\/verifications$/.exec(path);
  if (verificationMatch) {
    const store = getTaskStore();
    const task = store.getTask(verificationMatch[1]);
    if (!task) return jsonResponse({ error: "Task not found" }, 404);
    if (request.method === "GET") {
      const records = store.listVerifications(task.id);
      return jsonResponse({ records, summary: summarizeVerification(task.criteria, task.revision, records) });
    }
    if (request.method === "POST") {
      try {
        const body = await request.json() as { criterionId?: unknown; outcome?: unknown; check?: unknown; evidence?: unknown; runId?: unknown };
        if (!body || typeof body !== "object" || Array.isArray(body)) return jsonResponse({ error: "Invalid verification record" }, 400);
          const run = typeof body?.runId === "string" ? store.getRun(body.runId) : undefined;
          const record = createVerificationRecord(task, body, run);
          store.createVerification(record);
          const records = store.listVerifications(task.id);
        return jsonResponse({ record, records, summary: summarizeVerification(task.criteria, task.revision, records) }, 201);
      } catch (error) {
        const message = String(error);
        const status = message.includes("Run not found") ? 404 : message.includes("current task revision") || message.includes("current spec revision") ? 409 : 400;
        return errorResponse(error, status);
      }
    }
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  const workspaceMatch = /^\/api\/tasks\/([^/]+)\/workspace(\/merge)?$/.exec(path);
  if (workspaceMatch) {
    try {
      const service = new GitWorkspaceService(getTaskStore(), (directory) => getAgentRuns().hasActiveWorkspace(directory), undefined, request.signal);
      const id = workspaceMatch[1];
      if (!getTaskStore().getTask(id)) return jsonResponse({ error: "Task not found" }, 404);
      if (workspaceMatch[2] && request.method === "POST") {
        const body = await request.json() as { head?: unknown };
        if (!body || typeof body.head !== "string") return jsonResponse({ error: "A reviewed commit is required" }, 400);
        return jsonResponse(await service.merge(id, body.head));
      }
      if (!workspaceMatch[2]) {
        if (request.method === "GET") return jsonResponse(await service.review(id));
        if (request.method === "POST") return jsonResponse(await service.create(id));
        if (request.method === "DELETE") return jsonResponse(await service.remove(id));
      }
      return jsonResponse({ error: "Method not allowed" }, 405);
    } catch (error) { return errorResponse(error, 409); }
  }
  const taskTerminalMatch = /^\/api\/tasks\/([^/]+)\/terminals$/.exec(path);
  if (taskTerminalMatch) {
    const store = getTaskStore();
    const task = store.getTask(taskTerminalMatch[1]);
    if (!task) return jsonResponse({ error: "Task not found" }, 404);
    if (request.method === "GET") return jsonResponse(store.listTerminalSessions(task.id));
    if (request.method === "POST") {
      try {
        const workdir = await taskWorkdir(task, request.signal);
        const lock = getTerminalLocks().reserve(store, task.id, workdir);
        return jsonResponse(lock, 201);
      } catch (error) { return errorResponse(error, 409); }
    }
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  if (taskMatch && request.method === "PATCH") {
    try {
      if (!getTaskStore().getTask(taskMatch[1])) return jsonResponse({ error: "Task not found" }, 404);
      const body = await request.json() as TaskPatch;
      if (!body || Array.isArray(body) || typeof body !== "object") throw new Error("Invalid task patch");
      return jsonResponse(getTaskStore().updateTask(taskMatch[1], body));
    } catch (error) {
      if (error instanceof MissingPreconditionError) return jsonResponse({ error: error.message, code: "precondition_required" }, 428);
      if (error instanceof StaleTaskError) return jsonResponse({ error: error.message, code: "stale_task" }, 409);
      return errorResponse(error, 400);
    }
  }

  const taskRuns = /^\/api\/tasks\/([^/]+)\/runs$/.exec(path);
  const taskRunsPreview = /^\/api\/tasks\/([^/]+)\/runs\/preview$/.exec(path);
  if (taskRunsPreview && request.method === "POST") {
    try {
      const body = await request.json().catch(() => ({})) as { provider?: unknown };
      const provider = (body.provider ?? "opencode") as ProviderId;
      if (!["opencode", "codex", "claude"].includes(provider)) return jsonResponse({ error: "Invalid provider" }, 400);
      if (!getTaskStore().getTask(taskRunsPreview[1])) return jsonResponse({ error: "Task not found" }, 404);
      const preview: ScopePreview = await getAgentRuns().preview(taskRunsPreview[1], provider, request.signal);
      return jsonResponse(preview);
    } catch (error) { return errorResponse(error, 400); }
  }
  if (taskRuns && request.method === "GET") {
    return jsonResponse(getTaskStore().listRuns(taskRuns[1]));
  }
  const runReviewMatch = /^\/api\/tasks\/([^/]+)\/runs\/([^/]+)\/(review|merge)$/.exec(path);
  if (runReviewMatch && runReviewMatch[3] === "review" && request.method === "GET") {
    try {
      const service = new GitWorkspaceService(getTaskStore(), (directory) => getAgentRuns().hasActiveWorkspace(directory), undefined, request.signal);
      return jsonResponse(await service.reviewRunWorktree(runReviewMatch[1], runReviewMatch[2]));
    } catch (error) { return routeError(error); }
  }
  if (runReviewMatch && runReviewMatch[3] === "merge" && request.method === "POST") {
    try {
      const body = await request.json() as { head?: unknown };
      if (!body || typeof body.head !== "string") return jsonResponse({ error: "A reviewed commit is required" }, 400);
      const service = new GitWorkspaceService(getTaskStore(), (directory) => getAgentRuns().hasActiveWorkspace(directory), undefined, request.signal);
      return jsonResponse(await service.mergeRunWorktree(runReviewMatch[1], runReviewMatch[2], body.head));
    } catch (error) { return routeError(error); }
  }
  if (taskRuns && request.method === "POST") {
    try {
      const body = await request.json() as { model?: unknown; followup?: unknown; provider?: unknown };
      if (!body || (body.model !== undefined && typeof body.model !== "string")
        || (body.provider !== undefined && (typeof body.provider !== "string" || !["opencode", "codex", "claude"].includes(body.provider)))
        || (body.followup !== undefined && (typeof body.followup !== "string" || !body.followup.trim()))) {
        return jsonResponse({ error: "Invalid run options" }, 400);
      }
      const provider = (body.provider ?? "opencode") as ProviderId;
      const readiness = await providerStatus(provider);
      if (!readiness.installed || readiness.auth === "signed-out") return jsonResponse({ error: readiness.message }, 409);
      const id = await getAgentRuns().start(taskRuns[1], { provider, model: body.model as string | undefined, followup: body.followup as string | undefined }, request.signal);
      return jsonResponse({ id }, 201);
    } catch (error) { return errorResponse(error, 409); }
  }

  return null;
};
