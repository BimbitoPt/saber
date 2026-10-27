import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dedupeRoutes, extractRoutes, type RouteSource } from "./routeScan";

const modules = ["tasks", "terminals", "sessions", "projects", "roles", "environment"];
const here = dirname(fileURLToPath(import.meta.url));

const sources: RouteSource[] = modules.map((name) => ({
  file: `src/server/routes/${name}.ts`,
  text: readFileSync(join(here, `${name}.ts`), "utf8"),
}));

const routes = dedupeRoutes(extractRoutes(sources));

const EXPECTED_LITERALS = [
  "GET /api/browser/screenshot",
  "GET /api/default-model",
  "GET /api/dev-servers",
  "GET /api/project-profiles",
  "GET /api/project-records",
  "GET /api/projects",
  "GET /api/providers",
  "GET /api/roles",
  "GET /api/sessions",
  "GET /api/tasks",
  "GET /api/terminals",
  "POST /api/browser/act",
  "POST /api/browser/goto",
  "POST /api/dev-servers/start",
  "POST /api/dev-servers/stop",
  "POST /api/project-profiles/drafts",
  "POST /api/project-profiles/refresh",
  "POST /api/project-records",
  "POST /api/roles",
  "POST /api/sessions",
  "POST /api/tasks",
  "POST /api/terminals/reconcile",
];

const EXPECTED_MATCHERS = [
  "/^\\/api\\/project-revisions\\/([^/]+)(\\/approve|\\/discard)?$/",
  "/^\\/api\\/roles\\/([^/]+)$/",
  "/^\\/api\\/sessions\\/([^/]+)\\/acknowledge$/",
  "/^\\/api\\/sessions\\/([^/]+)\\/events$/",
  "/^\\/api\\/sessions\\/([^/]+)\\/followup$/",
  "/^\\/api\\/sessions\\/([^/]+)\\/stop$/",
  "/^\\/api\\/tasks\\/([^/]+)$/",
  "/^\\/api\\/tasks\\/([^/]+)\\/runs$/",
  "/^\\/api\\/tasks\\/([^/]+)\\/runs\\/([^/]+)\\/(review|merge)$/",
  "/^\\/api\\/tasks\\/([^/]+)\\/runs\\/preview$/",
  "/^\\/api\\/tasks\\/([^/]+)\\/teams(\\/plan)?$/",
  "/^\\/api\\/tasks\\/([^/]+)\\/terminals$/",
  "/^\\/api\\/tasks\\/([^/]+)\\/verifications$/",
  "/^\\/api\\/tasks\\/([^/]+)\\/workspace(\\/merge)?$/",
  "/^\\/api\\/terminals\\/([^/]+)$/",
  "/^\\/api\\/terminals\\/([^/]+)\\/recover$/",
  "/^\\/api\\/terminals\\/([^/]+)\\/running$/",
];

describe("route set", () => {
  it("MOD-12 keeps every static path and method in a module", () => {
    const actual = routes
      .filter((route) => route.shape === "literal")
      .map((route) => `${route.method} ${route.pattern}`)
      .sort();
    expect(actual).toEqual(EXPECTED_LITERALS);
  });

  it("MOD-12 keeps every path matcher in a module", () => {
    const actual = routes
      .filter((route) => route.shape === "regex")
      .map((route) => route.pattern)
      .sort();
    expect(actual).toEqual(EXPECTED_MATCHERS);
  });

  it("MOD-12 does not double-register a route", () => {
    const keys = routes.map((route) => `${route.method} ${route.pattern}`);
    expect(keys.length).toBe(new Set(keys).size);
  });

  it("MOD-12 only scans route modules under /api/", () => {
    for (const route of routes) {
      expect(route.pattern.startsWith("/api/") || route.pattern.startsWith("/^\\/api\\/")).toBe(true);
    }
  });
});
