import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { acquireTerminalLock, markTerminalSessionRunning, recoverTerminalSession, releaseTerminalLock } from "../lib/api";
import { isTerminalRuntimeAvailable } from "../lib/terminalRuntime";
import type { TerminalRuntime } from "../lib/terminalRuntime";
import type { TaskSummary, TerminalSessionRecord } from "../lib/tasks";
import "@xterm/xterm/css/xterm.css";

type Props = {
  task: TaskSummary;
  session?: TerminalSessionRecord;
  active: boolean;
  startOnOpen: boolean;
  onSessionChange: (session: TerminalSessionRecord) => void;
};

export function TerminalSurface({ task, session, active, startOnOpen, onSessionChange }: Props) {
  const element = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<import("@xterm/xterm").Terminal | undefined>(undefined);
  const fitRef = useRef<import("@xterm/addon-fit").FitAddon | undefined>(undefined);
  const activeRef = useRef(active);
  const sessionRef = useRef(session);
  const onSessionChangeRef = useRef(onSessionChange);
  const startSessionRef = useRef<(() => Promise<void>) | undefined>(undefined);
  const [state, setState] = useState<"starting" | "running" | "exited" | "error" | "unsupported" | "interrupted" | "idle">("starting");
  const [error, setError] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [recovering, setRecovering] = useState(false);
  const workspaceBlocked = Boolean(task.workspace && task.workspace.state !== "ready");
  activeRef.current = active;
  sessionRef.current = session;
  onSessionChangeRef.current = onSessionChange;

  useEffect(() => {
    if (active && state === "running") {
      fitRef.current?.fit();
      terminalRef.current?.focus();
    }
  }, [active, state]);

  useEffect(() => {
    if (!isTerminalRuntimeAvailable(window as Window & TerminalRuntime)) {
      setState("unsupported");
      return;
    }
    if (workspaceBlocked) {
      setError(task.workspace?.state === "removed" ? "This task workspace was removed. Create a new task to continue." : "This task workspace is not ready yet.");
      setState("error");
      return;
    }

    let disposed = false;
    let started = false;
    let sessionId: string | undefined;
    let stopping: Promise<void> | undefined;
    let unlistenOutput: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;
    let resizeObserver: ResizeObserver | undefined;

    const stop = () => {
      if (stopping) return stopping;
      const id = sessionId;
      if (!id) return Promise.resolve();
      sessionId = undefined;
      started = false;
      stopping = (async () => {
        try {
          await invoke("terminal_close", { sessionId: id });
          await releaseTerminalLock(id);
          const stopped = { ...(sessionRef.current ?? { id, taskId: task.id, workdir: task.workspace?.path ?? task.project, createdAt: Date.now() }), status: "stopped" as const, endedAt: Date.now() };
          onSessionChangeRef.current(stopped);
        } catch {}
      })();
      return stopping;
    };

    const attach = async (id: string, startProcess: boolean, workdir: string, createdAt: number) => {
      const terminal = terminalRef.current;
      if (!terminal) throw new Error("Terminal renderer is unavailable");
      sessionId = id;
      started = true;
      const stopListeningOutput = await listen<string>(`terminal-output:${id}`, (event) => terminal.write(event.payload));
      if (disposed) { stopListeningOutput(); await stop(); return; }
      unlistenOutput = stopListeningOutput;
      const stopListeningExit = await listen(`terminal-exited:${id}`, () => {
        if (!disposed) {
          terminal.options.disableStdin = true;
          setState("exited");
          void stop();
        }
      });
      if (disposed) { stopListeningExit(); await stop(); return; }
      unlistenExit = stopListeningExit;
      if (startProcess) {
        await invoke("terminal_start", { sessionId: id, cwd: workdir, cols: terminal.cols, rows: terminal.rows });
        const record = await markTerminalSessionRunning(id);
        sessionRef.current = record;
        onSessionChangeRef.current(record);
      }
      if (disposed) { await stop(); return; }
      terminal.options.disableStdin = false;
      if (activeRef.current) terminal.focus();
      setState("running");
      fitRef.current?.fit();
      await invoke("terminal_resize", { sessionId: id, cols: terminal.cols, rows: terminal.rows });
      if (startProcess) {
        const record = { id, taskId: task.id, workdir, status: "running" as const, createdAt, startedAt: Date.now() };
        sessionRef.current = record;
        onSessionChangeRef.current(record);
      }
    };

    const start = async () => {
      if (!terminalRef.current || disposed) return;
      setState("starting");
      setError("");
      try {
        const current = sessionRef.current;
        if (current?.status === "interrupted") { setState("interrupted"); return; }
        if (current?.status === "running") {
          await attach(current.id, false, current.workdir, current.createdAt);
          return;
        }
        const lock = await acquireTerminalLock(task.id);
        const record: TerminalSessionRecord = { ...lock, status: "starting" };
        sessionRef.current = record;
        onSessionChangeRef.current(record);
        await attach(lock.id, true, lock.workdir, lock.createdAt);
      } catch (cause) {
        if (!disposed) {
          setError(String(cause));
          setState("error");
          terminalRef.current?.write(`\r\nSaber could not start this terminal. ${String(cause)}\r\n`);
        }
        await stop();
      }
    };
    startSessionRef.current = start;

    const initialize = async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
      if (disposed) return;
      const terminal = new Terminal({
        cursorBlink: true,
        convertEol: true,
        scrollback: 5000,
        fontFamily: "Cascadia Code, Consolas, monospace",
        fontSize: 13,
        theme: { background: "#0b0d10", foreground: "#e5e7eb", cursor: "#5eead4", selectionBackground: "#155e75" },
      });
      terminalRef.current = terminal;
      const fit = new FitAddon();
      fitRef.current = fit;
      terminal.loadAddon(fit);
      if (element.current) terminal.open(element.current);
      terminal.options.disableStdin = true;
      terminal.onData((data) => {
        if (started && sessionId) void invoke("terminal_write", { sessionId, data });
      });
      fit.fit();
      resizeObserver = new ResizeObserver(() => {
        fit.fit();
        if (started && sessionId) void invoke("terminal_resize", { sessionId, cols: terminal.cols, rows: terminal.rows });
      });
      if (element.current) resizeObserver.observe(element.current);

      const existing = sessionRef.current;
      if (existing?.status === "interrupted") setState("interrupted");
      else if (existing?.status === "running" || startOnOpen) await start();
      else setState("idle");
    };
    void initialize().catch((cause) => {
      if (!disposed) { setError(String(cause)); setState("error"); }
    });

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      unlistenOutput?.();
      unlistenExit?.();
      terminalRef.current?.dispose();
      terminalRef.current = undefined;
      fitRef.current = undefined;
      startSessionRef.current = undefined;
      void stop();
    };
  }, [task.id, task.project, task.workspace?.path, task.workspace?.state, workspaceBlocked, startOnOpen]);

  async function copyContext(label: string, value: string) {
    if (!value.trim()) { setCopyMessage(`${label} is empty.`); return; }
    try {
      await navigator.clipboard.writeText(value);
      setCopyMessage(`${label} copied.`);
    } catch {
      setCopyMessage("Clipboard access is unavailable in this window.");
    }
    window.setTimeout(() => setCopyMessage(""), 2200);
  }

  async function recover() {
    const current = sessionRef.current;
    if (!current || current.status !== "interrupted") return;
    setRecovering(true);
    try {
      const stopped = await recoverTerminalSession(current.id, true);
      sessionRef.current = stopped;
      onSessionChangeRef.current(stopped);
      setState("idle");
    } catch (cause) {
      setError(String(cause));
    } finally {
      setRecovering(false);
    }
  }

  if (state === "unsupported") {
    return <div className="flex h-full min-h-48 items-center justify-center p-6"><div className="max-w-md text-center"><h2 className="text-lg font-semibold">Open Saber Desktop for a terminal</h2><p className="mt-2 text-sm text-muted">Browser preview cannot start local shells. Open this workspace in the Saber desktop app to use PowerShell, Bash, or your configured shell.</p></div></div>;
  }

  return <div className="flex h-full min-h-48 min-w-0">
    <div className="relative min-w-0 flex-1 overflow-hidden bg-[#0b0d10]">
      <div ref={element} className="h-full w-full px-2 py-2" />
      {state === "starting" && <p className="absolute right-4 top-3 rounded bg-panel px-2 py-1 text-xs text-muted">Starting shell…</p>}
      {state === "error" && <p role="alert" className="absolute inset-x-4 bottom-4 rounded border border-err/40 bg-panel p-3 text-xs text-err">{error}</p>}
      {state === "exited" && <div className="absolute inset-0 flex items-center justify-center bg-[#0b0d10]/95"><div className="text-center"><p className="text-sm font-semibold">Shell exited</p><button type="button" onClick={() => void startSessionRef.current?.()} className="mt-3 rounded border border-line px-3 py-2 text-xs">Start a new terminal</button></div></div>}
      {state === "idle" && <div className="absolute inset-0 flex items-center justify-center bg-[#0b0d10]/95"><div className="text-center"><h3 className="text-sm font-semibold">Terminal is stopped</h3><p className="mt-1 text-xs text-muted">Start a new shell in {sessionRef.current?.workdir ?? task.workspace?.path ?? task.project}.</p><button type="button" onClick={() => void startSessionRef.current?.()} className="mt-3 rounded bg-accent px-3 py-2 text-xs font-semibold text-black">Start terminal</button></div></div>}
      {state === "interrupted" && <div className="absolute inset-0 flex items-center justify-center bg-[#0b0d10]/95"><div className="max-w-md p-6 text-center"><h3 className="text-sm font-semibold">Terminal session interrupted</h3><p className="mt-2 text-xs text-muted">Saber cannot confirm that the old shell has stopped. Confirm it is stopped to unlock this workspace. No command will be replayed.</p><button type="button" disabled={recovering} onClick={() => void recover()} className="mt-3 rounded border border-line px-3 py-2 text-xs disabled:opacity-50">{recovering ? "Recovering…" : "Confirm shell stopped and unlock"}</button>{error && <p role="alert" className="mt-2 text-xs text-err">{error}</p>}</div></div>}
    </div>
    <aside className="flex w-64 shrink-0 flex-col gap-4 overflow-auto border-l border-line bg-panel p-4">
      <section>
        <div className="flex items-center justify-between gap-2"><h3 className="text-xs font-semibold">Saved checkpoint</h3><button type="button" onClick={() => void copyContext("Saved checkpoint", task.context)} className="rounded border border-line px-2 py-1 text-[10px] text-muted hover:text-text">Copy</button></div>
        <p className="mt-2 whitespace-pre-wrap break-words text-xs text-muted">{task.context || "No checkpoint saved."}</p>
      </section>
      <section className="border-t border-line pt-4">
        <div className="flex items-center justify-between gap-2"><h3 className="text-xs font-semibold">Next action</h3><button type="button" onClick={() => void copyContext("Next action", task.draft)} className="rounded border border-line px-2 py-1 text-[10px] text-muted hover:text-text">Copy</button></div>
        <p className="mt-2 whitespace-pre-wrap break-words text-xs text-muted">{task.draft || "No next action saved."}</p>
      </section>
      {copyMessage && <p role="status" className="text-[11px] text-accent">{copyMessage}</p>}
      <p className="mt-auto text-[10px] text-faint">Copying context never types it into the terminal.</p>
    </aside>
  </div>;
}
