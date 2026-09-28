import { useEffect, useMemo, useRef, useState } from "react";
import type { TaskSummary } from "../lib/tasks";
import { filterTasksForSwitcher, groupTasksForSwitcher } from "../lib/taskSwitcher";
import { taskAttentionLabels, taskAttentionState } from "../lib/taskAttention";

interface TaskSwitcherProps {
  tasks: TaskSummary[];
  recentIds: string[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: (restoreFocus: boolean) => void;
}

export function TaskSwitcher({ tasks, recentIds, selectedId, onSelect, onClose }: TaskSwitcherProps) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => groupTasksForSwitcher(tasks, recentIds), [tasks, recentIds]);
  const recentResults = useMemo(() => filterTasksForSwitcher(groups.recent, query), [groups.recent, query]);
  const allResults = useMemo(() => filterTasksForSwitcher(groups.all, query), [groups.all, query]);
  const results = useMemo(() => [...recentResults, ...allResults], [recentResults, allResults]);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeTask = results[activeIndex];
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const listId = "task-switcher-results";

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, results.length - 1)));
  }, [results.length]);

  function choose(index: number) {
    const task = results[index];
    if (!task) return;
    onSelect(task.id);
    onClose(false);
  }

  function renderTask(task: TaskSummary, index: number) {
    const state = taskAttentionState(task);
    return <div id={"task-switcher-option-" + task.id} key={task.id} role="option" aria-selected={activeIndex === index} onMouseEnter={() => setActiveIndex(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(index)} className={"cursor-pointer rounded-md px-3 py-2 " + (activeIndex === index ? "bg-panel-2" : "hover:bg-panel-2")}>
      <div className="flex items-center justify-between gap-3"><span className="truncate text-sm font-medium">{task.title}</span><span className="shrink-0 text-xs text-muted">{task.id === selectedId ? "Current · " : ""}{taskAttentionLabels[state]}</span></div>
      <div className="mt-1 truncate text-xs text-faint">{task.project.split(/[\\/]/).filter(Boolean).at(-1) ?? task.project}</div>
    </div>;
  }

  return <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[12vh]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(true); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="task-switcher-title" className="flex max-h-[82vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-2xl" onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(true); }
      if (event.key === "ArrowDown" && results.length) { event.preventDefault(); setActiveIndex((index) => (index + 1) % results.length); }
      if (event.key === "ArrowUp" && results.length) { event.preventDefault(); setActiveIndex((index) => (index - 1 + results.length) % results.length); }
      if (event.key === "Enter" && results.length) { event.preventDefault(); choose(activeIndex); }
      if (event.key === "Tab") {
        event.preventDefault();
        if (document.activeElement === inputRef.current) closeRef.current?.focus();
        else inputRef.current?.focus();
      }
    }}>
      <div className="flex items-center gap-3 border-b border-line p-4">
        <div className="min-w-0 flex-1">
          <h2 id="task-switcher-title" className="mb-2 text-xs font-semibold text-muted">Switch task</h2>
          <input ref={inputRef} role="combobox" aria-label="Search tasks" aria-expanded="true" aria-controls={listId} aria-activedescendant={results[activeIndex] ? "task-switcher-option-" + results[activeIndex].id : undefined} value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} placeholder="Search by task or project…" className="w-full bg-transparent text-base text-text outline-none placeholder:text-faint" />
        </div>
        <button ref={closeRef} type="button" onClick={() => onClose(true)} className="rounded border border-line px-2 py-1 text-xs text-muted hover:bg-panel-2">Close</button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(18rem,0.85fr)]">
        <div id={listId} role="listbox" aria-label="Tasks" className="max-h-[35vh] overflow-auto p-2 md:max-h-[62vh]">
          {recentResults.length > 0 && <div role="group" aria-label="Recent">
            <h3 className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-faint">Recent</h3>
            {recentResults.map((task, index) => renderTask(task, index))}
          </div>}
          {allResults.length > 0 && <div role="group" aria-label="All tasks">
            <h3 className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-faint">All tasks</h3>
            {allResults.map((task, index) => renderTask(task, recentResults.length + index))}
          </div>}
          {results.length === 0 && <p className="px-3 py-8 text-center text-sm text-muted">{tasks.length ? "No tasks match your search." : "No tasks yet."}</p>}
        </div>
        <aside aria-label="Saved task context" className="max-h-40 min-h-0 overflow-auto border-t border-line p-4 md:max-h-none md:border-l md:border-t-0">
          {activeTask ? <div>
            <h3 className="truncate text-sm font-semibold">{activeTask.title}</h3>
            <section className="mt-4">
              <h4 className="text-xs font-semibold text-muted">Saved checkpoint</h4>
              <p className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md bg-panel-2 p-3 text-xs leading-relaxed text-text">{activeTask.context || "No checkpoint saved."}</p>
            </section>
            <section className="mt-4">
              <h4 className="text-xs font-semibold text-muted">Next action</h4>
              <p className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md bg-panel-2 p-3 text-xs leading-relaxed text-text">{activeTask.draft || "No next action saved."}</p>
            </section>
          </div> : <p className="py-8 text-center text-sm text-muted">Select a matching task to preview its saved context.</p>}
        </aside>
      </div>
      <p className="border-t border-line px-4 py-2 text-xs text-faint">↑↓ move · Enter open · Esc close</p>
    </section>
  </div>;
}
