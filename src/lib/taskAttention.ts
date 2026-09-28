import type { TaskSummary } from "./tasks";

export const taskAttentionStates = ["running", "interrupted", "failed", "ready_for_review", "verified", "stopped", "draft"] as const;
export type TaskAttentionState = typeof taskAttentionStates[number];

export const taskAttentionLabels: Record<TaskAttentionState, string> = {
  running: "Running",
  interrupted: "Interrupted",
  failed: "Failed",
  ready_for_review: "Ready for review",
  verified: "Verified",
  stopped: "Stopped",
  draft: "Draft",
};

export const taskBoardLanes = [
  { id: "todo", label: "To do", states: ["draft"] },
  { id: "running", label: "Running", states: ["running"] },
  { id: "review", label: "Ready for review", states: ["ready_for_review"] },
  { id: "done", label: "Done", states: ["verified"] },
  { id: "attention", label: "Needs attention", states: ["failed", "interrupted", "stopped"] },
] as const satisfies ReadonlyArray<{ id: string; label: string; states: readonly TaskAttentionState[] }>;

export type TaskBoardLaneId = typeof taskBoardLanes[number]["id"];

export function groupTasksIntoBoardLanes(tasks: TaskSummary[]): Record<TaskBoardLaneId, TaskSummary[]> {
  const groups = Object.fromEntries(taskBoardLanes.map((lane) => [lane.id, []])) as unknown as Record<TaskBoardLaneId, TaskSummary[]>;
  for (const task of tasks) {
    const state = taskAttentionState(task);
    const lane = taskBoardLanes.find((item) => (item.states as readonly TaskAttentionState[]).includes(state));
    if (lane) groups[lane.id].push(task);
  }
  return groups;
}

export function taskAttentionState(task: TaskSummary): TaskAttentionState {
  if (task.verificationSummary?.state === "verified") return "verified";
  const status = task.latestRun?.status;
  if (status === "running") return "running";
  if (status === "interrupted") return "interrupted";
  if (status === "error" || task.verificationSummary?.state === "failed") return "failed";
  if (status === "done") return "ready_for_review";
  if (status === "stopped") return "stopped";
  return "draft";
}
