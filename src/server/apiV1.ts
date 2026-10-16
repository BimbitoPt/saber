import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { ProviderId, RunRecord, TaskRecord, VerificationRecord } from "../lib/tasks";
import { getTaskStore, type TaskStore } from "./taskStore";
import { getOrCreateApiToken, hasValidBearerToken } from "./apiToken";
import { providerStatus } from "./providers/executables";
import { GitWorkspaceService } from "./gitWorkspaces";
import { getAgentRuns } from "./agentRuns";
import { getTerminalLocks } from "./terminalLocks";
import { openApiDocument } from "./openapi";

const API_VERSION = "1.0.0";
const MAX_QUERY_LENGTH = 2048;
const MAX_BODY_BYTES = 8192;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export interface ApiV1Dependencies {
  token?: string;
  store?: TaskStore;
  providerStatus?: (id: ProviderId) => Promise<{ id: ProviderId; installed: boolean; auth: string }>;
  workspaceReview?: (taskId: string) => { head: string; branch: string; status: string; diff?: string };
  logError?: (requestId: string, error: unknown) => void;
}

function envelope(data: unknown, status = 200) {
  const body = JSON.stringify({ data });
  if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) return failure("response_too_large", "Response exceeds the local API size limit; request a smaller page.", 413);
  return new Response(body, { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

function failure(code: string, message: string, status: number, requestId = randomUUID(), extraHeaders?: HeadersInit) {
  return new Response(JSON.stringify({ error: { code, message, requestId } }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...extraHeaders },
  });
}

function logSafeError(requestId: string, dependencies: ApiV1Dependencies) {
  if (dependencies.logError) dependencies.logError(requestId, "API request failed");
  else console.error(`[Saber API ${requestId}] request failed`);
}

function isLoopback(hostname: string) { return loopbackHosts.has(hostname.toLowerCase()); }

function validateTransport(request: Request): boolean {
  const url = new URL(request.url);
  const hostHeader = request.headers.get("host");
  if (!isLoopback(url.hostname) || !hostHeader) return false;
  let hostUrl: URL;
  try { hostUrl = new URL(`${url.protocol}//${hostHeader}`); } catch { return false; }
  if (!isLoopback(hostUrl.hostname) || hostUrl.host.toLowerCase() !== url.host.toLowerCase()) return false;
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (!isLoopback(originUrl.hostname) || originUrl.origin !== url.origin) return false;
    } catch { return false; }
  }
  return true;
}

function integerParameter(url: URL, key: string, fallback: number, min: number, max: number): number | undefined {
  const raw = url.searchParams.get(key);
  if (raw === null) return fallback;
  if (!/^(0|[1-9][0-9]*)$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : undefined;
}

function cursorOffset(raw: string | null): number | undefined {
  if (raw === null) return 0;
  if (!/^(0|[1-9][0-9]{0,9})$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : undefined;
}

function decodeId(segment: string): string | undefined {
  try {
    const value = decodeURIComponent(segment);
    return value.length > 0 && value.length <= 128 && !value.includes("/") ? value : undefined;
  } catch { return undefined; }
}

function taskDto(task: TaskRecord) {
  return {
    id: task.id, projectName: basename(task.project.replaceAll("\\", "/")), title: task.title, spec: task.spec,
    criteria: task.criteria, revision: task.revision, context: task.context, draft: task.draft,
    createdAt: new Date(task.createdAt).toISOString(), updatedAt: new Date(task.updatedAt).toISOString(),
    workspace: task.workspace ? { state: task.workspace.state, branch: task.workspace.branch } : null,
  };
}

function runDto(run: RunRecord) {
  return {
    id: run.id, taskId: run.taskId, provider: run.provider, model: run.model ?? null,
    specRevision: run.specRevision, status: run.status, eventCount: run.eventCount,
    startedAt: new Date(run.startedAt).toISOString(), endedAt: run.endedAt ? new Date(run.endedAt).toISOString() : null,
    exitCode: run.exitCode,
  };
}

function verificationDto(record: VerificationRecord) {
  return { id: record.id, taskId: record.taskId, criterionId: record.criterionId, criterionText: record.criterionText,
    revision: record.revision, outcome: record.outcome, check: record.check, evidence: record.evidence,
    runId: record.runId ?? null, checkedAt: new Date(record.checkedAt).toISOString() };
}

function paginated<T>(items: T[], offset: number, limit: number) {
  const page = items.slice(offset, offset + limit);
  const next = offset + page.length < items.length ? String(offset + page.length) : null;
  return { items: page, nextCursor: next };
}

function safeEventSummary(line: string, seq: number) {
  try {
    const event = JSON.parse(line) as { type?: unknown; provider?: unknown; items?: unknown };
    const items = Array.isArray(event.items) ? event.items as Array<{ kind?: unknown }> : [];
    const categories = [...new Set(items.map((item) => item?.kind).filter((kind): kind is string => ["agent_message", "tool", "meta"].includes(String(kind))))];
    return { sequence: seq, type: event.type === "provider_error" ? "diagnostic" : "provider_event",
      provider: ["opencode", "codex", "claude"].includes(String(event.provider)) ? event.provider : null,
      categories };
  } catch {
    return { sequence: seq, type: "provider_event", provider: null, categories: [] as string[] };
  }
}

export async function handleApiV1(request: Request, dependencies: ApiV1Dependencies = {}): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/v1" && !url.pathname.startsWith("/api/v1/")) return null;
  const requestId = randomUUID();
  const path = url.pathname;
  if (!validateTransport(request)) return failure("operation_not_allowed", "Local API requests must use the loopback origin.", 403, requestId);
  if (url.search.length > MAX_QUERY_LENGTH || Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return failure("validation_error", "Request exceeds the allowed size.", 413, requestId);
  }

  if (path === "/api/v1/health") {
    if (request.method !== "GET") return failure("operation_not_allowed", "Method not allowed.", 405, requestId, { allow: "GET" });
    return envelope({ status: "ok", apiVersion: API_VERSION });
  }

  let token: string;
  try { token = dependencies.token ?? getOrCreateApiToken(); }
  catch {
    logSafeError(requestId, dependencies);
    return failure("internal_error", "The local API could not complete this request.", 500, requestId);
  }
  if (!hasValidBearerToken(request.headers.get("authorization"), token)) {
    return failure("unauthorized", "A valid Saber API token is required.", 401, requestId);
  }
  if (path === "/api/v1/openapi.json") {
    if (request.method !== "GET") return failure("operation_not_allowed", "Method not allowed.", 405, requestId, { allow: "GET" });
    return new Response(JSON.stringify(openApiDocument), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }
  if (request.method === "OPTIONS") return failure("operation_not_allowed", "Cross-origin requests are not supported.", 405, requestId, { allow: "GET" });

  try {
    const store = dependencies.store ?? getTaskStore();
    if (path === "/api/v1/providers" && request.method === "GET") {
      const statuses = await Promise.all(((["opencode", "codex", "claude"] as const).map((provider) =>
        dependencies.providerStatus ? dependencies.providerStatus(provider) : providerStatus(provider))));
      return envelope(statuses.map(({ id, installed, auth }) => ({ id, installed, auth })));
    }

    if (path === "/api/v1/tasks" && request.method === "GET") {
      const offset = cursorOffset(url.searchParams.get("cursor"));
      const limit = integerParameter(url, "limit", DEFAULT_LIMIT, 1, MAX_LIMIT);
      if (offset === undefined) return failure("cursor_invalid", "Invalid pagination cursor.", 400, requestId);
      if (limit === undefined) return failure("validation_error", "Invalid page limit.", 400, requestId);
      return envelope(paginated(store.listTasks().map(taskDto), offset, limit));
    }

    const taskMatch = /^\/api\/v1\/tasks\/([^/]+)$/.exec(path);
    if (taskMatch && request.method === "GET") {
      const taskId = decodeId(taskMatch[1]);
      if (!taskId) return failure("validation_error", "Invalid task ID.", 400, requestId);
      const task = store.getTask(taskId);
      return task ? envelope(taskDto(task)) : failure("not_found", "Task not found.", 404, requestId);
    }

    const taskRunsMatch = /^\/api\/v1\/tasks\/([^/]+)\/runs$/.exec(path);
    if (taskRunsMatch && request.method === "GET") {
      const taskId = decodeId(taskRunsMatch[1]);
      if (!taskId) return failure("validation_error", "Invalid task ID.", 400, requestId);
      if (!store.getTask(taskId)) return failure("not_found", "Task not found.", 404, requestId);
      const offset = cursorOffset(url.searchParams.get("cursor"));
      const limit = integerParameter(url, "limit", DEFAULT_LIMIT, 1, MAX_LIMIT);
      if (offset === undefined) return failure("cursor_invalid", "Invalid pagination cursor.", 400, requestId);
      if (limit === undefined) return failure("validation_error", "Invalid page limit.", 400, requestId);
      return envelope(paginated(store.listRuns(taskId).map(runDto), offset, limit));
    }

    const taskVerificationsMatch = /^\/api\/v1\/tasks\/([^/]+)\/verifications$/.exec(path);
    if (taskVerificationsMatch && request.method === "GET") {
      const taskId = decodeId(taskVerificationsMatch[1]);
      if (!taskId) return failure("validation_error", "Invalid task ID.", 400, requestId);
      if (!store.getTask(taskId)) return failure("not_found", "Task not found.", 404, requestId);
      const offset = cursorOffset(url.searchParams.get("cursor"));
      const limit = integerParameter(url, "limit", DEFAULT_LIMIT, 1, MAX_LIMIT);
      if (offset === undefined) return failure("cursor_invalid", "Invalid pagination cursor.", 400, requestId);
      if (limit === undefined) return failure("validation_error", "Invalid page limit.", 400, requestId);
      return envelope(paginated(store.listVerifications(taskId).map(verificationDto), offset, limit));
    }

    const workspaceMatch = /^\/api\/v1\/tasks\/([^/]+)\/workspace$/.exec(path);
    if (workspaceMatch && request.method === "GET") {
      const taskId = decodeId(workspaceMatch[1]);
      if (!taskId) return failure("validation_error", "Invalid task ID.", 400, requestId);
      const task = store.getTask(taskId);
      if (!task) return failure("not_found", "Task not found.", 404, requestId);
      if (!task.workspace || task.workspace.state !== "ready") return failure("conflict", "Task has no ready workspace to review.", 409, requestId);
      const review = dependencies.workspaceReview
        ? dependencies.workspaceReview(taskId)
        : new GitWorkspaceService(store, (directory) => getAgentRuns().hasActiveWorkspace(directory) || getTerminalLocks().hasActiveWorkspace(store, directory)).review(taskId);
      return envelope({ head: review.head, branch: review.branch, changedFileCount: review.status.split("\n").filter(Boolean).length });
    }

    const runMatch = /^\/api\/v1\/runs\/([^/]+)$/.exec(path);
    if (runMatch && request.method === "GET") {
      const runId = decodeId(runMatch[1]);
      if (!runId) return failure("validation_error", "Invalid run ID.", 400, requestId);
      const run = store.getRun(runId);
      return run ? envelope(runDto(run)) : failure("not_found", "Run not found.", 404, requestId);
    }

    const eventMatch = /^\/api\/v1\/runs\/([^/]+)\/events$/.exec(path);
    if (eventMatch && request.method === "GET") {
      const runId = decodeId(eventMatch[1]);
      if (!runId) return failure("validation_error", "Invalid run ID.", 400, requestId);
      if (!store.getRun(runId)) return failure("not_found", "Run not found.", 404, requestId);
      const after = integerParameter(url, "after", 0, 0, 2_147_483_647);
      const limit = integerParameter(url, "limit", DEFAULT_LIMIT, 1, MAX_LIMIT);
      if (after === undefined) return failure("cursor_invalid", "Invalid event cursor.", 400, requestId);
      if (limit === undefined) return failure("validation_error", "Invalid page limit.", 400, requestId);
      const page = store.events(runId, after, limit);
      return envelope({ status: page.status, nextCursor: page.next,
        events: page.lines.map((line, index) => safeEventSummary(line, after + index + 1)), hasMore: page.hasMore });
    }

    const allowedRoute = path === "/api/v1/providers" || path === "/api/v1/tasks"
      || /^\/api\/v1\/tasks\/[^/]+(?:\/(?:runs|verifications|workspace))?$/.test(path)
      || /^\/api\/v1\/runs\/[^/]+(?:\/events)?$/.test(path);
    if (allowedRoute) return failure("operation_not_allowed", "Method not allowed.", 405, requestId, { allow: "GET" });
    return failure("not_found", "API resource not found.", 404, requestId);
  } catch (error) {
    logSafeError(requestId, dependencies);
    return failure("internal_error", "The local API could not complete this request.", 500, requestId);
  }
}
