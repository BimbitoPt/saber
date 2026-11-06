import { Fragment, useEffect, useState } from "react";
import { fetchDevServerLogs, listDevServers, startDevServer, stopDevServer, type DevServerItem, type DevServerLogs } from "../lib/api";
import { Loader2 } from "lucide-react";

const STATUS_STYLE: Record<string, string> = {
  starting: "text-run",
  up: "text-ok",
  down: "text-err",
};

export function DevServerPane({ onOpenInBrowser }: { onOpenInBrowser?: () => void }) {
  const [servers, setServers] = useState<DevServerItem[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [logsFor, setLogsFor] = useState("");
  const [logs, setLogs] = useState<DevServerLogs | null>(null);
  const [logsError, setLogsError] = useState("");

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const data = await listDevServers();
        if (alive) setServers(data);
      } catch {
        /* transient */
      }
    }
    tick();
    const t = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (!logsFor) return;
    let alive = true;
    let after = 0;
    let seen: DevServerLogs | null = null;
    async function tick() {
      if (document.hidden) return;
      try {
        const data = await fetchDevServerLogs(logsFor, after);
        if (!alive) return;
        after = data.total;
        if (data.lines.length > 0) {
          seen = { lines: [...(seen?.lines ?? []), ...data.lines].slice(-400), total: data.total };
          setLogs(seen);
        }
        setLogsError("");
      } catch (cause) {
        if (alive) setLogsError(String(cause));
      }
    }
    void tick();
    const t = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [logsFor]);

  function toggleLogs(project: string) {
    if (logsFor === project) {
      setLogsFor("");
      setLogs(null);
      setLogsError("");
      return;
    }
    setLogsFor(project);
    setLogs(null);
    setLogsError("");
  }

  async function handle(project: string, action: "start" | "stop") {
    setBusy(project);
    setError("");
    try {
      if (action === "start") await startDevServer(project);
      else await stopDevServer(project);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="h-full overflow-y-auto p-3 text-xs">
      {error && <div className="mb-2 text-err">{error}</div>}
      {servers.length === 0 && (
        <div className="text-faint">No dev servers running. Start one from the CLI or a session form.</div>
      )}
      <table className="w-full" aria-label="Dev servers">
        <tbody>
          {servers.map((s) => (
            <Fragment key={s.project}>
              <tr className="border-b border-line-soft">
                <td className="py-2.5 pl-1 text-[13px]">{s.project}</td>
                <td className="py-2.5 font-mono text-[11px] text-muted">{s.port}</td>
                <td className={`py-2.5 font-mono text-[11px] ${STATUS_STYLE[s.status]}`}>
                  {s.status === "starting" && <Loader2 size={11} className="mr-1 inline animate-spin" />}
                  ({s.status})
                </td>
                <td className="py-2.5 pr-1 text-right">
                  <button
                    disabled={busy === s.project}
                    onClick={() => toggleLogs(s.project)}
                    aria-pressed={logsFor === s.project}
                    className="mr-1.5 rounded-md border border-line px-2.5 py-1.5 text-[11px] text-muted transition-colors duration-150 hover:bg-panel-2 disabled:opacity-40"
                  >
                    {logsFor === s.project ? "hide log" : "log"}
                  </button>
                  {s.status !== "down" ? (
                    <button
                      disabled={busy === s.project}
                      onClick={() => handle(s.project, "stop")}
                      className="rounded-md border border-line px-2.5 py-1.5 text-[11px] text-muted transition-colors duration-150 hover:bg-panel-2 disabled:opacity-40"
                    >
                      stop
                    </button>
                  ) : (
                    <button
                      disabled={busy === s.project}
                      onClick={() => handle(s.project, "start")}
                      className="rounded-md border border-line px-2.5 py-1.5 text-[11px] text-muted transition-colors duration-150 hover:bg-panel-2 disabled:opacity-40"
                    >
                      restart
                    </button>
                  )}
                </td>
              </tr>
              {logsFor === s.project && (
                <tr className="border-b border-line-soft">
                  <td colSpan={4} className="py-1 pl-1 pr-1">
                    {logsError && <div className="mb-1 text-err">{logsError}</div>}
                    <pre data-testid="dev-server-log" className="max-h-56 overflow-auto rounded-md border border-line bg-panel-2 p-2 font-mono text-[10px] leading-4 text-muted">{logs?.lines.length ? logs.lines.join("\n") : (logsError ? "" : "No output yet.")}</pre>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
