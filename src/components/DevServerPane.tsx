import { useEffect, useState } from "react";
import { listDevServers, startDevServer, stopDevServer, type DevServerItem } from "../lib/api";
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
            <tr key={s.project} className="border-b border-line-soft">
              <td className="py-2.5 pl-1 text-[13px]">{s.project}</td>
              <td className="py-2.5 font-mono text-[11px] text-muted">{s.port}</td>
              <td className={`py-2.5 font-mono text-[11px] ${STATUS_STYLE[s.status]}`}>
                {s.status === "starting" && <Loader2 size={11} className="mr-1 inline animate-spin" />}
                ({s.status})
              </td>
              <td className="py-2.5 pr-1 text-right">
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
