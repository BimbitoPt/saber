import { randomBytes, timingSafeEqual } from "node:crypto";
import { closeSync, linkSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function tokenPath(dataDir?: string) {
  return join(dataDir ?? process.env.SABER_DATA_DIR ?? join(homedir(), ".saber"), "api-token");
}

export function getOrCreateApiToken(options: { dataDir?: string } = {}): string {
  const path = tokenPath(options.dataDir);
  const directory = options.dataDir ?? process.env.SABER_DATA_DIR ?? join(homedir(), ".saber");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    const existing = readFileSync(path, "utf8").trim();
    if (/^[A-Za-z0-9_-]{43}$/.test(existing)) return existing;
    throw new Error("Saber API token file is invalid; move it aside to generate a replacement.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const token = randomBytes(32).toString("base64url");
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  const descriptor = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(descriptor, token, "utf8");
  } finally {
    closeSync(descriptor);
  }
  try {
    linkSync(temporary, path);
    return token;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return readFileSync(path, "utf8").trim();
  } finally {
    try { unlinkSync(temporary); } catch {}
  }
}

export function hasValidBearerToken(header: string | null, expected: string): boolean {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header ?? "");
  if (!match) return false;
  const actualBytes = Buffer.from(match[1], "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}
