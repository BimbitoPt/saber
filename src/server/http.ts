import { describeError } from "../lib/error-capture";

export function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export function errorResponse(error: unknown, status = 500, clientMessage?: string) {
  const message = clientMessage ?? (error instanceof Error ? error.message : String(error));
  console.error(describeError(error));
  return jsonResponse({ error: message }, status);
}

export function routeError(error: unknown) {
  const message = String(error);
  const status = /not found/i.test(message) ? 404
    : /only draft|active revision|already|belongs to another|cannot change|interrupted|interactive terminal|at most|must include|stale|local changes|branch changed/i.test(message) ? 409 : 400;
  return errorResponse(error, status);
}
