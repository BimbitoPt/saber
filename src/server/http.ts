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

const CLIENT_UNSAFE_MESSAGE = /[\r\n]|\bnode:|\bfile:|https?:\/\/|\bat \S|\/(?:home|Users|tmp|var|usr|opt|srv|root|etc)\/|[A-Za-z]:\\|\.(?:ts|js|mjs|cjs|json|rs)\b/;

function clientSafeMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const message = error.message.trim();
  if (!message || message.length > 300 || CLIENT_UNSAFE_MESSAGE.test(message)) return fallback;
  return message;
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
  const fallback = status === 404 ? "Resource not found."
    : status === 409 ? "The request conflicts with the current state."
      : "The request could not be completed.";
  // Validation failures are client input, so their reason can reach the UI; anything
  // that smells like internals (paths, stacks, source files) keeps the fallback.
  return errorResponse(error, status, clientSafeMessage(error, fallback));
}
