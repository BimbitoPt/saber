import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { LaunchContext, ProjectRecord, RepositoryGuidance, RepositoryState } from "../lib/tasks";
import type { TaskStore } from "./taskStore";

export type { LaunchContext, RepositoryGuidance, RepositoryState } from "../lib/tasks";

export type GitRunner = (cwd: string, args: string[]) => Promise<string>;

const GIT_TIMEOUT_MS = 5_000;

/** Runs git with fixed arguments (no shell) and returns trimmed stdout. */
export const runGit: GitRunner = (cwd, args) =>
  new Promise((resolve, reject) => {
    execFile("git", ["-C", cwd, ...args], { timeout: GIT_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
  });

async function tryGit(run: GitRunner, cwd: string, args: string[]): Promise<string | null> {
  try {
    return await run(cwd, args);
  } catch {
    // Missing git binary, not a repository, or a transient failure: all are the
    // same product answer — no repository was detected here.
    return null;
  }
}

/** Resolves the repository root from any directory inside it. */
export async function resolveGitRoot(cwd: string, run: GitRunner = runGit): Promise<string | null> {
  const root = await tryGit(run, cwd, ["rev-parse", "--show-toplevel"]);
  return root && root.trim() ? root : null;
}

/** Reads local branch and working-tree state. Nothing leaves the machine. */
export async function discoverRepositoryState(root: string, run: GitRunner = runGit): Promise<RepositoryState> {
  const branch = await tryGit(run, root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const dirty = await tryGit(run, root, ["status", "--porcelain"]);
  return {
    branch: branch && branch !== "HEAD" ? branch : undefined,
    detached: branch === "HEAD",
    dirty: !!dirty,
  };
}

const README_NAMES = ["README.md", "readme.md", "README.txt", "readme.txt", "README"];

/** Reads repository guidance files without executing anything or rewriting them. */
export function discoverGuidance(root: string): RepositoryGuidance {
  const guidance: RepositoryGuidance = { scripts: [] };
  const agents = join(root, "AGENTS.md");
  if (existsSync(agents)) guidance.agentsFile = agents;
  const readme = README_NAMES.map((name) => join(root, name)).find((path) => existsSync(path));
  if (readme) guidance.readme = readme;
  const packageJson = join(root, "package.json");
  if (existsSync(packageJson)) {
    try {
      const parsed = JSON.parse(readFileSync(packageJson, "utf8")) as { scripts?: Record<string, unknown> };
      if (parsed.scripts && typeof parsed.scripts === "object") {
        guidance.scripts = Object.entries(parsed.scripts).filter(([, command]) => typeof command === "string").map(([name]) => name).slice(0, 12);
      }
    } catch {
      // An unreadable package.json must not block the launch summary.
    }
  }
  const managers: Array<[string, string]> = [
    ["bun", "bun.lock"], ["bun", "bun.lockb"], ["pnpm", "pnpm-lock.yaml"],
    ["yarn", "yarn.lock"], ["npm", "package-lock.json"],
  ];
  guidance.packageManager = managers.find(([, file]) => existsSync(join(root, file)))?.[0];
  return guidance;
}

function lastProject(store: TaskStore): ProjectRecord | null {
  return [...store.listProjects()].sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
}

/**
 * Builds the repository-first launch summary for a working directory: detect
 * first, understand second, ask only when necessary. The detected project is
 * registered (canonical paths dedupe), guidance is read locally, and an
 * unresolvable directory yields an explicit fallback instead of a guess.
 */
export async function buildLaunchContext(cwd: string, store: TaskStore, run: GitRunner = runGit): Promise<LaunchContext> {
  const root = await resolveGitRoot(cwd, run);
  if (!root) {
    const last = lastProject(store);
    return {
      status: "outside-git",
      launchDirectory: cwd,
      fallback: {
        reason: "The launch directory is not inside a Git repository. Pick the last project or a folder instead.",
        lastProject: last,
      },
    };
  }
  const [state, guidance] = await Promise.all([
    discoverRepositoryState(root, run),
    Promise.resolve(discoverGuidance(root)),
  ]);
  const project = store.registerProject(root, basename(root));
  return { status: "repository", launchDirectory: cwd, project, repository: state, guidance };
}

/** The launcher hands the invoking shell's cwd to the desktop app via this variable. */
export const LAUNCH_CWD_ENV = "SABER_LAUNCH_CWD";

export function launchContextFromEnv(store: TaskStore, env: { SABER_LAUNCH_CWD?: string } = process.env, run: GitRunner = runGit): Promise<LaunchContext> {
  const cwd = env[LAUNCH_CWD_ENV]?.trim();
  if (!cwd) {
    return Promise.resolve({
      status: "unavailable",
      launchDirectory: "",
      fallback: { reason: "Saber was launched from the OS shell without a working directory. Pick a project or folder instead.", lastProject: lastProject(store) },
    });
  }
  return buildLaunchContext(cwd, store, run);
}
