import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalPath } from "./canonicalPath";

describe("canonicalPath", () => {
  it("is idempotent for existing and missing paths", () => {
    const root = mkdtempSync(join(tmpdir(), "saber-canonical-"));
    try {
      expect(canonicalPath(root)).toBe(canonicalPath(canonicalPath(root)));
      const missing = join(root, "not-created-yet", "leaf");
      expect(canonicalPath(missing)).toBe(canonicalPath(canonicalPath(missing)));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("agrees with the created path before and after symlinked or short-name ancestors appear", () => {
    const root = mkdtempSync(join(tmpdir(), "saber-canonical-"));
    try {
      const missing = join(root, "missing", "leaf");
      expect(canonicalPath(missing)).toBe(canonicalPath(join(canonicalPath(root), "missing", "leaf")));
      mkdirSync(join(root, "missing"));
      expect(canonicalPath(missing)).toBe(canonicalPath(join(canonicalPath(root), "missing", "leaf")));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
