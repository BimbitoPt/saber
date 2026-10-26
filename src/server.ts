import "./lib/error-capture";
import { consumeLastCapturedError, describeError } from "./lib/error-capture";
import { handleApiV1 } from "./server/apiV1";
import { handleApi } from "./server/routes";
import { registerShutdownHooks } from "./server/shutdown";

export { shutdownResources } from "./server/shutdown";

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

registerShutdownHooks();
