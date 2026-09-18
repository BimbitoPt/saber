import { useEffect, useRef, useState } from "react";
import { listDevServers } from "../lib/api";
import { Globe2 } from "lucide-react";

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
      <div className="flex flex-wrap items-center gap-2 border-b border-line-soft bg-panel p-2 text-xs">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && navigate(url)}
          placeholder="http://localhost:8081"
          aria-label="URL to visit"
          className="w-64 rounded-md border border-line bg-panel-2 px-2.5 py-1.5 font-mono text-[11px] placeholder:text-faint"
        />
        <button
          onClick={() => navigate(url)}
          className="rounded-md border border-line px-2.5 py-1.5 text-[11px] text-muted transition-colors duration-150 hover:bg-panel-2"
        >
          go
        </button>
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="css selector"
          aria-label="CSS selector for action"
          className="w-40 rounded-md border border-line bg-panel-2 px-2.5 py-1.5 font-mono text-[11px] placeholder:text-faint"
        />
        <button
          onClick={() => act("click")}
          className="rounded-md border border-line px-2.5 py-1.5 text-[11px] text-muted transition-colors duration-150 hover:bg-panel-2"
        >
          click
        </button>
        <label className="flex cursor-pointer items-center gap-1.5 text-muted">
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
            className="flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-[11px] text-muted transition-colors duration-150 hover:bg-panel-2"
          >
            <Globe2 size={11} />
            {s.project}
          </button>
        ))}
        <span className="ml-auto hidden items-center gap-1 text-[10px] text-faint sm:flex">
          <Globe2 size={11} /> rendered by headless chromium in the ADE server
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-[#060607] p-2">
        <img
          src={`/api/browser/screenshot?t=${shot}`}
          alt="Headless browser view"
          className="max-w-full rounded-md border border-line"
        />
      </div>
    </div>
  );
}
