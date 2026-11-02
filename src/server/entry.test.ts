import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "server.ts"), "utf8");

describe("server entry", () => {
  it("stays a thin entry wired to the route dispatcher (MOD-09..11)", () => {
    expect(source.split("\n").length).toBeLessThan(120);
    expect(source).toContain('from "./server/routes"');
    expect(source).toContain('from "./server/shutdown"');
    expect(source).not.toMatch(/async function handleApi\b/);
    expect(source).not.toMatch(/export function shutdownResources\b/);
  });
});
