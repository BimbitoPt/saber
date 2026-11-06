import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const nativeRealpath = (path: string): string => {
  try {
    return realpathSync.native(path);
  } catch {
    // realpathSync.native is unavailable or refused the path (older runtimes,
    // unusual permissions); the plain version still resolves symlinks.
    return realpathSync(path);
  }
};

/**
 * Produce one deterministic spelling for a filesystem path so that identity
 * comparisons hold across platforms:
 * - symlinks are resolved for the deepest existing ancestor, so a missing leaf
 *   still agrees with the same path after creation (macOS /var -> /private/var);
 * - Windows 8.3 short names are expanded (GitHub runners expose TEMP as
 *   C:\Users\RUNNER~1\... while Git reports the long form);
 * - win32 results use forward separators, lowercase, without \\?\ prefixes.
 */
export function canonicalPath(path: string): string {
  const abs = resolve(path);
  const tail: string[] = [];
  let cursor = abs;
  let base: string;
  for (;;) {
    try {
      base = nativeRealpath(cursor);
      break;
    } catch {
      const name = basename(cursor);
      const parent = dirname(cursor);
      if (parent === cursor) {
        base = cursor;
        break;
      }
      tail.unshift(name);
      cursor = parent;
    }
  }
  let result = tail.length ? join(base, ...tail) : base;
  if (process.platform === "win32") {
    result = result.replace(/^\\\\\?\\UNC\\/i, "\\\\").replace(/^\\\\\?\\/, "").replace(/\\/g, "/").toLowerCase();
  }
  return result;
}
