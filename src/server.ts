import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";

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

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      const contentType = response.headers.get("content-type") ?? "";
      if (response.status >= 500 && contentType.includes("application/json")) {
        const body = await response.clone().text();
        if (body.includes("\"unhandled\":true")) {
          console.error(consumeLastCapturedError() ?? `h3 swallowed SSR error: ${body}`);
        }
      }
      return response;
    } catch (error) {
      console.error(error);
      return new Response("MSTUDIO ADE server error", { status: 500 });
    }
  },
};
