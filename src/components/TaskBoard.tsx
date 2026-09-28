import { runStatusLabel, type TaskSummary } from "../lib/tasks";
import { groupTasksIntoBoardLanes, taskAttentionLabels, taskAttentionState, taskBoardLanes } from "../lib/taskAttention";

const laneTone = {
  todo: "border-t-line",
  running: "border-t-accent",
  review: "border-t-warn",
  done: "border-t-ok",
  attention: "border-t-err",
} as const;

export function TaskBoard({ tasks, selectedId, onSelect, onNewTask }: {
  tasks: TaskSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewTask: () => void;
}) {
  const groups = groupTasksIntoBoardLanes(tasks);

  return <section aria-label="Task board" className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <header className="flex shrink-0 flex-wrap items-end justify-between gap-3 border-b border-line px-5 py-4">
      <div><h2 className="text-lg font-semibold">Task board</h2><p className="mt-1 text-xs text-muted">Columns follow run and verification state. Open a task to act on it.</p></div>
      <button type="button" onClick={onNewTask} className="rounded border border-line px-3 py-2 text-xs text-text hover:bg-panel-2 focus-visible:outline-2 focus-visible:outline-accent">New task</button>
    </header>
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4" aria-label="Task workflow lanes">
      {taskBoardLanes.map((lane) => {
        const items = groups[lane.id];
        return <section key={lane.id} aria-label={`${lane.label}, ${items.length} tasks`} className={`flex w-64 min-w-56 shrink-0 flex-col overflow-hidden rounded-md border border-line border-t-2 ${laneTone[lane.id]} bg-panel`}>
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line-soft px-3 py-3">
            <h3 className="text-xs font-semibold text-text">{lane.label}</h3><span className="rounded bg-panel-2 px-2 py-0.5 font-mono text-xs text-muted" aria-label={`${items.length} tasks`}>{items.length}</span>
          </header>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
            {items.map((task) => {
              const state = taskAttentionState(task);
              const stateLabel = state === "verified"
                ? taskAttentionLabels.verified
                : state === "failed" && task.verificationSummary?.state === "failed"
                ? "Verification failed"
                : task.latestRun?.status === "done" && task.verificationSummary?.state === "incomplete" && task.verificationSummary.stale > 0
                  ? "Stale evidence"
                  : task.latestRun ? runStatusLabel[task.latestRun.status] : taskAttentionLabels[state];
              const projectName = task.project.split(/[\\/]/).filter(Boolean).at(-1) ?? task.project;
              return <button key={task.id} type="button" aria-pressed={selectedId === task.id} onClick={() => onSelect(task.id)}
                className={`block w-full rounded border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-accent ${selectedId === task.id ? "border-accent bg-panel-2" : "border-line-soft bg-panel-2/60 hover:border-line"}`}>
                <span className="block text-sm font-semibold leading-snug text-text">{task.title}</span>
                <span className="mt-2 block truncate text-xs text-muted" title={task.project}>{projectName}</span>
                <span className="mt-3 flex items-center justify-between gap-2 border-t border-line-soft pt-2 text-xs text-faint">
                  <span>{stateLabel}</span><span className="font-mono">Spec {task.revision}</span>
                </span>
                {task.latestRun && <span className="mt-1 block text-xs text-faint">{task.latestRun.provider}{task.latestRun.model ? ` · ${task.latestRun.model}` : ""}</span>}
              </button>;
            })}
            {items.length === 0 && <p className="rounded border border-dashed border-line-soft p-3 text-xs text-faint">No tasks in this lane.</p>}
          </div>
        </section>;
      })}
    </div>
  </section>;
}
