import { jsonResponse, routeError } from "../http";
import { describeError } from "../../lib/error-capture";
import { getTaskStore } from "../taskStore";
import { reloadProjects } from "../projects";
import { ProjectProfiles } from "../projectProfiles";
import { resolveWorkdir } from "./shared";
import type { RouteHandler } from "./types";

function projectProfiles() {
  return new ProjectProfiles(getTaskStore());
}

export const handle: RouteHandler = async (ctx) => {
  const { request, url, path } = ctx;

  if (path === "/api/projects" && request.method === "GET") {
    try {
      return jsonResponse(reloadProjects());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return jsonResponse([]);
      console.error(describeError(error));
      return jsonResponse({ error: "projects inventory unreadable" }, 500);
    }
  }

  const profiles = projectProfiles();
  if (path === "/api/project-records" && request.method === "GET") {
    return jsonResponse(getTaskStore().listProjects());
  }

  if (path === "/api/project-records" && request.method === "POST") {
    try {
      const body = await request.json() as { path?: unknown; displayName?: unknown };
      if (!body || typeof body.path !== "string") return jsonResponse({ error: "Project path is required" }, 400);
      if (typeof body.displayName !== "undefined" && typeof body.displayName !== "string") return jsonResponse({ error: "Invalid display name" }, 400);
      return jsonResponse(profiles.registerProject(resolveWorkdir(body.path), body.displayName), 201);
    } catch (error) { return routeError(error); }
  }

  if (path === "/api/project-profiles" && request.method === "GET") {
    try {
      const root = url.searchParams.get("root");
      if (!root) return jsonResponse({ error: "Project root is required" }, 400);
      const store = getTaskStore();
      const project = store.getProject(root);
      if (!project) return jsonResponse({ project: null, revisions: [], activeRevision: null, stale: false, changed: [] });
      const revisions = store.listProfileRevisions(project.root);
      const activeRevision = project.activeRevisionId ? store.getProfileRevision(project.activeRevisionId) ?? null : null;
      const staleness = activeRevision ? profiles.checkStaleness(activeRevision.id) : { stale: false, changed: [] as string[] };
      return jsonResponse({ project, revisions, activeRevision, stale: staleness.stale, changed: staleness.changed });
    } catch (error) { return routeError(error); }
  }

  if (path === "/api/project-profiles/drafts" && request.method === "POST") {
    try {
      const body = await request.json() as { root?: unknown; entries?: unknown; discover?: unknown };
      if (!body || typeof body.root !== "string") return jsonResponse({ error: "Project root is required" }, 400);
      if (body.discover === true) return jsonResponse(profiles.discoverDraft(body.root), 201);
      if (!Array.isArray(body.entries)) return jsonResponse({ error: "Entries or discovery are required" }, 400);
      return jsonResponse(profiles.saveDraft(body.root, body.entries), 201);
    } catch (error) { return routeError(error); }
  }

  if (path === "/api/project-profiles/refresh" && request.method === "POST") {
    try {
      const body = await request.json() as { root?: unknown };
      if (!body || typeof body.root !== "string") return jsonResponse({ error: "Project root is required" }, 400);
      return jsonResponse(profiles.refreshProject(body.root), 201);
    } catch (error) { return routeError(error); }
  }

  const revisionMatch = /^\/api\/project-revisions\/([^/]+)(\/approve|\/discard)?$/.exec(path);
  if (revisionMatch) {
    try {
      const id = revisionMatch[1];
      if (revisionMatch[2] === "/approve" && request.method === "POST") return jsonResponse(profiles.approveRevision(id));
      if (revisionMatch[2] === "/discard" && request.method === "POST") {
        profiles.discardDraft(id);
        return jsonResponse({ ok: true });
      }
      if (!revisionMatch[2] && request.method === "PATCH") {
        const body = await request.json() as { entries?: unknown };
        if (!body || !Array.isArray(body.entries)) return jsonResponse({ error: "Entries are required" }, 400);
        return jsonResponse(profiles.editDraft(id, body.entries));
      }
      return jsonResponse({ error: "Method not allowed" }, 405);
    } catch (error) { return routeError(error); }
  }

  return null;
};
