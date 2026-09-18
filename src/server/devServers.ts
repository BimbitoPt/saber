import { spawn } from "node:child_process";
import { reloadProjects, type Project } from "./projects";

export type DevServerStatus = "starting" | "up" | "down";

interface Entry {
  project: Project;
  port: number;
  status: DevServerStatus;
  proc: ReturnType<typeof spawn> | null;
  startedAt?: number;
}

const FIXED_PORT_MIN = 8090;
const FIXED_PORT_MAX = 8099;

const running = new Map<string, Entry>();

function probe(port: number): Promise<boolean> {
  return fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(1500) })
    .then(() => true)
    .catch(() => false);
}

function nextFreePort(): number {
  const used = new Set([...running.values()].map((e) => e.port));
  for (let p = FIXED_PORT_MIN; p <= FIXED_PORT_MAX; p++) {
    if (!used.has(p)) return p;
  }
  throw new Error("no free dev port in 8090-8099");
}

const WAIT_UP_MS = 60_000;

export async function startDevServer(name: string): Promise<{ port: number }> {
  const existing = running.get(name);
  if (existing && existing.proc) {
    return { port: existing.port };
  }

  const projects = reloadProjects();
  const project = projects.find((p) => p.name === name);
  if (!project) throw new Error(`unknown project: ${name}`);

  const port = project.port && !runningPortTaken(project.port) && project.port !== 8082
    ? project.port
    : nextFreePort();

  const proc = spawn(
    process.env["USERPROFILE"] + "\\AppData\\Roaming\\npm\\node_modules\\bun\\bin\\bun.exe",
    ["run", "dev", "--port", String(port), "--strictPort"],
    { cwd: project.path, shell: false, windowsHide: true, stdio: "ignore" },
  );

  const entry: Entry = { project, port, status: "starting", proc, startedAt: Date.now() };
  running.set(name, entry);

  (async () => {
    const deadline = Date.now() + WAIT_UP_MS;
    while (Date.now() < deadline) {
      if ((await probe(port)) && proc.pid) {
        entry.status = "up";
        return;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    entry.status = "down";
  })();

  return { port };
}

function runningPortTaken(port: number): boolean {
  return [...running.values()].some((e) => e.port === port);
}

export function listDevServers(): Array<{ project: string; port: number; status: DevServerStatus }> {
  return [...running.values()].map((e) => ({ project: e.project.name, port: e.port, status: e.status }));
}

export function stopDevServer(name: string): boolean {
  const entry = running.get(name);
  if (!entry?.proc) return false;
  spawn("taskkill", ["/pid", String(entry.proc.pid), "/T", "/F"], { shell: false, windowsHide: true });
  running.delete(name);
  return true;
}

export function findDevServerForPath(workdir: string): Entry | undefined {
  return [...running.values()].find((e) => workdir.startsWith(e.project.path));
}
