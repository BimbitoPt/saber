import { useEffect, useRef, useState } from "react";
import { listDevServers } from "../lib/api";

export function BrowserPane() {
  const [url, setUrl] = useState("");
  const [target, setTarget] = useState("");
  const [live, setLive] = useState(false);
  const [shot, setShot] = useState(0);
  const [servers, setServers] = useState<Array<{ project: string; port: number; status: string }>>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let alive = true;
    listDevServers()
      .then((d) => alive && setServers(d))
      .catch(() => {});
    const t = setInterval(() => listDevServers().then((d) => alive && setServers(d)).catch(() => {}), 2500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (live) {
      timerRef.current = setInterval(() => setShot((n) => n + 1), 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [live]);

  async function navigate(u: string) {
    await fetch("/api/browser/goto", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: u }),
    });
    setShot((n) => n + 1);
  }

  async function act(action: string) {
    await fetch("/api/browser/act", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, target }),
    });
    setShot((n) => n + 1);
  }

  const up = servers.filter((s) => s.status === "up");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap gap-2 border-b border-neutral-800 p-2 text-xs">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && navigate(url)}
          placeholder="http://localhost:8081"
          className="w-72 rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
        />
        <button onClick={() => navigate(url)} className="rounded border border-neutral-700 px-2 hover:bg-neutral-800">
          go
        </button>
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="css selector"
          className="w-40 rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
        />
        <button onClick={() => act("click")} className="rounded border border-neutral-700 px-2 hover:bg-neutral-800">
          click
        </button>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
          live
        </label>
        {up.map((s) => (
          <button
            key={s.project}
            onClick={() => {
              const u = `http://localhost:${s.port}`;
              setUrl(u);
              navigate(u);
            }}
            className="rounded border border-neutral-700 px-2 text-neutral-400 hover:bg-neutral-800"
          >
            {s.project}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-neutral-950">
        <img src={`/api/browser/screenshot?t=${shot}`} alt="browser" className="max-w-full" />
      </div>
    </div>
  );
}
