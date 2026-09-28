const errorResponse = {
  description: "Request failed",
  content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } } },
};
const get = (summary: string, schema: Record<string, unknown>, security = true) => ({
  get: { summary, security: security ? [{ bearerAuth: [] }] : [], responses: {
    "200": { description: "Successful read", content: { "application/json": { schema } } },
    "400": errorResponse, "401": errorResponse, "403": errorResponse, "404": errorResponse,
    "405": errorResponse, "409": errorResponse, "413": errorResponse, "500": errorResponse,
  } },
});
const data = (schema: Record<string, unknown>) => ({ type: "object", required: ["data"], properties: { data: schema } });
const collection = (item: Record<string, unknown>) => ({ type: "object", required: ["items", "nextCursor"], properties: {
  items: { type: "array", items: item }, nextCursor: { type: ["string", "null"] },
} });
const id = { type: "string", minLength: 1, maxLength: 128 };
const parameter = (name: string, schema: Record<string, unknown>, required = false) => ({ in: "query", name, required, schema });
const taskParameter = { in: "path", name: "taskId", required: true, schema: id };
const runParameter = { in: "path", name: "runId", required: true, schema: id };
const task = { $ref: "#/components/schemas/Task" };
const run = { $ref: "#/components/schemas/Run" };
const verification = { $ref: "#/components/schemas/Verification" };
const pageParameters = [parameter("cursor", { type: "string", pattern: "^(0|[1-9][0-9]{0,9})$", maxLength: 10 }), parameter("limit", { type: "integer", minimum: 1, maximum: 100, default: 50 })];

export const openApiDocument = {
  openapi: "3.1.0",
  info: { title: "Saber Local API", version: "1.0.0", description: "Local loopback read and review API. This contract does not expose workspace, run, or terminal mutations." },
  servers: [{ url: "http://127.0.0.1:{port}", variables: { port: { default: "8082" } } }],
  security: [{ bearerAuth: [] }],
  paths: {
    "/api/v1/health": get("Return minimal local API readiness", data({ type: "object", required: ["status", "apiVersion"], properties: { status: { const: "ok" }, apiVersion: { const: "1.0.0" } } }), false),
    "/api/v1/openapi.json": get("Read this OpenAPI document", { type: "object" }),
    "/api/v1/providers": get("Read provider installation readiness", data({ type: "array", items: { $ref: "#/components/schemas/Provider" } })),
    "/api/v1/tasks": { ...get("List tasks", data(collection(task))), parameters: pageParameters },
    "/api/v1/tasks/{taskId}": { ...get("Read a task", data(task)), parameters: [taskParameter] },
    "/api/v1/tasks/{taskId}/runs": { ...get("List runs for a task", data(collection(run))), parameters: [taskParameter, ...pageParameters] },
    "/api/v1/runs/{runId}": { ...get("Read run metadata", data(run)), parameters: [runParameter] },
    "/api/v1/runs/{runId}/events": { ...get("Read safe run event summaries from a sequence cursor", data({ type: "object", required: ["status", "nextCursor", "events", "hasMore"], properties: {
      status: { enum: ["running", "done", "stopped", "error", "interrupted"] }, nextCursor: { type: "integer", minimum: 0 },
      events: { type: "array", items: { type: "object", required: ["sequence", "type", "provider", "categories"], properties: {
        sequence: { type: "integer", minimum: 1 }, type: { enum: ["provider_event", "diagnostic"] }, provider: { type: ["string", "null"], enum: ["opencode", "codex", "claude", null] },
        categories: { type: "array", items: { enum: ["agent_message", "tool", "meta"] } },
      } } }, hasMore: { type: "boolean" },
    } })), parameters: [runParameter, parameter("after", { type: "integer", minimum: 0, maximum: 2147483647, default: 0 }), parameter("limit", { type: "integer", minimum: 1, maximum: 100, default: 50 })] },
    "/api/v1/tasks/{taskId}/verifications": { ...get("Read task verification evidence", data(collection(verification))), parameters: [taskParameter, ...pageParameters] },
    "/api/v1/tasks/{taskId}/workspace": { ...get("Read workspace review summary", data({ type: "object", required: ["head", "branch", "changedFileCount"], properties: { head: { type: "string" }, branch: { type: "string" }, changedFileCount: { type: "integer", minimum: 0 } } })), parameters: [taskParameter] },
  },
  components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } }, schemas: {
    Task: { type: "object", required: ["id", "projectName", "title", "spec", "criteria", "revision", "context", "draft", "createdAt", "updatedAt", "workspace"], properties: {
      id, projectName: { type: "string" }, title: { type: "string" }, spec: { type: "string" }, criteria: { type: "string" }, revision: { type: "integer", minimum: 1 }, context: { type: "string" }, draft: { type: "string" },
      createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" }, workspace: { oneOf: [{ type: "null" }, { type: "object", required: ["state", "branch"], properties: { state: { enum: ["provisioning", "ready", "removed"] }, branch: { type: "string" } } }] },
    } },
    Run: { type: "object", required: ["id", "taskId", "provider", "model", "specRevision", "status", "eventCount", "startedAt", "endedAt", "exitCode"], properties: {
      id, taskId: id, provider: { enum: ["opencode", "codex", "claude"] }, model: { type: ["string", "null"] }, specRevision: { type: "integer", minimum: 1 },
      status: { enum: ["running", "done", "stopped", "error", "interrupted"] }, eventCount: { type: "integer", minimum: 0 }, startedAt: { type: "string", format: "date-time" },
      endedAt: { type: ["string", "null"], format: "date-time" }, exitCode: { type: ["integer", "null"] },
    } },
    Verification: { type: "object", required: ["id", "taskId", "criterionId", "criterionText", "revision", "outcome", "check", "evidence", "runId", "checkedAt"], properties: {
      id, taskId: id, criterionId: { type: "string" }, criterionText: { type: "string" }, revision: { type: "integer" }, outcome: { enum: ["passed", "failed"] },
      check: { type: "string" }, evidence: { type: "string" }, runId: { type: ["string", "null"] }, checkedAt: { type: "string", format: "date-time" },
    } },
    Provider: { type: "object", required: ["id", "installed", "auth"], properties: { id: { enum: ["opencode", "codex", "claude"] }, installed: { type: "boolean" }, auth: { enum: ["ready", "signed-out", "unknown"] } } },
    ErrorEnvelope: { type: "object", required: ["error"], properties: { error: { type: "object", required: ["code", "message", "requestId"], properties: { code: { type: "string" }, message: { type: "string" }, requestId: { type: "string" } } } } },
  } },
} as const;
