import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { reloadProjects, type Project } from "./projects";

export type DevServerState = "starting" | "running" | "stopping" | "exited" | "failed";

/**
 * Wire status. `src/lib/api.ts` types this as `starting | up | down`, so the richer
 * internal lifecycle states never leave this module.
 */
export type DevServerStatus = "starting" | "up" | "down";

export interface DevServerEntry {
  project: Project;
  port: number;
  state: DevServerState;
  startedAt: number;
}

export interface DevServerListItem {
  project: string;
  port: number;
  status: DevServerStatus;
}

/** The child handle is authoritative for liveness; the entry is only a projection of it. */
export type ManagedChild = Pick<ChildProcess, "pid" | "once" | "kill">;

export interface DevServerDeps {
  /** Spawns a project dev server. Injected so tests never spawn real processes. */
  spawnServer(project: Project, port: number): ManagedChild;
  /** True when something already serves the port: avoids handing out an occupied port and detects start-up. */
  probe(port: number): Promise<boolean>;
  /** Terminates the process tree. Resolving late is fine; the manager bounds the wait. */
  killTree(pid: number): Promise<void>;
  isAlive(pid: number): boolean;
  listProjects(): Project[];
  sleep(ms: number): Promise<void>;
  now(): number;
  portRange: { min: number; max: number };
  probeIntervalMs: number;
  waitUpMs: number;
  stopTimeoutMs: number;
}

export const DEV_PORT_MIN = 8090;
export const DEV_PORT_MAX = 8099;

const APP_PORT = 8082;
const PROBE_TIMEOUT_MS = 1_500;
const KILL_GRACE_MS = 2_000;

interface Entry extends DevServerEntry {
  proc: ManagedChild | null;
}

function wireStatus(state: DevServerState): DevServerStatus {
  if (state === "starting") return "starting";
  if (state === "running") return "up";
  return "down";
}

function defaultProbe(port: number): Promise<boolean> {
  return fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    .then(() => true)
    .catch(() => false);
}

/**
 * The project dev server always runs `bun run dev`, so the Bun binary must be
 * resolved explicitly: in dev Saber's server runs under Bun itself, but the
 * packaged app runs a bundled Node, where `process.execPath` is not Bun.
 */
export function resolveBunBinary(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
  whichBun: (name: string) => string | null | undefined = (name) =>
    (globalThis as { Bun?: { which?: (candidate: string) => string | null } }).Bun?.which?.(name),
): string {
  if (env.SABER_BUN_PATH) return env.SABER_BUN_PATH;
  const resolved = whichBun("bun");
  if (resolved) return resolved;
  if (platform === "win32" && env.USERPROFILE) {
    return join(env.USERPROFILE, "AppData", "Roaming", "npm", "node_modules", "bun", "bin", "bun.exe");
  }
  return "bun";
}

function defaultSpawn(project: Project, port: number): ManagedChild {
  return spawn(resolveBunBinary(), ["run", "dev", "--port", String(port), "--strictPort"], {
    cwd: project.path,
    shell: false,
    windowsHide: true,
    stdio: "ignore",
  });
}

function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function defaultKillTree(pid: number): Promise<void> {
  if (process.platform === "win32") {
    return new Promise<void>((resolve) => {
      const killer = spawn(
        "taskkill",
        ["/pid", String(pid), "/T", "/F"],
        { shell: false, windowsHide: true, stdio: "ignore" },
      );
      // A missing taskkill must not take the server down, so both outcomes resolve.
      killer.once("error", () => resolve());
      killer.once("exit", () => resolve());
    });
  }
  // Children are not spawned detached yet (spec exclusion), so group kill is best-effort.
  const signal = (name: NodeJS.Signals) => {
    try {
      process.kill(-pid, name);
      return;
    } catch {
      /* not a process-group leader */
    }
    try {
      process.kill(pid, name);
    } catch {
      /* already gone */
    }
  };
  signal("SIGTERM");
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      signal("SIGKILL");
      resolve();
    }, KILL_GRACE_MS);
  });
}

export function createDevServerManager(overrides: Partial<DevServerDeps> = {}): DevServerManager {
  const deps: DevServerDeps = {
    spawnServer: defaultSpawn,
    probe: defaultProbe,
    killTree: defaultKillTree,
    isAlive: defaultIsAlive,
    listProjects: reloadProjects,
    sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    portRange: { min: DEV_PORT_MIN, max: DEV_PORT_MAX },
    probeIntervalMs: 2_000,
    waitUpMs: 60_000,
    stopTimeoutMs: 5_000,
    ...overrides,
  };
  return new DevServerManager(deps);
}

export class DevServerManager {
  private readonly deps: DevServerDeps;
  private readonly entries = new Map<string, Entry>();
  private readonly stopping = new Map<string, Promise<void>>();
  private readonly monitors = new Map<string, Promise<void>>();

  constructor(deps: DevServerDeps) {
    this.deps = deps;
  }

  async start(name: string): Promise<{ port: number }> {
    const existing = this.entries.get(name);
    if (existing && this.isLive(existing)) return { port: existing.port };

    const project = this.deps.listProjects().find((p) => p.name === name);
    if (!project) throw new Error(`unknown project: ${name}`);

    const port = await this.allocatePort(project);

    let proc: ManagedChild;
    try {
      proc = this.deps.spawnServer(project, port);
    } catch (error) {
      // Keep a failed projection so the pane reports `down` instead of hiding the attempt.
      this.entries.set(name, { project, port, state: "failed", startedAt: this.deps.now(), proc: null });
      throw error;
    }

    const entry: Entry = { project, port, state: "starting", startedAt: this.deps.now(), proc };
    this.entries.set(name, entry);
    this.watch(name, entry);
    return { port };
  }

  /**
   * Forces a live stop and always clears the entry: unknown names and already-stopped
   * entries are success, and a kill that times out or throws still drops the entry.
   */
  async stop(name: string): Promise<boolean> {
    const inFlight = this.stopping.get(name);
    if (inFlight) {
      await inFlight;
      return true;
    }
    const entry = this.entries.get(name);
    if (!entry) return true;

    const task = this.terminate(name, entry);
    this.stopping.set(name, task);
    try {
      await task;
    } finally {
      if (this.stopping.get(name) === task) this.stopping.delete(name);
    }
    return true;
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((name) => this.stop(name)));
  }

  /** Drops entries whose process is gone so a later start respawns instead of reusing a stale port. */
  reconcile(): string[] {
    const dropped: string[] = [];
    for (const [name, entry] of [...this.entries]) {
      const pid = entry.proc?.pid;
      const dead = entry.state === "exited" || entry.state === "failed" || !pid || !this.deps.isAlive(pid);
      if (!dead) continue;
      this.entries.delete(name);
      dropped.push(name);
    }
    return dropped;
  }

  list(): DevServerListItem[] {
    return [...this.entries.values()].map((e) => ({
      project: e.project.name,
      port: e.port,
      status: wireStatus(e.state),
    }));
  }

  getEntry(name: string): DevServerEntry | undefined {
    return this.entries.get(name);
  }

  findForPath(workdir: string): DevServerEntry | undefined {
    return [...this.entries.values()].find((e) => workdir.startsWith(e.project.path));
  }

  /** Resolves once the start-up probe loop for a project has settled. */
  async settle(name: string): Promise<void> {
    await this.monitors.get(name);
  }

  private isLive(entry: Entry): boolean {
    if (entry.state !== "starting" && entry.state !== "running") return false;
    const pid = entry.proc?.pid;
    return typeof pid === "number" && this.deps.isAlive(pid);
  }

  private watch(name: string, entry: Entry): void {
    const proc = entry.proc;
    if (!proc) return;
    proc.once("error", (error: Error) => {
      console.error(`dev server ${name} failed: ${error.message}`);
      this.settleDeath(entry, "failed");
    });
    proc.once("exit", () => this.settleDeath(entry, "exited"));

    const monitor = this.monitorUp(name, entry);
    this.monitors.set(name, monitor);
    void monitor.then(() => {
      if (this.monitors.get(name) === monitor) this.monitors.delete(name);
    });
  }

  /** Unexpected exits must land on a terminal state so the reported status can never stay `up`. */
  private settleDeath(entry: Entry, state: "exited" | "failed"): void {
    // First death wins: an `error` followed by `exit` must keep the `failed` reason.
    if (entry.state === "exited" || entry.state === "failed") return;
    entry.state = state;
    entry.proc = null;
  }

  private async monitorUp(name: string, entry: Entry): Promise<void> {
    const deadline = this.deps.now() + this.deps.waitUpMs;
    while (this.deps.now() < deadline) {
      if (this.entries.get(name) !== entry || entry.state !== "starting") return;
      if (await this.deps.probe(entry.port)) {
        if (this.entries.get(name) === entry && entry.state === "starting") entry.state = "running";
        return;
      }
      await this.deps.sleep(this.deps.probeIntervalMs);
    }
    if (this.entries.get(name) === entry && entry.state === "starting") entry.state = "failed";
  }

  private async terminate(name: string, entry: Entry): Promise<void> {
    const pid = entry.proc?.pid;
    if (entry.state === "exited" || entry.state === "failed" || !pid) {
      entry.proc = null;
      this.forget(name, entry);
      return;
    }
    entry.state = "stopping";
    await this.bounded(async () => {
      try {
        await this.deps.killTree(pid);
      } catch (error) {
        console.error(`dev server ${name} kill failed: ${String(error)}`);
      }
    }, this.deps.stopTimeoutMs);
    entry.state = "exited";
    entry.proc = null;
    this.forget(name, entry);
  }

  private async bounded(task: () => Promise<void>, timeoutMs: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    try {
      await Promise.race([task(), deadline]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private forget(name: string, entry: Entry): void {
    // Only drop the entry this stop owns, never a newer one started over the same name.
    if (this.entries.get(name) === entry) this.entries.delete(name);
  }

  private async allocatePort(project: Project): Promise<number> {
    const declared = project.port;
    if (declared && declared !== APP_PORT && !this.portTaken(declared) && !(await this.deps.probe(declared))) {
      return declared;
    }
    const { min, max } = this.deps.portRange;
    for (let port = min; port <= max; port++) {
      if (this.portTaken(port)) continue;
      if (await this.deps.probe(port)) continue;
      return port;
    }
    throw new Error(`no free dev port in ${min}-${max}`);
  }

  /** Only live entries reserve a port; a dead projection must not hold one. */
  private portTaken(port: number): boolean {
    return [...this.entries.values()].some((entry) => entry.port === port && this.isLive(entry));
  }
}

const defaultManager = createDevServerManager();

export function startDevServer(name: string): Promise<{ port: number }> {
  return defaultManager.start(name);
}

export function stopDevServer(name: string): Promise<boolean> {
  return defaultManager.stop(name);
}

export function listDevServers(): DevServerListItem[] {
  return defaultManager.list();
}

export function reconcileDevServers(): string[] {
  return defaultManager.reconcile();
}

export function stopAllDevServers(): Promise<void> {
  return defaultManager.stopAll();
}

export function findDevServerForPath(workdir: string): DevServerEntry | undefined {
  return defaultManager.findForPath(workdir);
}
