import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

function workspaceRoot(path: string) {
  const canonical = existsSync(path) ? realpathSync(path) : resolve(path);
  let current = canonical;
  while (true) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return canonical;
    current = parent;
  }
}

export function workspacesOverlap(first: string, second: string) {
  const key = (path: string) => {
    const root = workspaceRoot(path);
    return process.platform === "win32" ? root.toLowerCase() : root;
  };
  const a = key(first);
  const b = key(second);
  return a === b || a.startsWith(b.endsWith(sep) ? b : b + sep) || b.startsWith(a.endsWith(sep) ? a : a + sep);
}
