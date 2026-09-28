import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getOrCreateApiToken, hasValidBearerToken } from "./apiToken";

const directories: string[] = [];
function tempDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "saber-api-token-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("local API token", () => {
  it("creates a high-entropy token and reuses it after restart", () => {
    const dataDir = tempDirectory();
    const token = getOrCreateApiToken({ dataDir });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(getOrCreateApiToken({ dataDir })).toBe(token);
    expect(readFileSync(join(dataDir, "api-token"), "utf8")).toBe(token);
  });

  it("keeps one token when startup races to create the file", async () => {
    const dataDir = tempDirectory();
    const tokens = await Promise.all(Array.from({ length: 8 }, () => Promise.resolve().then(() => getOrCreateApiToken({ dataDir }))));
    expect(new Set(tokens).size).toBe(1);
  });

  it("accepts only the exact bearer credential", () => {
    const expected = "a".repeat(43);
    expect(hasValidBearerToken(null, expected)).toBe(false);
    expect(hasValidBearerToken(expected, expected)).toBe(false);
    expect(hasValidBearerToken("Bearer ", expected)).toBe(false);
    expect(hasValidBearerToken(`Bearer ${"b".repeat(43)}`, expected)).toBe(false);
    expect(hasValidBearerToken(`Bearer ${expected}`, expected)).toBe(true);
  });
});
