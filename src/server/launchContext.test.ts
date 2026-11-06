import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "./taskStore";
import { canonicalPath } from "./canonicalPath";
import { buildLaunchContext, discoverGuidance, discoverRepositoryState, launchContextFromEnv, LAUNCH_CWD_ENV, resolveGitRoot } from "./launchContext";

const stores: TaskStore[] = [];
const directories: string[] = [];
afterEach(() => {
  stores.splice(0).forEach((store) => store.close());
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const fakeGit = (responses: Record<string, string>) => async (cwd: string, args: string[]) => {
  const key = `${cwd} ${args.join(" ")}`;
  const hit = Object.entries(responses).find(([pattern]) => key.startsWith(pattern));
  if (!hit) throw new Error(`git ${args.join(" ")} failed`);
  return hit[1];
};

function setup() {
  const store = new TaskStore(":memory:");
  stores.push(store);
  return store;
}

describe("launch context", () => {
  it("resolves the repository root from a nested directory", async () => {
    const run = fakeGit({
      "C:/repo/deep rev-parse": "C:/repo",
    });
    expect(await resolveGitRoot("C:/repo/deep", run)).toBe("C:/repo");
    expect(await resolveGitRoot("C:/outside", async () => { throw new Error("not a git repository"); })).toBeNull();
  });

  it("reads branch, detached state, and dirty working tree locally", async () => {
    const run = fakeGit({
      "C:/repo rev-parse --abbrev-ref HEAD": "feature/repo-first",
      "C:/repo status --porcelain": " M src/app.ts\n",
    });
    const state = await discoverRepositoryState("C:/repo", run);
    expect(state).toEqual({ branch: "feature/repo-first", detached: false, dirty: true });
    const detached = await discoverRepositoryState("C:/repo", fakeGit({
      "C:/repo rev-parse --abbrev-ref HEAD": "HEAD",
      "C:/repo status --porcelain": "",
    }));
    expect(detached).toEqual({ branch: undefined, detached: true, dirty: false });
  });

  it("discovers guidance files without executing or rewriting anything", () => {
    const directory = mkdtempSync(join(tmpdir(), "saber-guidance-"));
    directories.push(directory);
    writeFileSync(join(directory, "AGENTS.md"), "Stack: Bun.");
    writeFileSync(join(directory, "README.md"), "# Repo");
    writeFileSync(join(directory, "package.json"), JSON.stringify({ name: "demo", scripts: { dev: "vite", test: "vitest", unreachable: 1 } }));
    writeFileSync(join(directory, "bun.lock"), "{}");
    const guidance = discoverGuidance(directory);
    expect(guidance.agentsFile).toBe(join(directory, "AGENTS.md"));
    expect(guidance.readme).toBe(join(directory, "README.md"));
    expect(guidance.packageManager).toBe("bun");
    expect(guidance.scripts).toEqual(["dev", "test"]);
    expect(discoverGuidance(join(directory, "empty-that-does-not-exist")).scripts).toEqual([]);
  });

  it("registers the detected repository once and returns an explicit fallback outside git", async () => {
    const store = setup();
    const fakeRoot = join(tmpdir(), "saber-fake-repo");
    const context = await buildLaunchContext(join(fakeRoot, "deep"), store, async (_cwd, args) => {
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return fakeRoot;
      if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return "main";
      if (args[0] === "status") return "";
      throw new Error("unexpected git call");
    });
    expect(context.status).toBe("repository");
    expect(context.project).toMatchObject({ root: canonicalPath(fakeRoot), displayName: "saber-fake-repo" });
    expect(context.repository).toEqual({ branch: "main", detached: false, dirty: false });

    const again = await buildLaunchContext(fakeRoot, store, async (_cwd, args) => {
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return fakeRoot;
      if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return "main";
      if (args[0] === "status") return "";
      throw new Error("unexpected git call");
    });
    expect(again.project?.root).toBe(canonicalPath(fakeRoot));
    expect(store.listProjects()).toHaveLength(1);

    const previous = store.registerProject(join(tmpdir(), "saber-previous"));
    const outside = await buildLaunchContext(join(tmpdir(), "saber-nowhere"), store, async () => { throw new Error("fatal: not a git repository"); });
    expect(outside.status).toBe("outside-git");
    expect(outside.fallback?.lastProject?.root).toBe(previous.root);
    expect(outside.project).toBeUndefined();
  });

  it("resolves the launcher cwd handoff from the environment", async () => {
    const store = setup();
    const root = mkdtempSync(join(tmpdir(), "saber-launch-repo-"));
    directories.push(root);
    const nested = join(root, "packages", "app");
    mkdirSync(nested, { recursive: true });
    execFileSync("git", ["-C", root, "init", "-q"]);
    execFileSync("git", ["-C", root, "config", "user.email", "saber@example.com"]);
    execFileSync("git", ["-C", root, "config", "user.name", "Saber"]);
    writeFileSync(join(root, "README.md"), "# Launch test\n");
    execFileSync("git", ["-C", root, "add", "."]);
    execFileSync("git", ["-C", root, "commit", "-q", "-m", "init"]);

    const context = await launchContextFromEnv(store, { [LAUNCH_CWD_ENV]: nested });
    expect(context.status).toBe("repository");
    expect(context.launchDirectory).toBe(nested);
    expect(context.project?.root).toBe(canonicalPath(root));
    expect(context.repository).toMatchObject({ branch: expect.any(String), dirty: false });
    expect(canonicalPath(context.guidance?.readme ?? "")).toBe(canonicalPath(join(root, "README.md")));

    const unavailable = await launchContextFromEnv(store, {});
    expect(unavailable.status).toBe("unavailable");
    expect(unavailable.fallback?.reason).toContain("without a working directory");
  });
});
