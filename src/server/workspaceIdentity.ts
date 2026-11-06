import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { canonicalPath } from "./canonicalPath";

function workspaceRoot(path: string) {
  const canonical = canonicalPath(path);
  let current = canonical;
  while (true) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return canonical;
    current = parent;
  }
}

export function canonicalizeProjectRoot(path: string) {
  return canonicalPath(path);
}

export function workspacesOverlap(first: string, second: string) {
  const key = (path: string) => workspaceRoot(path).replace(/\\/g, "/").replace(/\/+$/, "");
  const a = key(first);
  const b = key(second);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}
