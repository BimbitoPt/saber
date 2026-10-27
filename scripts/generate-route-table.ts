import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dedupeRoutes, extractRoutes, renderRouteTable, type RouteSource } from "../src/server/routes/routeScan";

const routeModules = ["tasks", "terminals", "sessions", "projects", "roles", "environment"];

const sources: RouteSource[] = routeModules.map((name) => ({
  file: `src/server/routes/${name}.ts`,
  text: readFileSync(join(import.meta.dir, "..", "src", "server", "routes", `${name}.ts`), "utf8"),
}));

const routes = dedupeRoutes(extractRoutes(sources));
if (routes.length === 0) {
  throw new Error("No routes found in src/server/routes; the scanner no longer matches the router source.");
}

writeFileSync(join(import.meta.dir, "..", "docs", "architecture", "route-table.gen.md"), renderRouteTable(routes));
console.log(`wrote route-table.gen.md with ${routes.length} routes`);
