import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createDevServerManager, DEV_PORT_MIN, resolveBunBinary, type DevServerDeps, type ManagedChild } from "./devServers";
import type { Project } from "./projects";

class FakeChild extends EventEmitter {
  pid: number;
  readonly kill = vi.fn(() => true);

  constructor(pid: number) {
    super();
    this.pid = pid;
  }
}

function asChild(child: FakeChild): ManagedChild {
  return child as unknown as ManagedChild;
}

const PROJECTS: Project[] = [
  { name: "alpha", path: "C:\\work\\alpha" },
  { name: "beta", path: "C:\\work\\beta" },
];

function harness(options: { waitUpMs?: number; stopTimeoutMs?: number } = {}) {
  const children: FakeChild[] = [];
  const alive = new Set<number>();
  const serving = new Set<number>();
  const killTree = vi.fn(async (pid: number) => {
    alive.delete(pid);
  });
  const spawnServer = vi.fn((project: Project, port: number) => {
    const child = new FakeChild(100 + children.length);
    children.push(child);
    alive.add(child.pid);
    // A real dev server starts serving the port once it is spawned.
    serving.add(port);
    return asChild(child);
  });
  const deps: Partial<DevServerDeps> = {
    spawnServer,
    probe: async (port) => serving.has(port),
    killTree,
    isAlive: (pid) => alive.has(pid),
    listProjects: () => PROJECTS,
    sleep: () => new Promise<void>((resolve) => setTimeout(resolve, 1)),
    waitUpMs: options.waitUpMs ?? 0,
    stopTimeoutMs: options.stopTimeoutMs ?? 50,
  };
  const manager = createDevServerManager(deps);
  return { manager, children, alive, serving, killTree, spawnServer };
}

describe("dev server lifecycle", () => {
  it("PROC-01 reports up once the port answers and down after an unexpected exit", async () => {
    const h = harness({ waitUpMs: 1_000 });
    const started = await h.manager.start("alpha");
    await h.manager.settle("alpha");

    expect(started).toEqual({ port: DEV_PORT_MIN });
    expect(h.manager.getEntry("alpha")?.state).toBe("running");
    expect(h.manager.list()).toEqual([{ project: "alpha", port: DEV_PORT_MIN, status: "up" }]);

    h.children[0].emit("exit", 0, null);

    expect(h.manager.getEntry("alpha")?.state).toBe("exited");
    expect(h.manager.list()).toEqual([{ project: "alpha", port: DEV_PORT_MIN, status: "down" }]);
  });

  it("PROC-01 turns a spawn error into failed, never a stale up", async () => {
    const h = harness({ waitUpMs: 1_000 });
    await h.manager.start("alpha");
    await h.manager.settle("alpha");

    h.children[0].emit("error", new Error("ENOENT"));

    expect(h.manager.getEntry("alpha")?.state).toBe("failed");
    expect(h.manager.list()[0].status).toBe("down");
  });

  it("PROC-01 keeps a live entry on its cached port without respawning", async () => {
    const h = harness({ waitUpMs: 1_000 });
    await h.manager.start("alpha");
    await h.manager.settle("alpha");

    expect(await h.manager.start("alpha")).toEqual({ port: DEV_PORT_MIN });
    expect(h.spawnServer).toHaveBeenCalledTimes(1);
  });

  it("PROC-02 stop is idempotent for an unknown or already-stopped project", async () => {
    const h = harness({ waitUpMs: 1_000 });
    await h.manager.start("alpha");
    await h.manager.settle("alpha");

    expect(await h.manager.stop("alpha")).toBe(true);
    expect(await h.manager.stop("alpha")).toBe(true);
    expect(await h.manager.stop("ghost")).toBe(true);

    expect(h.killTree).toHaveBeenCalledTimes(1);
    expect(h.killTree).toHaveBeenCalledWith(100);
    expect(h.manager.list()).toEqual([]);
    expect(h.manager.getEntry("alpha")).toBeUndefined();
  });

  it("PROC-02 keeps the entry and its port when the process survives the kill", async () => {
    const stuck = harness({ waitUpMs: 1_000, stopTimeoutMs: 10 });
    await stuck.manager.start("alpha");
    await stuck.manager.settle("alpha");
    stuck.killTree.mockImplementation(() => new Promise<void>(() => {}));

    expect(await stuck.manager.stop("alpha")).toBe(true);
    expect(stuck.manager.getEntry("alpha")?.state).toBe("failed");
    expect(stuck.manager.list()).toEqual([{ project: "alpha", port: DEV_PORT_MIN, status: "down" }]);

    // The survivor still owns 8090, so another project must not be handed it, and a
    // restart of the same name must wait rather than spawn a twin.
    expect((await stuck.manager.start("beta")).port).not.toBe(DEV_PORT_MIN);
    await expect(stuck.manager.start("alpha")).rejects.toThrow("still shutting down");

    // Once the process is really gone, reconcile drops the entry and frees the port.
    stuck.alive.delete(100);
    expect(stuck.manager.reconcile()).toContain("alpha");
    expect(stuck.manager.getEntry("alpha")).toBeUndefined();
  });

  it("PROC-02 clears the entry when the kill reports failure but the process is gone", async () => {
    const h = harness({ waitUpMs: 1_000, stopTimeoutMs: 50 });
    await h.manager.start("alpha");
    await h.manager.settle("alpha");
    h.killTree.mockImplementation(async (pid: number) => {
      h.alive.delete(pid);
      throw new Error("taskkill missing");
    });

    expect(await h.manager.stop("alpha")).toBe(true);
    expect(h.manager.list()).toEqual([]);
    expect(h.manager.getEntry("alpha")).toBeUndefined();
  });

  it("PROC-02 does not kill an entry whose process is already gone", async () => {
    const h = harness({ waitUpMs: 1_000 });
    await h.manager.start("alpha");
    await h.manager.settle("alpha");

    h.children[0].emit("exit", 0, null);

    expect(await h.manager.stop("alpha")).toBe(true);
    expect(h.killTree).not.toHaveBeenCalled();
    expect(h.manager.list()).toEqual([]);
  });

  it("PROC-03 reconcile drops a dead entry and a later start respawns on a fresh port", async () => {
    const h = harness({ waitUpMs: 1_000 });
    await h.manager.start("alpha");
    await h.manager.settle("alpha");

    // The child died without an exit event (killed externally / server restart) and
    // its orphaned server still answers on 8090.
    h.alive.delete(100);
    expect(h.manager.list()).toEqual([{ project: "alpha", port: DEV_PORT_MIN, status: "up" }]);

    expect(h.manager.reconcile()).toEqual(["alpha"]);
    expect(h.manager.list()).toEqual([]);

    const restarted = await h.manager.start("alpha");
    expect(h.spawnServer).toHaveBeenCalledTimes(2);
    expect(restarted).toEqual({ port: DEV_PORT_MIN + 1 });
  });

  it("PROC-03 start over a dead entry respawns without waiting for reconcile", async () => {
    const h = harness({ waitUpMs: 1_000 });
    await h.manager.start("alpha");
    h.children[0].emit("exit", 0, null);
    h.serving.delete(DEV_PORT_MIN);

    expect(await h.manager.start("alpha")).toEqual({ port: DEV_PORT_MIN });
    expect(h.spawnServer).toHaveBeenCalledTimes(2);
  });

  it("PROC-03 stopAll stops every entry and leaves none", async () => {
    const h = harness({ waitUpMs: 1_000 });
    await h.manager.start("alpha");
    await h.manager.start("beta");
    await h.manager.settle("alpha");
    await h.manager.settle("beta");

    expect(h.manager.list().map((item) => item.status)).toEqual(["up", "up"]);

    await h.manager.stopAll();

    expect(h.killTree).toHaveBeenCalledTimes(2);
    expect(h.manager.list()).toEqual([]);
  });

  it("keeps findDevServerForPath pointing at the project workdir", async () => {
    const h = harness({ waitUpMs: 1_000 });
    await h.manager.start("alpha");

    expect(h.manager.findForPath("C:\\work\\alpha\\src")).toMatchObject({ port: DEV_PORT_MIN });
    expect(h.manager.findForPath("C:\\work\\gamma")).toBeUndefined();
  });

  it("PROC-03 exposes a full port range and rejects an unknown project", async () => {
    const h = harness();

    await expect(h.manager.start("ghost")).rejects.toThrow("unknown project: ghost");

    for (let port = DEV_PORT_MIN; port <= DEV_PORT_MIN + 9; port++) h.serving.add(port);
    await expect(h.manager.start("alpha")).rejects.toThrow(`no free dev port in ${DEV_PORT_MIN}-${DEV_PORT_MIN + 9}`);
  });

  it("PROC-03 gives concurrent starts distinct ports and one process per name", async () => {
    const h = harness({ waitUpMs: 1_000 });

    const [alpha, beta] = await Promise.all([h.manager.start("alpha"), h.manager.start("beta")]);
    expect(alpha.port).not.toBe(beta.port);
    expect(h.spawnServer).toHaveBeenCalledTimes(2);
    await h.manager.settle("alpha");
    await h.manager.settle("beta");

    // A name that is already starting must not spawn a twin.
    const [first, second] = await Promise.all([h.manager.start("alpha"), h.manager.start("alpha")]);
    expect(first.port).toBe(alpha.port);
    expect(second.port).toBe(alpha.port);
    expect(h.spawnServer).toHaveBeenCalledTimes(2);
  });

  it("resolves the Bun binary instead of the bundled Node that runs the packaged server", () => {
    const which = () => null;
    expect(resolveBunBinary({ SABER_BUN_PATH: "C:\\tools\\bun.exe" }, "win32", which)).toBe("C:\\tools\\bun.exe");
    expect(resolveBunBinary({ USERPROFILE: "C:\\Users\\dev" }, "win32", which)).toContain("bun.exe");
    expect(resolveBunBinary({}, "linux", which)).toBe("bun");
    expect(resolveBunBinary({}, "win32", () => "C:\\resolved\\bun.exe")).toBe("C:\\resolved\\bun.exe");
  });
});
