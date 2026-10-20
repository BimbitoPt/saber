import { describe, expect, it, vi } from "vitest";
import { canRecoverTerminal, closeTerminalSession, recoverInterruptedTerminal } from "./terminalLifecycle";
import type { TerminalSessionRecord } from "./tasks";

function session(overrides: Partial<TerminalSessionRecord> = {}): TerminalSessionRecord {
  return { id: "terminal-1", taskId: "task-1", workdir: "C:\\work", status: "running", createdAt: 1, ...overrides };
}

describe("terminal close on confirmed exit", () => {
  it("releases the lock when the native close succeeds", async () => {
    const close = vi.fn(async () => {});
    const listLive = vi.fn(async () => ["terminal-1"]);
    const reconcile = vi.fn(async () => [session()]);
    const release = vi.fn(async () => {});

    const result = await closeTerminalSession({ id: "terminal-1", close, listLive, reconcile, release });

    expect(result).toEqual({ status: "released" });
    expect(close).toHaveBeenCalledWith("terminal-1");
    expect(release).toHaveBeenCalledWith("terminal-1");
    expect(listLive).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("reconciles against the live shells instead of releasing when the native close fails", async () => {
    const close = vi.fn(async () => {
      throw new Error("terminal_close rejected");
    });
    const listLive = vi.fn(async () => ["terminal-1", "terminal-2"]);
    const reconciled = session({ status: "running" });
    const reconcile = vi.fn(async () => [reconciled]);
    const release = vi.fn(async () => {});

    const result = await closeTerminalSession({ id: "terminal-1", close, listLive, reconcile, release });

    expect(reconcile).toHaveBeenCalledWith(["terminal-1", "terminal-2"]);
    expect(release).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "still-running", session: reconciled });
  });

  it("marks the record interrupted when the shell is confirmed gone", async () => {
    const close = vi.fn(async () => {
      throw new Error("terminal_close rejected");
    });
    const listLive = vi.fn(async () => []);
    const reconciled = session({ status: "interrupted" });
    const reconcile = vi.fn(async () => [reconciled]);
    const release = vi.fn(async () => {});

    const result = await closeTerminalSession({ id: "terminal-1", close, listLive, reconcile, release });

    expect(reconcile).toHaveBeenCalledWith([]);
    expect(release).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "interrupted", session: reconciled });
  });

  it("reports an unresolved stop when the live shell list cannot be read", async () => {
    const close = vi.fn(async () => {
      throw new Error("terminal_close rejected");
    });
    const listLive = vi.fn(async () => {
      throw new Error("terminal_list unavailable");
    });
    const reconcile = vi.fn(async () => []);
    const release = vi.fn(async () => {});

    const result = await closeTerminalSession({ id: "terminal-1", close, listLive, reconcile, release });

    expect(reconcile).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(result.status).toBe("unresolved");
    expect(result.status === "unresolved" && result.message).toContain("terminal_list unavailable");
    expect(result.status === "unresolved" && result.message).toContain("terminal_close rejected");
  });

  it("reports an unresolved stop when reconciliation fails", async () => {
    const close = vi.fn(async () => {
      throw new Error("terminal_close rejected");
    });
    const listLive = vi.fn(async () => ["terminal-1"]);
    const reconcile = vi.fn(async () => {
      throw new Error("reconcile rejected");
    });
    const release = vi.fn(async () => {});

    const result = await closeTerminalSession({ id: "terminal-1", close, listLive, reconcile, release });

    expect(release).not.toHaveBeenCalled();
    expect(result.status).toBe("unresolved");
    expect(result.status === "unresolved" && result.message).toContain("reconcile rejected");
  });

  it("reports an unresolved stop when the lock release fails after a successful close", async () => {
    const close = vi.fn(async () => {});
    const listLive = vi.fn(async () => []);
    const reconcile = vi.fn(async () => []);
    const release = vi.fn(async () => {
      throw new Error("revert rejected");
    });

    const result = await closeTerminalSession({ id: "terminal-1", close, listLive, reconcile, release });

    expect(result.status).toBe("unresolved");
    expect(result.status === "unresolved" && result.message).toContain("revert rejected");
  });

  it("does not release a lock that no record holds", async () => {
    const close = vi.fn(async () => {
      throw new Error("terminal_close rejected");
    });
    const listLive = vi.fn(async () => []);
    const reconcile = vi.fn(async () => [session({ id: "terminal-2" })]);
    const release = vi.fn(async () => {});

    const result = await closeTerminalSession({ id: "terminal-1", close, listLive, reconcile, release });

    expect(release).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "released" });
  });
});

describe("terminal recovery guard", () => {
  it("refuses a shell that is still in the live pty list", async () => {
    const permission = await canRecoverTerminal({ id: "terminal-1", listLive: async () => ["terminal-1"] });
    expect(permission).toEqual({
      allowed: false,
      message: "This shell is still running. Stop it before recovering the terminal session.",
    });
  });

  it("allows recovery once the shell is gone", async () => {
    const permission = await canRecoverTerminal({ id: "terminal-1", listLive: async () => [] });
    expect(permission).toEqual({ allowed: true });
  });

  it("refuses recovery when the live list cannot be read", async () => {
    const permission = await canRecoverTerminal({
      id: "terminal-1",
      listLive: async () => {
        throw new Error("terminal_list unavailable");
      },
    });
    expect(permission.allowed).toBe(false);
    expect(permission.allowed === false && permission.message).toContain("cannot confirm");
  });

  it("never recovers while the pty is alive", async () => {
    const recover = vi.fn(async () => session({ status: "stopped" }));
    const result = await recoverInterruptedTerminal({
      id: "terminal-1",
      listLive: async () => ["terminal-1"],
      recover,
    });

    expect(recover).not.toHaveBeenCalled();
    expect(result.status).toBe("refused");
    expect(result.status === "refused" && result.message).toContain("still running");
  });

  it("never recovers when the live list cannot be read", async () => {
    const recover = vi.fn(async () => session({ status: "stopped" }));
    const result = await recoverInterruptedTerminal({
      id: "terminal-1",
      listLive: async () => {
        throw new Error("terminal_list unavailable");
      },
      recover,
    });

    expect(recover).not.toHaveBeenCalled();
    expect(result.status).toBe("refused");
  });

  it("recovers an interrupted session once the pty is gone", async () => {
    const stopped = session({ status: "stopped", endedAt: 2 });
    const recover = vi.fn(async () => stopped);
    const result = await recoverInterruptedTerminal({ id: "terminal-1", listLive: async () => [], recover });

    expect(recover).toHaveBeenCalledWith("terminal-1");
    expect(result).toEqual({ status: "recovered", session: stopped });
  });

  it("reports a refused recovery when the server rejects it", async () => {
    const recover = vi.fn(async () => {
      throw new Error("Only an interrupted terminal session can be recovered");
    });
    const result = await recoverInterruptedTerminal({ id: "terminal-1", listLive: async () => [], recover });

    expect(result.status).toBe("refused");
    expect(result.status === "refused" && result.message).toContain("could not recover");
  });
});
