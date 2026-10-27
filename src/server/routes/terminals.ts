import { jsonResponse, errorResponse } from "../http";
import { getTaskStore } from "../taskStore";
import { getTerminalLocks } from "../terminalLocks";
import type { RouteHandler } from "./types";

export const handle: RouteHandler = async (ctx) => {
  const { request, path } = ctx;

  if (path === "/api/terminals" && request.method === "GET") {
    const store = getTaskStore();
    return jsonResponse(store.listTerminalSessions());
  }
  if (path === "/api/terminals/reconcile" && request.method === "POST") {
    try {
      const body = await request.json() as { liveSessionIds?: unknown };
      if (!Array.isArray(body?.liveSessionIds) || body.liveSessionIds.length > 1000
        || body.liveSessionIds.some((id) => typeof id !== "string" || id.length > 128)) {
        return jsonResponse({ error: "Invalid live terminal session list" }, 400);
      }
      const records = getTerminalLocks().reconcile(getTaskStore(), body.liveSessionIds as string[]);
      return jsonResponse(records);
    } catch (error) { return errorResponse(error, 400); }
  }
  const runningTerminalMatch = /^\/api\/terminals\/([^/]+)\/running$/.exec(path);
  if (runningTerminalMatch && request.method === "POST") {
    try {
      const store = getTaskStore();
      const record = store.setTerminalSessionStatus(runningTerminalMatch[1], "running");
      return jsonResponse(record);
    } catch (error) { return errorResponse(error, 409); }
  }
  const recoverTerminalMatch = /^\/api\/terminals\/([^/]+)\/recover$/.exec(path);
  if (recoverTerminalMatch && request.method === "POST") {
    try {
      const body = await request.json() as { confirmedStopped?: unknown };
      const record = getTaskStore().recoverTerminalSession(recoverTerminalMatch[1], body?.confirmedStopped === true);
      return jsonResponse(record);
    } catch (error) { return errorResponse(error, 409); }
  }
  const terminalMatch = /^\/api\/terminals\/([^/]+)$/.exec(path);
  if (terminalMatch && request.method === "DELETE") {
    try {
      const store = getTaskStore();
      const record = store.getTerminalSession(terminalMatch[1]);
      if (!record) return jsonResponse({ error: "Terminal session not found" }, 404);
      if (record.status === "interrupted") return jsonResponse({ error: "Confirm recovery for an interrupted terminal session" }, 409);
      store.setTerminalSessionStatus(record.id, "stopped");
      return jsonResponse({ ok: true });
    } catch (error) { return errorResponse(error, 409); }
  }

  return null;
};
