import "./lib/error-capture";

import { consumeLastCapturedError, describeError } from "./lib/error-capture";
import { getProvider } from "./server/providers";
import { register, get, list, pushLine, linesSince, setStatus } from "./server/sessionStore";
import type { SessionRecord } from "./server/sessionStore";
import { reloadProjects } from "./server/projects";
import { startDevServer, listDevServers, stopDevServer } from "./server/devServers";
import { enhance } from "./server/promptEnhancer";
import { goto as browserGoto, screenshot as browserShot, act as browserAct, currentUrl } from "./server/browser";

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
      return new Response("MSTUDIO ADE server error", { status: 500 });
    }
  },
};

async function handleApi(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (!path.startsWith("/api/")) return null;

  if (path === "/api/sessions" && request.method === "GET") {
    return jsonResponse(list());
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
      const id = startSession({ project, task, model });
      return jsonResponse({ id }, 201);
    } catch (error) {
      console.error(describeError(error));
      return jsonResponse({ error: "spawn failed" }, 500);
    }
  }

  const eventsMatch = /^\/api\/sessions\/([^/]+)\/events$/.exec(path);
  if (eventsMatch && request.method === "GET") {
    const id = eventsMatch[1];
    const after = Number(url.searchParams.get("after") ?? "0") || 0;
    const wait = url.searchParams.get("wait") === "1";
    return eventsPoll(id, after, wait);
  }

  const stopMatch = /^\/api\/sessions\/([^/]+)\/stop$/.exec(path);
  if (stopMatch && request.method === "POST") {
    const session = get(stopMatch[1]);
    if (!session) return jsonResponse({ error: "not found" }, 404);
    if (session.proc) session.proc.kill();
    return jsonResponse({ ok: true });
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
      console.error(describeError(error));
      return jsonResponse({ error: "projects inventory unreadable" }, 500);
    }
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

function startSession(opts: { project: string; task: string; model?: string }): string {
  const provider = getProvider();
  const proc = provider.spawn({
    workdir: opts.project,
    task: enhance(opts.task, opts.project),
    model: opts.model,
  });
  const id = crypto.randomUUID();
  const record = {
    id,
    project: opts.project,
    task: opts.task,
    status: "running" as const,
    proc,
    eventCount: 0,
    lines: [] as string[],
    startedAt: Date.now(),
    exitCode: null,
  };
  register(record);

  proc.stdout.on("data", (data: Buffer) => {
    pushLine(id, data.toString());
  });
  proc.stderr.on("data", () => {});
  proc.on("close", (code) => {
    setStatus(id, code === 0 ? "done" : "error", code);
  });
  proc.on("error", (error) => {
    console.error(describeError(error));
    setStatus(id, "error", null);
    pushLine(id, JSON.stringify({ type: "provider_error", message: describeError(error) }));
  });

  return id;
}

const POLL_INTERVAL_MS = 500;
const LONG_POLL_MAX_MS = 25_000;

async function eventsPoll(id: string, after: number, wait: boolean): Promise<Response> {
  const session = get(id);
  if (!session) return jsonResponse({ error: "not found" }, 404);
  if (!wait) {
    return sessionSnapshot(id, after);
  }

  const deadline = Date.now() + LONG_POLL_MAX_MS;
  while (Date.now() < deadline) {
    if (session.lines.length > after || session.status !== "running") {
      return sessionSnapshot(id, after);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return sessionSnapshot(id, after);
}

function sessionSnapshot(id: string, after: number): Response {
  const session = get(id);
  if (!session) return jsonResponse({ error: "not found" }, 404);
  return jsonResponse({
    status: session.status,
    next: session.lines.length,
    lines: linesSince(id, after),
  });
}
