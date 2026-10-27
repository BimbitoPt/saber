import { jsonResponse, errorResponse } from "../http";
import { describeError } from "../../lib/error-capture";
import { getTaskStore } from "../taskStore";
import { getAgentRuns } from "../agentRuns";
import { providerStatus } from "../providers/executables";
import { resolveWorkdir } from "./shared";
import type { RouteHandler } from "./types";

interface StartSessionBody {
  project?: unknown;
  task?: unknown;
  model?: unknown;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const POLL_INTERVAL_MS = 500;
const LONG_POLL_MAX_MS = 25_000;

async function eventsPoll(id: string, after: number, wait: boolean): Promise<Response> {
  const store = getTaskStore();
  if (!Number.isSafeInteger(after) || after < 0) return jsonResponse({ error: "Invalid cursor" }, 400);
  if (!store.getRun(id)) return jsonResponse({ error: "not found" }, 404);
  const deadline = Date.now() + LONG_POLL_MAX_MS;
  while (wait && Date.now() < deadline) {
    const run = store.getRun(id)!;
    if (run.eventCount > after || run.status !== "running") break;
    await sleep(POLL_INTERVAL_MS);
  }
  return jsonResponse(store.events(id, after));
}

export const handle: RouteHandler = async (ctx) => {
  const { request, url, path } = ctx;

  const acknowledge = /^\/api\/sessions\/([^/]+)\/acknowledge$/.exec(path);
  if (acknowledge && request.method === "POST") {
    const run = getTaskStore().getRun(acknowledge[1]);
    if (!run || run.status !== "interrupted") return jsonResponse({ error: "Run is not interrupted" }, 409);
    const body = await request.json() as { processStopped?: boolean };
    if (body?.processStopped !== true) return jsonResponse({ error: "Confirm the old process has stopped" }, 400);
    getTaskStore().finishRun(run.id, "stopped", null);
    return jsonResponse({ ok: true });
  }

  if (path === "/api/sessions" && request.method === "GET") {
    return jsonResponse(getTaskStore().listRuns());
  }

  if (path === "/api/sessions" && request.method === "POST") {
    let body: StartSessionBody;
    try {
      body = JSON.parse(await request.text());
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400);
    }
    const project = typeof body.project === "string" ? body.project : "";
    const task = typeof body.task === "string" ? body.task : "";
    const model = typeof body.model === "string" ? body.model : undefined;
    if (!project || !task) {
      return jsonResponse({ error: "project and task are required" }, 400);
    }
    try {
      const record = getTaskStore().createTask({ project: resolveWorkdir(project), title: task.slice(0, 120), spec: task, criteria: "Report the changes and verification results." });
      const id = await getAgentRuns().start(record.id, { model }, request.signal);
      return jsonResponse({ id }, 201);
    } catch (error) {
      console.error(describeError(error));
      return jsonResponse({ error: "spawn failed" }, 500);
    }
  }

  const eventsMatch = /^\/api\/sessions\/([^/]+)\/events$/.exec(path);
  if (eventsMatch && request.method === "GET") {
    const id = eventsMatch[1];
    const after = Number(url.searchParams.get("after") ?? "0");
    const wait = url.searchParams.get("wait") === "1";
    return eventsPoll(id, after, wait);
  }

  const stopMatch = /^\/api\/sessions\/([^/]+)\/stop$/.exec(path);
  if (stopMatch && request.method === "POST") {
    const session = getTaskStore().getRun(stopMatch[1]);
    if (!session) return jsonResponse({ error: "not found" }, 404);
    try { await getAgentRuns().stop(session.id); }
    catch (error) { return errorResponse(error, 409); }
    return jsonResponse({ ok: true });
  }

  const followupMatch = /^\/api\/sessions\/([^/]+)\/followup$/.exec(path);
  if (followupMatch && request.method === "POST") {
    try {
      if (!followupMatch[1]) return jsonResponse({ error: "not found" }, 404);
      const body = JSON.parse(await request.text()) as { task?: unknown };
      if (typeof body.task !== "string" || !body.task.trim()) {
        return jsonResponse({ error: "task is required" }, 400);
      }
      const run = getTaskStore().getRun(followupMatch[1]);
      if (!run) return jsonResponse({ error: "not found" }, 404);
      const readiness = await providerStatus(run.provider);
      if (!readiness.installed || readiness.auth === "signed-out") return jsonResponse({ error: readiness.message }, 409);
      const id = await getAgentRuns().start(run.taskId, { provider: run.provider, followup: body.task }, request.signal);
      return jsonResponse({ id }, 201);
    } catch (error) {
      return errorResponse(error, 500);
    }
  }

  if (path === "/api/default-model" && request.method === "GET") {
    try {
      const jsonc = await import("node:fs").then((fs) =>
        fs.promises.readFile(
          process.env["USERPROFILE"] + "\\.config\\opencode\\opencode.jsonc",
          "utf8",
        ),
      );
      const match = /["']?model["']?\s*:\s*["']([^"']+)["']/.exec(jsonc);
      return jsonResponse({ default: match?.[1] ?? "opencode built-in default (per auth provider)" });
    } catch (error) {
      console.error(describeError(error));
      return jsonResponse({ default: "opencode built-in default (per auth provider)" });
    }
  }

  return null;
};
