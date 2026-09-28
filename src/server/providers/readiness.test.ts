import { afterEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findExecutable, providerStatus } from "./executables";

vi.mock("node:child_process", async (original) => ({ ...await original<typeof import("node:child_process")>(), execFile: vi.fn() }));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

function probe(stdout: string, stderr = "", error: Error | null = null) {
  vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
    const callback = args[3] as (error: Error | null, stdout: string, stderr: string) => void;
    callback(error, stdout, stderr);
    return {} as ReturnType<typeof execFile>;
  });
}

describe("provider readiness", () => {
  it("reports Codex login without returning auth output", async () => {
    vi.stubEnv("CODEX_API_KEY", "");
    probe("", "Logged in using ChatGPT");
    expect(await providerStatus("codex", () => "/codex")).toEqual({ id: "codex", installed: true, auth: "ready", message: "Signed in and ready." });
    expect(execFile).toHaveBeenCalledWith("/codex", ["login", "status"], expect.objectContaining({ timeout: 8000, maxBuffer: 65536, windowsHide: true }), expect.any(Function));
  });
  it("reports Claude signed-out status without exposing account data", async () => {
    probe('{"loggedIn":false,"email":"private@example.test"}', "", new Error("signed out"));
    const result = await providerStatus("claude", () => "/claude");
    expect(result.auth).toBe("signed-out");
    expect(result.message).toContain("claude auth login");
    expect(JSON.stringify(result)).not.toContain("private@example.test");
  });
  it("treats timeouts as unknown instead of declaring a logout", async () => {
    probe('{"loggedIn":false}', "", Object.assign(new Error("timeout"), { killed: true }));
    expect((await providerStatus("claude", () => "/claude")).auth).toBe("unknown");
  });
  it("recognizes a native executable on PATH", () => {
    const directory = mkdtempSync(join(tmpdir(), "saber-discovery-"));
    try {
      const executable = join(directory, process.platform === "win32" ? "codex.exe" : "codex");
      writeFileSync(executable, "");
      vi.stubEnv("PATH", directory);
      expect(findExecutable("codex")).toBe(executable);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
