import { handle as handleTasks } from "./tasks";
import { handle as handleTerminals } from "./terminals";
import { handle as handleSessions } from "./sessions";
import { handle as handleProjects } from "./projects";
import { handle as handleRoles } from "./roles";
import { handle as handleEnvironment } from "./environment";
import { jsonResponse } from "../http";
import type { RouteHandler } from "./types";

// Order only matters for overlapping paths, which the route sets do not have today.
// Keeping the original single-file order makes a future overlap obvious.
const handlers: RouteHandler[] = [
  handleTasks,
  handleTerminals,
  handleSessions,
  handleProjects,
  handleRoles,
  handleEnvironment,
];

export async function handleApi(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/")) return null;
  const ctx = { request, url, path };
  for (const handler of handlers) {
    const response = await handler(ctx);
    if (response) return response;
  }
  return jsonResponse({ error: "not found" }, 404);
}
