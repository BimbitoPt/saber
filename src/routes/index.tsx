import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  listProjects,
  listSessions,
  startSession,
  startDevServer,
  stopSession,
  type Project,
  type SessionListItem,
} from "../lib/api";
import { SessionPane } from "../components/SessionPane";
import { DevServerPane } from "../components/DevServerPane";

export const Route = createFileRoute("/")({
  component: IndexComponent,
});

function IndexComponent() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [project, setProject] = useState("");
  const [task, setTask] = useState("");
  const [model, setModel] = useState("");
  const [booting, setBooting] = useState(false);
  const [error, setError] = useState("");
  const [bottomTab, setBottomTab] = useState<"dev" | "browser">("dev");

  useEffect(() => {
    listProjects()
      .then((ps) => {
        setProjects(ps);
        if (ps.length > 0) setProject((p) => p || ps[0].name);
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    listSessions().then(setSessions).catch(() => {});
  }, []);

  async function launch() {
    if (!project || !task.trim()) return;
    setError("");
    setBooting(true);
    try {
      const { id } = await startSession(project, task.trim(), model.trim() || undefined);
      setSelected(id);
      setTask("");
      const fresh = await listSessions();
      setSessions(fresh);
    } catch (e) {
      setError(String(e));
    } finally {
      setBooting(false);
    }
  }

  async function kill(id: string) {
    try {
      await stopSession(id);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="grid h-full grid-cols-[28rem_1fr] min-h-0">
      <aside className="flex min-h-0 flex-col border-r border-neutral-800">
        <div className="space-y-2 border-b border-neutral-800 p-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500">New session</div>
          <select
            value={project}
            onChange={(e) => setProject(e.target.value)}
            className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm"
          >
            {projects.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
          <textarea
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="What should the agent do?"
            rows={3}
            className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm"
          />
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="model (optional, provider/format)"
            className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm"
          />
          <button
            onClick={launch}
            disabled={booting}
            className="w-full rounded bg-white px-2 py-1.5 text-sm font-semibold text-black hover:bg-neutral-200 disabled:opacity-40"
          >
            {booting ? "starting..." : "start agent"}
          </button>
          {error && <div className="text-xs text-red-400">{error}</div>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`cursor-pointer border-b border-neutral-800/60 px-3 py-2 text-xs hover:bg-neutral-900 ${
                selected === s.id ? "bg-neutral-800/80" : ""
              }`}
              onClick={() => setSelected(s.id)}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold">{s.project}</span>
                <span
                  className={
                    s.status === "running"
                      ? "text-yellow-400"
                      : s.status === "done"
                        ? "text-green-400"
                        : "text-red-400"
                  }
                >
                  {s.status}
                </span>
              </div>
              <div className="mt-1 truncate text-neutral-400">{s.task}</div>
              {s.status === "running" && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    kill(s.id);
                  }}
                  className="mt-1 rounded border border-neutral-700 px-2 py-0.5 text-neutral-400 hover:bg-neutral-800"
                >
                  stop
                </button>
              )}
            </div>
          ))}
        </div>
      </aside>

      <section className="grid min-h-0 grid-rows-[3fr_2fr]">
        <div className="min-h-0 border-b border-neutral-800">
          <SessionPane sessionId={selected} onClosed={() => {}} />
        </div>
        <div className="flex min-h-0 flex-col">
          <div className="flex gap-2 border-b border-neutral-800 px-3 py-1.5 text-xs">
            <button
              onClick={() => setBottomTab("dev")}
              className={bottomTab === "dev" ? "font-semibold text-white" : "text-neutral-500"}
            >
              Dev Servers
            </button>
            <button
              onClick={() => setBottomTab("browser")}
              className={bottomTab === "browser" ? "font-semibold text-white" : "text-neutral-500"}
            >
              Browser (soon)
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {bottomTab === "dev" ? <DevServerPane /> : <BrowserPane />}
          </div>
        </div>
      </section>
    </div>
  );
}
