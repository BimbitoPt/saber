import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { createTask, listProjects, listTasks, reconcileTerminalSessions, type Project } from "../lib/api";
import { runStatusLabel, type TaskSummary, type TerminalSessionRecord } from "../lib/tasks";
import { taskAttentionLabels, taskAttentionState, taskAttentionStates, type TaskAttentionState } from "../lib/taskAttention";
import { isTerminalRuntimeAvailable } from "../lib/terminalRuntime";
import type { TerminalRuntime } from "../lib/terminalRuntime";
import { moveTaskToFront, readRecentTaskIds, writeRecentTaskIds } from "../lib/taskSwitcher";
import { TaskDetail } from "./TaskDetail";
import { TaskBoard } from "./TaskBoard";
import { TerminalSurface } from "./TerminalSurface";
import { TaskSwitcher } from "./TaskSwitcher";

const inputClass = "w-full rounded-md border border-line bg-panel-2 px-3 py-2 text-sm text-text";

export function TaskWorkspace() {
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState({ project: "", title: "", spec: "", criteria: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [attentionFilter, setAttentionFilter] = useState<TaskAttentionState | "all">("all");
  const [view, setView] = useState<"terminal" | "list" | "board">("terminal");
  const [terminalSessions, setTerminalSessions] = useState<TerminalSessionRecord[]>([]);
  const [openedTerminalTasks, setOpenedTerminalTasks] = useState<Set<string>>(() => new Set());
  const [terminalStartRequests, setTerminalStartRequests] = useState<Set<string>>(() => new Set());
  const [terminalReady, setTerminalReady] = useState(false);
  const [terminalStartupError, setTerminalStartupError] = useState("");
  const [taskSwitcherOpen, setTaskSwitcherOpen] = useState(false);
  const [recentTaskIds, setRecentTaskIds] = useState<string[]>([]);
  const switcherReturnFocus = useRef<HTMLElement | null>(null);
  const restoreSwitcherFocus = useRef(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey || event.key.toLowerCase() !== "p" || taskSwitcherOpen) return;
      const target = event.target;
      const element = target instanceof HTMLElement ? target : null;
      const inTerminal = element?.closest(".xterm");
      if (!inTerminal && (element?.isContentEditable || element?.closest("input, textarea, select, [contenteditable='true']"))) return;
      event.preventDefault();
      event.stopPropagation();
      switcherReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      restoreSwitcherFocus.current = false;
      setTaskSwitcherOpen(true);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [taskSwitcherOpen]);

  useEffect(() => {
    if (taskSwitcherOpen || !restoreSwitcherFocus.current) return;
    restoreSwitcherFocus.current = false;
    switcherReturnFocus.current?.focus();
  }, [taskSwitcherOpen]);

  function closeTaskSwitcher(restoreFocus: boolean) {
    restoreSwitcherFocus.current = restoreFocus;
    setTaskSwitcherOpen(false);
  }

  useEffect(() => {
    try {
      setSelected(localStorage.getItem("saber.selectedTask"));
      const draft = JSON.parse(localStorage.getItem("saber.newTask") ?? "null");
      if (draft && ["project", "title", "spec", "criteria"].every((key) => typeof draft[key] === "string")) setForm(draft);
    } catch {}
    try { setRecentTaskIds(readRecentTaskIds(localStorage)); } catch {}
    let cancelled = false;
    listProjects().then((items) => {
      if (cancelled) return;
      setProjects(items);
      setForm((old) => ({ ...old, project: old.project || items[0]?.path || "" }));
    }).catch(() => {});
    const refresh = () => listTasks().then((items) => {
      if (!cancelled) { setTasks(items); setLoaded(true); }
    }).catch((e) => { if (!cancelled) setError(String(e)); });
    void refresh();
    const timer = setInterval(refresh, 2000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      if (!isTerminalRuntimeAvailable(window as Window & TerminalRuntime)) {
        const savedSelection = localStorage.getItem("saber.selectedTask");
        if (savedSelection) setOpenedTerminalTasks(new Set([savedSelection]));
        setTerminalReady(true);
        return;
      }
      try {
        const liveSessionIds = await invoke<string[]>("terminal_list");
        const sessions = await reconcileTerminalSessions(liveSessionIds);
        if (cancelled) return;
        setTerminalSessions(sessions);
        setOpenedTerminalTasks(new Set(sessions.filter((session) => session.status !== "stopped").map((session) => session.taskId)));
        setTerminalReady(true);
      } catch (cause) {
        if (!cancelled) setTerminalStartupError(String(cause));
      }
    };
    void initialize();
    return () => { cancelled = true; };
  }, []);

  function select(id: string | null) {
    setSelected(id);
    if (id) {
      const alreadyOpened = openedTerminalTasks.has(id);
      setOpenedTerminalTasks((old) => new Set(old).add(id));
      if (!alreadyOpened) setTerminalStartRequests((old) => new Set(old).add(id));
    }
    try { id ? localStorage.setItem("saber.selectedTask", id) : localStorage.removeItem("saber.selectedTask"); } catch {}
  }

  function updateTerminalSession(session: TerminalSessionRecord) {
    setTerminalSessions((old) => [session, ...old.filter((item) => item.id !== session.id)]);
    setOpenedTerminalTasks((old) => new Set(old).add(session.taskId));
  }

  function terminalSession(taskId: string) {
    const sessions = terminalSessions.filter((item) => item.taskId === taskId);
    return sessions.find((item) => item.status !== "stopped") ?? sessions[0];
  }

  function edit(field: keyof typeof form, value: string) {
    const next = { ...form, [field]: value };
    setForm(next);
    try { localStorage.setItem("saber.newTask", JSON.stringify(next)); }
    catch { setError("Browser recovery storage is unavailable. Keep this tab open until the task is created."); }
  }

  async function create() {
    setBusy(true); setError("");
    try {
      const task = await createTask(form);
      setTasks((old) => [task, ...old]);
      select(task.id);
      setView("terminal");
      const next = { project: form.project, title: "", spec: "", criteria: "" };
      setForm(next);
      try { localStorage.setItem("saber.newTask", JSON.stringify(next)); } catch {}
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  const task = tasks.find((item) => item.id === selected);
  const attentionCounts = Object.fromEntries(taskAttentionStates.map((state) => [state, tasks.filter((item) => taskAttentionState(item) === state).length])) as Record<TaskAttentionState, number>;
  const visibleTasks = attentionFilter === "all" ? tasks : tasks.filter((item) => taskAttentionState(item) === attentionFilter);
  const terminalTaskIds = [...openedTerminalTasks].filter((taskId) => {
    const session = terminalSession(taskId);
    return view === "terminal" || Boolean(session && session.status !== "stopped");
  });

  return <div className="relative flex h-full min-h-0 flex-col">
    <div className="flex shrink-0 items-center justify-between border-b border-line bg-panel px-4 py-2">
      <span className="text-xs font-semibold text-muted">Workspace</span>
      <div role="group" aria-label="Task view" className="flex rounded border border-line p-0.5">
        <button type="button" aria-pressed={view === "terminal"} onClick={() => setView("terminal")} className={`rounded px-3 py-1.5 text-xs focus-visible:outline-2 focus-visible:outline-accent ${view === "terminal" ? "bg-panel-2 text-text" : "text-muted hover:text-text"}`}>Terminal</button>
        <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")} className={`rounded px-3 py-1.5 text-xs focus-visible:outline-2 focus-visible:outline-accent ${view === "list" ? "bg-panel-2 text-text" : "text-muted hover:text-text"}`}>List</button>
        <button type="button" aria-pressed={view === "board"} onClick={() => setView("board")} className={`rounded px-3 py-1.5 text-xs focus-visible:outline-2 focus-visible:outline-accent ${view === "board" ? "bg-panel-2 text-text" : "text-muted hover:text-text"}`}>Board</button>
      </div>
    </div>
    <div className={"grid min-h-0 flex-1 grid-cols-[18rem_1fr]" + (view === "board" ? " invisible pointer-events-none" : "")} aria-hidden={view === "board"}>
    <aside className="flex min-h-0 flex-col border-r border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line p-4">
        <h1 className="text-sm font-semibold">Tasks</h1>
        <button className="rounded border border-line px-3 py-1 text-xs hover:bg-panel-2" onClick={() => { select(null); setView("list"); }}>New task</button>
      </div>
      <div aria-label="Task attention filters" className="flex flex-wrap gap-1 border-b border-line p-2">
        <button type="button" aria-pressed={attentionFilter === "all"} onClick={() => setAttentionFilter("all")} className={`rounded px-2 py-1 text-xs ${attentionFilter === "all" ? "bg-panel-2 text-text" : "text-muted hover:bg-panel-2"}`}>All · {tasks.length}</button>
        {taskAttentionStates.map((state) => <button key={state} type="button" aria-pressed={attentionFilter === state} onClick={() => setAttentionFilter(state)} className={`rounded px-2 py-1 text-xs ${attentionFilter === state ? "bg-panel-2 text-text" : "text-muted hover:bg-panel-2"}`}>{taskAttentionLabels[state]} · {attentionCounts[state]}</button>)}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {visibleTasks.map((item) => <button key={item.id} onClick={() => select(item.id)} aria-pressed={selected === item.id}
          className={`block w-full border-b border-line-soft p-4 text-left hover:bg-panel-2 ${selected === item.id ? "bg-panel-2" : ""}`}>
          <div className="truncate text-sm font-semibold">{item.title}</div>
          <div className="mt-1 truncate text-xs text-muted">{item.project.split(/[\\/]/).pop()}</div>
          <div className="mt-2 text-xs text-faint">{item.latestRun ? runStatusLabel[item.latestRun.status] : "Draft"} · Spec {item.revision}{item.verificationSummary?.state === "verified" ? " · Verified" : ""}</div>
        </button>)}
        {loaded && visibleTasks.length === 0 && tasks.length === 0 && <p className="p-4 text-xs text-muted">Start with a spec. Your tasks and context stay here between sessions.</p>}
        {loaded && visibleTasks.length === 0 && tasks.length > 0 && <p className="p-4 text-xs text-muted">No {attentionFilter === "all" ? "" : taskAttentionLabels[attentionFilter].toLowerCase() + " "}tasks match this filter.</p>}
      </div>
    </aside>
    <section className="relative min-h-0 overflow-hidden">
      {error && <p role="alert" className="p-3 text-sm text-err">{error}</p>}
      <div className={"absolute inset-0 flex flex-col overflow-auto" + (view === "terminal" ? "" : " invisible pointer-events-none")} aria-hidden={view !== "terminal"}>
      {task ? <div className="flex h-full min-h-0 flex-col">
          <div className="flex shrink-0 items-center justify-between gap-4 border-b border-line bg-panel px-4 py-3">
            <div className="min-w-0"><h2 className="truncate text-sm font-semibold">{task.title}</h2><p className="truncate text-xs text-muted">{task.workspace?.state === "ready" ? task.workspace.path : task.project}</p></div>
            <button type="button" onClick={() => setView("list")} className="shrink-0 rounded border border-line px-3 py-1.5 text-xs hover:bg-panel-2">Task details</button>
          </div>
          {terminalStartupError && <p role="alert" className="p-3 text-xs text-err">Saber could not reconcile terminal sessions: {terminalStartupError}</p>}
          <div className="relative min-h-0 flex-1">
            {!terminalReady && <p className="p-6 text-xs text-muted">Checking terminal sessions…</p>}
            {terminalReady && !openedTerminalTasks.has(task.id) && <div className="flex h-full items-center justify-center"><div className="text-center"><p className="text-sm font-semibold">No terminal is running for this task.</p><button type="button" onClick={() => select(task.id)} className="mt-3 rounded bg-accent px-3 py-2 text-xs font-semibold text-black">Start terminal</button></div></div>}
            {terminalReady && terminalTaskIds.map((taskId) => {
              const item = tasks.find((candidate) => candidate.id === taskId);
              if (!item) return null;
              const active = view === "terminal" && taskId === selected;
              return <div key={taskId} className={`absolute inset-0 ${active ? "visible" : "invisible pointer-events-none"}`} aria-hidden={!active}>
                <TerminalSurface task={item} session={terminalSession(item.id)} active={active} startOnOpen={terminalStartRequests.has(item.id)} onSessionChange={updateTerminalSession} />
              </div>;
            })}
          </div>
        </div>
        : selected && !loaded ? <p className="p-6 text-muted">Restoring tasks...</p>
        : <div className="mx-auto my-auto max-w-lg p-8 text-center"><h2 className="text-xl font-semibold">Choose a task to open its terminal</h2><p className="mt-2 text-sm text-muted">Each task opens a shell in its project or isolated workspace. Run Herdr, an agent CLI, or any command you choose.</p><button type="button" onClick={() => { select(null); setView("list"); }} className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-black">Create a task</button></div>
        }
      </div>
      {view === "list" && (task && (attentionFilter === "all" || taskAttentionState(task) === attentionFilter) ? <div className="absolute inset-0 overflow-auto"><TaskDetail key={task.id} task={task} onSaved={(saved) => setTasks((old) => old.map((item) => item.id === saved.id ? { ...item, ...saved } : item))} /></div>
        : task ? <div className="p-6"><p className="text-sm text-muted">{task.title} is hidden by the {taskAttentionLabels[attentionFilter as TaskAttentionState]} filter. Its task and run remain selected.</p><button type="button" onClick={() => setAttentionFilter("all")} className="mt-3 rounded border border-line px-3 py-2 text-xs">Show all tasks</button></div>
        : selected && !loaded ? <p className="p-6 text-muted">Restoring tasks...</p>
        : <form onSubmit={(e) => { e.preventDefault(); void create(); }} className="mx-auto max-w-2xl space-y-4 p-6">
          <div><h2 className="text-xl font-semibold">Define the work</h2><p className="mt-1 text-sm text-muted">Save a task, then choose OpenCode, Codex, or Claude Code. Each attempt keeps its own specification and history.</p></div>
          <label className="block space-y-1 text-xs text-muted"><span>Project path</span>
            <input required list="task-projects" value={form.project} onChange={(e) => edit("project", e.target.value)} className={inputClass} placeholder="Absolute path to your project" />
            <datalist id="task-projects">{projects.map((project) => <option key={project.path} value={project.path}>{project.name}</option>)}</datalist>
          </label>
          <label className="block space-y-1 text-xs text-muted"><span>Task title</span><input required value={form.title} onChange={(e) => edit("title", e.target.value)} className={inputClass} /></label>
          <label className="block space-y-1 text-xs text-muted"><span>Specification</span><textarea required rows={4} value={form.spec} onChange={(e) => edit("spec", e.target.value)} className={inputClass} placeholder="What should change, and what is outside scope?" /></label>
          <label className="block space-y-1 text-xs text-muted"><span>Acceptance criteria</span><textarea required rows={3} value={form.criteria} onChange={(e) => edit("criteria", e.target.value)} className={inputClass} placeholder={"AC-01: What must be true?\nAC-02: What else must hold?"} /></label>
          <button disabled={busy} className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-40">{busy ? "Saving..." : "Create task"}</button>
        </form>)}
      </section>
    </div>
    {view === "board" && <div className="absolute inset-x-0 bottom-0 top-[3.25rem]"><TaskBoard tasks={tasks} selectedId={selected} onSelect={(id) => { select(id); setAttentionFilter("all"); setView("list"); }} onNewTask={() => { select(null); setView("list"); }} /></div>}
    {taskSwitcherOpen && <TaskSwitcher tasks={tasks} recentIds={recentTaskIds} selectedId={selected} onClose={closeTaskSwitcher} onSelect={(id) => {
      const nextRecentIds = moveTaskToFront(recentTaskIds, id);
      setRecentTaskIds(nextRecentIds);
      try { writeRecentTaskIds(localStorage, nextRecentIds); } catch {}
      select(id);
      setAttentionFilter("all");
      setView("terminal");
    }} />}
  </div>;
}
