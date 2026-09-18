import { useEffect, useState } from "react";
import { listDevServers, startDevServer, stopDevServer, type DevServerItem } from "../lib/api";

export function DevServerPane() {
  const [servers, setServers] = useState<DevServerItem[]>([]);
  const [busy, setBusy] = useState(false);
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
    setBusy(true);
    setError("");
    try {
      if (action === "start") await startDevServer(project);
      else await stopDevServer(project);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto p-3 text-xs">
      {error && <div className="mb-2 text-red-400">{error}</div>}
      {servers.length === 0 && (
        <div className="text-neutral-500">No dev servers started (start one from a session form)</div>
      )}
      <table className="w-full">
        <tbody>
          {servers.map((s) => (
            <tr key={s.project} className="border-b border-neutral-800/60">
              <td className="py-2">{s.project}</td>
              <td className="py-2 font-mono text-neutral-400">{s.port}</td>
              <td
                className={
                  s.status === "up"
                    ? "py-2 text-green-400"
                    : s.status === "starting"
                      ? "py-2 text-yellow-400"
                      : "py-2 text-red-400"
                }
              >
                {s.status}
              </td>
              <td className="py-2 text-right">
                {s.status === "up" || s.status === "starting" ? (
                  <button
                    disabled={busy}
                    onClick={() => handle(s.project, "stop")}
                    className="rounded border border-neutral-700 px-2 py-1 hover:bg-neutral-800 disabled:opacity-40"
                  >
                    stop
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
