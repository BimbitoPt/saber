import "./lib/error-capture";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";

import { consumeLastCapturedError, describeError } from "./lib/error-capture";
import { getTaskStore } from "./server/taskStore";
import { getAgentRuns } from "./server/agentRuns";
import { GitWorkspaceService, taskWorkdir } from "./server/gitWorkspaces";
import { getTerminalLocks } from "./server/terminalLocks";
import { createVerificationRecord, summarizeVerification } from "./lib/verification";
import type { TaskInput, TaskPatch, ProviderId, ScopePreview } from "./lib/tasks";
import { providerStatus } from "./server/providers/executables";
import { reloadProjects } from "./server/projects";
import { startDevServer, listDevServers, stopDevServer } from "./server/devServers";
import { goto as browserGoto, screenshot as browserShot, act as browserAct, currentUrl } from "./server/browser";
import { handleApiV1 } from "./server/apiV1";
import { ProjectProfiles } from "./server/projectProfiles";
import { getSpecialistTeams } from "./server/specialistTeams";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function projectProfiles() {
  return new ProjectProfiles(getTaskStore());
}

function profileError(error: unknown) {
  const message = String(error);
  const status = /not found/i.test(message) ? 404
    : /only draft|active revision|already|belongs to another|cannot change|interrupted|interactive terminal|at most|must include|stale|local changes|branch changed/i.test(message) ? 409 : 400;
  return jsonResponse({ error: message }, status);
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

interface StartSessionBody {
  project?: unknown;
  task?: unknown;
  model?: unknown;
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const versionedResponse = await handleApiV1(request);
      if (versionedResponse) return versionedResponse;
      const apiResponse = await handleApi(request);
      if (apiResponse) return apiResponse;

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      const contentType = response.headers.get("content-type") ?? "";
      if (response.status >= 500 && contentType.includes("application/json")) {
        const body = await response.clone().text();
        if (body.includes('"unhandled":true')) {
          console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
        }
      }
      return response;
    } catch (error) {
      console.error(describeError(error));
      return new Response("Saber server error", { status: 500 });
    }
  },
};

async function handleApi(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (!path.startsWith("/api/")) return null;

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
    } catch (error) { return jsonResponse({ error: String(error) }, 400); }
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
        return jsonResponse({ error: message }, status);
      }
    }
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  const workspaceMatch = /^\/api\/tasks\/([^/]+)\/workspace(\/merge)?$/.exec(path);
  if (workspaceMatch) {
    try {
      const service = new GitWorkspaceService(getTaskStore(), (directory) => getAgentRuns().hasActiveWorkspace(directory));
      const id = workspaceMatch[1];
      if (!getTaskStore().getTask(id)) return jsonResponse({ error: "Task not found" }, 404);
      if (workspaceMatch[2] && request.method === "POST") {
        const body = await request.json() as { head?: unknown };
        if (!body || typeof body.head !== "string") return jsonResponse({ error: "A reviewed commit is required" }, 400);
        return jsonResponse(service.merge(id, body.head));
      }
      if (!workspaceMatch[2]) {
        if (request.method === "GET") return jsonResponse(service.review(id));
        if (request.method === "POST") return jsonResponse(service.create(id));
        if (request.method === "DELETE") return jsonResponse(service.remove(id));
      }
      return jsonResponse({ error: "Method not allowed" }, 405);
    } catch (error) { return jsonResponse({ error: String(error) }, 409); }
  }
  const taskTerminalMatch = /^\/api\/tasks\/([^/]+)\/terminals$/.exec(path);
  if (taskTerminalMatch) {
    const store = getTaskStore();
    const task = store.getTask(taskTerminalMatch[1]);
    if (!task) return jsonResponse({ error: "Task not found" }, 404);
    if (request.method === "GET") return jsonResponse(store.listTerminalSessions(task.id));
    if (request.method === "POST") {
      try {
        const workdir = taskWorkdir(task);
        const lock = getTerminalLocks().reserve(store, task.id, workdir);
        return jsonResponse(lock, 201);
      } catch (error) { return jsonResponse({ error: String(error) }, 409); }
    }
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  if (path === "/api/terminals" && request.method === "GET") {
    const store = getTaskStore();
    getTerminalLocks().hydrate(store);
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
    } catch (error) { return jsonResponse({ error: String(error) }, 400); }
  }
  const runningTerminalMatch = /^\/api\/terminals\/([^/]+)\/running$/.exec(path);
  if (runningTerminalMatch && request.method === "POST") {
    try {
      const store = getTaskStore();
      const record = store.setTerminalSessionStatus(runningTerminalMatch[1], "running");
      getTerminalLocks().hydrate(store);
      return jsonResponse(record);
    } catch (error) { return jsonResponse({ error: String(error) }, 409); }
  }
  const recoverTerminalMatch = /^\/api\/terminals\/([^/]+)\/recover$/.exec(path);
  if (recoverTerminalMatch && request.method === "POST") {
    try {
      const body = await request.json() as { confirmedStopped?: unknown };
      const record = getTaskStore().recoverTerminalSession(recoverTerminalMatch[1], body?.confirmedStopped === true);
      getTerminalLocks().release(record.id);
      return jsonResponse(record);
    } catch (error) { return jsonResponse({ error: String(error) }, 409); }
  }
  const terminalMatch = /^\/api\/terminals\/([^/]+)$/.exec(path);
  if (terminalMatch && request.method === "DELETE") {
    try {
      const store = getTaskStore();
      const record = store.getTerminalSession(terminalMatch[1]);
      if (!record) return jsonResponse({ error: "Terminal session not found" }, 404);
      if (record.status === "interrupted") return jsonResponse({ error: "Confirm recovery for an interrupted terminal session" }, 409);
      store.setTerminalSessionStatus(record.id, "stopped");
      getTerminalLocks().release(record.id);
      return jsonResponse({ ok: true });
    } catch (error) { return jsonResponse({ error: String(error) }, 409); }
  }
  if (taskMatch && request.method === "PATCH") {
    try {
      if (!getTaskStore().getTask(taskMatch[1])) return jsonResponse({ error: "Task not found" }, 404);
      const body = await request.json() as TaskPatch;
      if (!body || Array.isArray(body) || typeof body !== "object") throw new Error("Invalid task patch");
      return jsonResponse(getTaskStore().updateTask(taskMatch[1], body));
    } catch (error) { return jsonResponse({ error: String(error) }, 400); }
  }

  const taskRuns = /^\/api\/tasks\/([^/]+)\/runs$/.exec(path);
  const taskRunsPreview = /^\/api\/tasks\/([^/]+)\/runs\/preview$/.exec(path);
  if (taskRunsPreview && request.method === "POST") {
    try {
      const body = await request.json().catch(() => ({})) as { provider?: unknown };
      const provider = (body.provider ?? "opencode") as ProviderId;
      if (!["opencode", "codex", "claude"].includes(provider)) return jsonResponse({ error: "Invalid provider" }, 400);
      if (!getTaskStore().getTask(taskRunsPreview[1])) return jsonResponse({ error: "Task not found" }, 404);
      const preview: ScopePreview = getAgentRuns().preview(taskRunsPreview[1], provider);
      return jsonResponse(preview);
    } catch (error) { return jsonResponse({ error: String(error) }, 400); }
  }
  if (taskRuns && request.method === "GET") {
    return jsonResponse(getTaskStore().listRuns(taskRuns[1]));
  }
  const runReviewMatch = /^\/api\/tasks\/([^/]+)\/runs\/([^/]+)\/(review|merge)$/.exec(path);
  if (runReviewMatch && runReviewMatch[3] === "review" && request.method === "GET") {
    try {
      const service = new GitWorkspaceService(getTaskStore(), (directory) => getAgentRuns().hasActiveWorkspace(directory));
      return jsonResponse(service.reviewRunWorktree(runReviewMatch[1], runReviewMatch[2]));
    } catch (error) { return profileError(error); }
  }
  if (runReviewMatch && runReviewMatch[3] === "merge" && request.method === "POST") {
    try {
      const body = await request.json() as { head?: unknown };
      if (!body || typeof body.head !== "string") return jsonResponse({ error: "A reviewed commit is required" }, 400);
      const service = new GitWorkspaceService(getTaskStore(), (directory) => getAgentRuns().hasActiveWorkspace(directory));
      return jsonResponse(service.mergeRunWorktree(runReviewMatch[1], runReviewMatch[2], body.head));
    } catch (error) { return profileError(error); }
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
      const id = await getAgentRuns().start(taskRuns[1], { provider, model: body.model as string | undefined, followup: body.followup as string | undefined });
      return jsonResponse({ id }, 201);
    } catch (error) { return jsonResponse({ error: String(error) }, 409); }
  }

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
      const id = await getAgentRuns().start(record.id, { model });
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
    catch (error) { return jsonResponse({ error: String(error) }, 409); }
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
      const id = await getAgentRuns().start(run.taskId, { provider: run.provider, followup: body.task });
      return jsonResponse({ id }, 201);
    } catch (error) {
      console.error(describeError(error));
      return jsonResponse({ error: describeError(error).slice(0, 200) }, 500);
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
    } catch (error) { return profileError(error); }
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
    } catch (error) { return profileError(error); }
  }

  if (path === "/api/project-profiles/drafts" && request.method === "POST") {
    try {
      const body = await request.json() as { root?: unknown; entries?: unknown; discover?: unknown };
      if (!body || typeof body.root !== "string") return jsonResponse({ error: "Project root is required" }, 400);
      if (body.discover === true) return jsonResponse(profiles.discoverDraft(body.root), 201);
      if (!Array.isArray(body.entries)) return jsonResponse({ error: "Entries or discovery are required" }, 400);
      return jsonResponse(profiles.saveDraft(body.root, body.entries), 201);
    } catch (error) { return profileError(error); }
  }

  if (path === "/api/project-profiles/refresh" && request.method === "POST") {
    try {
      const body = await request.json() as { root?: unknown };
      if (!body || typeof body.root !== "string") return jsonResponse({ error: "Project root is required" }, 400);
      return jsonResponse(profiles.refreshProject(body.root), 201);
    } catch (error) { return profileError(error); }
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
    } catch (error) { return profileError(error); }
  }

  const teams = getSpecialistTeams();
  if (path === "/api/roles" && request.method === "GET") {
    try {
      const root = url.searchParams.get("root");
      if (!root) return jsonResponse({ error: "Project root is required" }, 400);
      return jsonResponse(teams.listRoles(root));
    } catch (error) { return profileError(error); }
  }

  if (path === "/api/roles" && request.method === "POST") {
    try {
      const body = await request.json() as { root?: unknown; id?: unknown; displayName?: unknown; instructions?: unknown; write?: unknown; providers?: unknown };
      if (!body || typeof body.root !== "string") return jsonResponse({ error: "Project root is required" }, 400);
      return jsonResponse(teams.createRole(body.root, body), 201);
    } catch (error) { return profileError(error); }
  }

  const roleMatch = /^\/api\/roles\/([^/]+)$/.exec(path);
  if (roleMatch && request.method === "PATCH") {
    try {
      const root = url.searchParams.get("root");
      if (!root) return jsonResponse({ error: "Project root is required" }, 400);
      const body = await request.json() as { displayName?: unknown; instructions?: unknown; write?: unknown; providers?: unknown; enabled?: unknown };
      if (!body || typeof body !== "object" || Array.isArray(body)) return jsonResponse({ error: "Invalid role patch" }, 400);
      return jsonResponse(teams.updateRole(root, roleMatch[1], body));
    } catch (error) { return profileError(error); }
  }

  const teamMatch = /^\/api\/tasks\/([^/]+)\/teams(\/plan)?$/.exec(path);
  if (teamMatch && !teamMatch[2] && request.method === "GET") {
    return jsonResponse(getTaskStore().listTeams(teamMatch[1]));
  }
  if (teamMatch && teamMatch[2] === "/plan" && request.method === "POST") {
    try {
      const body = await request.json() as { members?: unknown };
      if (!body || !Array.isArray(body.members)) return jsonResponse({ error: "Team members are required" }, 400);
      return jsonResponse(getSpecialistTeams().planTeam(teamMatch[1], body.members));
    } catch (error) { return profileError(error); }
  }
  if (teamMatch && !teamMatch[2] && request.method === "POST") {
    try {
      const body = await request.json() as { members?: unknown };
      if (!body || !Array.isArray(body.members)) return jsonResponse({ error: "Team members are required" }, 400);
      const planner = getSpecialistTeams();
      const plan = planner.planTeam(teamMatch[1], body.members);
      for (const member of plan.members) {
        const readiness = await providerStatus(member.provider);
        if (!readiness.installed || readiness.auth === "signed-out") return jsonResponse({ error: readiness.message }, 409);
      }
      return jsonResponse(await planner.launchTeam(teamMatch[1], body.members), 201);
    } catch (error) { return profileError(error); }
  }

  if (path === "/api/dev-servers" && request.method === "GET") {
    return jsonResponse(listDevServers());
  }

  if (path === "/api/dev-servers/start" && request.method === "POST") {
    try {
      const body = JSON.parse(await request.text()) as { project?: unknown };
      if (typeof body.project !== "string") {
        return jsonResponse({ error: "project is required" }, 400);
      }
      const result = await startDevServer(body.project);
      return jsonResponse(result, 201);
    } catch (error) {
      console.error(describeError(error));
      return jsonResponse({ error: describeError(error).slice(0, 200) }, 500);
    }
  }

  if (path === "/api/dev-servers/stop" && request.method === "POST") {
    try {
      const body = JSON.parse(await request.text()) as { project?: unknown };
      if (typeof body.project === "string" && stopDevServer(body.project)) {
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ error: "not running" }, 404);
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400);
    }
  }

  if (path === "/api/browser/goto" && request.method === "POST") {
    try {
      const body = JSON.parse(await request.text()) as { url?: unknown };
      if (typeof body.url !== "string") return jsonResponse({ error: "url is required" }, 400);
      await browserGoto(body.url);
      return jsonResponse({ ok: true, url: await currentUrl() });
    } catch (error) {
      console.error(describeError(error));
      return jsonResponse({ error: describeError(error).slice(0, 300) }, 500);
    }
  }

  if (path === "/api/browser/act" && request.method === "POST") {
    try {
      const body = JSON.parse(await request.text()) as { action?: unknown; target?: unknown; value?: unknown };
      if (typeof body.action !== "string" || typeof body.target !== "string") {
        return jsonResponse({ error: "action and target are required" }, 400);
      }
      await browserAct(body.action, body.target, typeof body.value === "string" ? body.value : undefined);
      return jsonResponse({ ok: true });
    } catch (error) {
      console.error(describeError(error));
      return jsonResponse({ error: describeError(error).slice(0, 200) }, 500);
    }
  }

  if (path === "/api/browser/screenshot" && request.method === "GET") {
    try {
      const png = await browserShot();
      return new Response(new Uint8Array(png), {
        headers: { "content-type": "image/png", "cache-control": "no-store" },
      });
    } catch (error) {
      console.error(describeError(error));
      return jsonResponse({ error: "browser not ready" }, 503);
    }
  }

  return jsonResponse({ error: "not found" }, 404);
}

function resolveWorkdir(projectRef: string): string {
  const looksLikePath = projectRef.includes("\\") || projectRef.includes("/");
  const path = looksLikePath ? projectRef : reloadProjects().find((p) => p.name === projectRef)?.path;
  if (!path || !isAbsolute(path)) throw new Error("Choose an absolute project directory");
  const canonical = realpathSync(path);
  if (!statSync(canonical).isDirectory()) throw new Error("Project path must be a directory");
  return canonical;
}

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
