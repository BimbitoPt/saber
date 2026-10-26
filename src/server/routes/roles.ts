import { jsonResponse, routeError } from "../http";
import { getTaskStore } from "../taskStore";
import { getSpecialistTeams } from "../specialistTeams";
import { providerStatus } from "../providers/executables";
import type { RouteHandler } from "./types";

export const handle: RouteHandler = async (ctx) => {
  const { request, url, path } = ctx;

  const teams = getSpecialistTeams();
  if (path === "/api/roles" && request.method === "GET") {
    try {
      const root = url.searchParams.get("root");
      if (!root) return jsonResponse({ error: "Project root is required" }, 400);
      return jsonResponse(teams.listRoles(root));
    } catch (error) { return routeError(error); }
  }

  if (path === "/api/roles" && request.method === "POST") {
    try {
      const body = await request.json() as { root?: unknown; id?: unknown; displayName?: unknown; instructions?: unknown; write?: unknown; providers?: unknown };
      if (!body || typeof body.root !== "string") return jsonResponse({ error: "Project root is required" }, 400);
      return jsonResponse(teams.createRole(body.root, body), 201);
    } catch (error) { return routeError(error); }
  }

  const roleMatch = /^\/api\/roles\/([^/]+)$/.exec(path);
  if (roleMatch && request.method === "PATCH") {
    try {
      const root = url.searchParams.get("root");
      if (!root) return jsonResponse({ error: "Project root is required" }, 400);
      const body = await request.json() as { displayName?: unknown; instructions?: unknown; write?: unknown; providers?: unknown; enabled?: unknown };
      if (!body || typeof body !== "object" || Array.isArray(body)) return jsonResponse({ error: "Invalid role patch" }, 400);
      return jsonResponse(teams.updateRole(root, roleMatch[1], body));
    } catch (error) { return routeError(error); }
  }

  const teamMatch = /^\/api\/tasks\/([^/]+)\/teams(\/plan)?$/.exec(path);
  if (teamMatch && !teamMatch[2] && request.method === "GET") {
    return jsonResponse(getTaskStore().listTeams(teamMatch[1]));
  }
  if (teamMatch && teamMatch[2] === "/plan" && request.method === "POST") {
    try {
      const body = await request.json() as { members?: unknown };
      if (!body || !Array.isArray(body.members)) return jsonResponse({ error: "Team members are required" }, 400);
      return jsonResponse(await getSpecialistTeams().planTeam(teamMatch[1], body.members));
    } catch (error) { return routeError(error); }
  }
  if (teamMatch && !teamMatch[2] && request.method === "POST") {
    try {
      const body = await request.json() as { members?: unknown };
      if (!body || !Array.isArray(body.members)) return jsonResponse({ error: "Team members are required" }, 400);
      const planner = getSpecialistTeams();
      const plan = await planner.planTeam(teamMatch[1], body.members);
      for (const member of plan.members) {
        const readiness = await providerStatus(member.provider);
        if (!readiness.installed || readiness.auth === "signed-out") return jsonResponse({ error: readiness.message }, 409);
      }
      return jsonResponse(await planner.launchTeam(teamMatch[1], body.members), 201);
    } catch (error) { return routeError(error); }
  }

  return null;
};
