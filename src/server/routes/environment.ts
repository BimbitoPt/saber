import { jsonResponse, errorResponse } from "../http";
import { describeError } from "../../lib/error-capture";
import { startDevServer, listDevServers, stopDevServer } from "../devServers";
import { goto as browserGoto, screenshot as browserShot, act as browserAct, currentUrl } from "../browser";
import type { RouteHandler } from "./types";

export const handle: RouteHandler = async (ctx) => {
  const { request, path } = ctx;

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
      return errorResponse(error, 500);
    }
  }

  if (path === "/api/dev-servers/stop" && request.method === "POST") {
    let project: unknown;
    try {
      project = (JSON.parse(await request.text()) as { project?: unknown }).project;
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400);
    }
    if (typeof project !== "string") return jsonResponse({ error: "project is required" }, 400);
    try {
      // Stop is idempotent: unknown or already-stopped projects are success, not 404.
      await stopDevServer(project);
      return jsonResponse({ ok: true });
    } catch (error) {
      return errorResponse(error, 500);
    }
  }

  if (path === "/api/browser/goto" && request.method === "POST") {
    try {
      const body = JSON.parse(await request.text()) as { url?: unknown };
      if (typeof body.url !== "string") return jsonResponse({ error: "url is required" }, 400);
      await browserGoto(body.url);
      return jsonResponse({ ok: true, url: await currentUrl() });
    } catch (error) {
      return errorResponse(error, 500);
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
      return errorResponse(error, 500);
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

  return null;
};
