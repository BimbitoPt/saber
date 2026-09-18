import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Play, Square, Loader2 } from "lucide-react";
import {
  listProjects,
  listSessions,
  startSession,
  startDevServer,
  stopSession,
  defaultModel,
  type Project,
  type SessionListItem,
} from "../lib/api";
import { SessionPane } from "../components/SessionPane";
import { DevServerPane } from "../components/DevServerPane";
import { BrowserPane } from "../components/BrowserPane";

export const Route = createFileRoute("/")({
  component: IndexComponent,
});

const STATUS_COLOR: Record<string, string> = {
  running: "text-run",
  done: "text-ok",
  stopped: "text-muted",
  error: "text-err",
};

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
  const [defaultModelLabel, setDefaultModelLabel] = useState("");

  useEffect(() => {
    defaultModel()
      .then((d) => setDefaultModelLabel(d.default))
      .catch(() => setDefaultModelLabel(""));
  }, []);

  useEffect(() => {
    listProjects()
      .then((ps) => {
        setProjects(ps);
        if (ps.length > 0) setProject((p) => p || ps[0].name);
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    const t = setInterval(() => listSessions().then(setSessions).catch(() => {}), 2000);
    listSessions().then(setSessions).catch(() => {});
    return () => clearInterval(t);
  }, []);

  async function launch() {
    if (!project || !task.trim()) return;
    setError("");
    setBooting(true);
    try {
      const { id } = await startSession(project, task.trim(), model.trim() || undefined);
      setSelected(id);
      setTask("");
      setSessions(await listSessions());
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
    <div className="grid h-full min-h-0 grid-cols-[26rem_1fr]">
      <aside className="flex min-h-0 flex-col border-r border-line bg-panel">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            launch();
          }}
          className="space-y-3 border-b border-line p-4"
        >
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-faint">New session</div>
          <div className="space-y-1">
            <label htmlFor="ade-project" className="text-xs text-muted">Project</label>
            <select
              id="ade-project"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              className="w-full rounded-md border border-line bg-panel-2 px-2.5 py-2 text-sm text-text transition-colors duration-150 hover:border-faint"
            >
              {projects.map((p) => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="ade-task" className="text-xs text-muted">Task</label>
            <textarea
              id="ade-task"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="What should the agent do?"
              rows={3}
              className="w-full resize-none rounded-md border border-line bg-panel-2 px-2.5 py-2 text-sm placeholder:text-faint"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="ade-model" className="text-xs text-muted" >
              Model <span className="text-faint">(empty = opencode default)</span>
            </label>
            <input
              id="ade-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="default — from opencode config"
              className="w-full rounded-md border border-line bg-panel-2 px-2.5 py-2 text-sm placeholder:text-faint"
            />
            {defaultModelLabel && (
              <div className="text-[10px] text-faint">opencode default: {defaultModelLabel}</div>
            )}
          </div>
          <button
            type="submit"
            disabled={booting}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-accent px-2.5 py-2 text-sm font-semibold text-black transition-colors duration-150 hover:bg-[#7aa3ff] disabled:opacity-40"
          >
            {booting ? <Loader2 size={14} className="animate-spin" /> : <Play size={13} />}
            {booting ? "Starting" : "Start agent"}
          </button>
          {error && <div className="text-xs text-err">{error}</div>}
        </form>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelected(s.id)}
              className={`w-full border-b border-line-soft px-4 py-3 text-left transition-colors duration-150 hover:bg-panel-2 ${
                selected === s.id ? "bg-panel-2" : ""
              }`}
              aria-pressed={selected === s.id}
            >
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold">{s.project}</span>
                <span className={`font-mono text-[11px] ${STATUS_COLOR[s.status]}`}>({s.status})</span>
              </div>
              <div className="mt-1 truncate text-xs text-muted">{s.task}</div>
              <div className="mt-1.5 flex items-center justify-between">
                <span className="font-mono text-[10px] text-faint">{s.id.slice(0, 8)}</span>
                {s.status === "running" && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      kill(s.id);
                    }}
                    className="cursor-pointer rounded border border-line px-1.5 py-0.5 text-[10px] text-muted hover:bg-panel-2"
                  >
                    stop
                  </span>
                )}
              </div>
            </button>
          ))}
          {sessions.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-faint">No sessions yet</div>
          )}
        </div>
      </aside>

      <section className="grid min-h-0 grid-rows-[3fr_2fr]">
        <div className="min-h-0 border-b border-line">
          <SessionPane sessionId={selected} onClosed={() => {}} />
        </div>
        <div className="flex min-h-0 flex-col">
          <div className="flex gap-1 border-b border-line px-3" role="tablist">
            <TabButton active={bottomTab === "dev"} onClick={() => setBottomTab("dev")} label="Dev Servers" />
            <TabButton active={bottomTab === "browser"} onClick={() => setBottomTab("browser")} label="Browser" />
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {bottomTab === "dev" ? <DevServerPane /> : <BrowserPane />}
          </div>
        </div>
      </section>
    </div>
  );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`border-b-2 px-3 py-2 text-xs transition-colors duration-150 ${
        active ? "border-accent text-text" : "border-transparent text-muted hover:text-text"
      }`}
    >
      {label}
    </button>
  );
}
