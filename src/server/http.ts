function safeJsonStringify(data: unknown): string | undefined {
  return JSON.stringify(data, (key, value: unknown) => {
    // Stack traces are server diagnostics and must never cross the HTTP boundary.
    if (key === "stack") return undefined;
    if (value instanceof Error) return { error: "The request could not be completed." };
    return value;
  });
}

export function jsonResponse(data: unknown, status = 200) {
  return new Response(safeJsonStringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export function errorResponse(error: unknown, status = 500, clientMessage?: string) {
  // Keep the original error (including its stack) in server-side diagnostics only.
  console.error(error);
  return jsonResponse({ error: clientMessage ?? "The request could not be completed." }, status);
}

export function routeError(error: unknown) {
  const message = String(error);
  const status = /not found/i.test(message) ? 404
    : /only draft|active revision|already|belongs to another|cannot change|interrupted|interactive terminal|at most|must include|stale|local changes|branch changed/i.test(message) ? 409 : 400;
  const clientMessage = status === 404 ? "Resource not found."
    : status === 409 ? "The request conflicts with the current state."
      : "The request could not be completed.";
  return errorResponse(error, status, clientMessage);
}
