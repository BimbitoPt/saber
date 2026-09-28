import type { TaskSummary } from "./tasks";

export const RECENT_TASK_LIMIT = 8;
export const RECENT_TASK_STORAGE_KEY = "saber.taskSwitcher.recents";

export function readRecentTaskIds(storage: Pick<Storage, "getItem">): string[] {
  try {
    return parseRecentTaskIds(storage.getItem(RECENT_TASK_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function writeRecentTaskIds(
  storage: Pick<Storage, "setItem">,
  recentIds: string[],
): void {
  try {
    storage.setItem(RECENT_TASK_STORAGE_KEY, JSON.stringify(parseRecentTaskIds(JSON.stringify(recentIds))));
  } catch {
    return;
  }
}

export function parseRecentTaskIds(raw: string | null): string[] {
  if (!raw) return [];

  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const unique: string[] = [];
    for (const item of value) {
      if (typeof item !== "string" || !item.trim() || unique.includes(item)) continue;
      unique.push(item);
      if (unique.length === RECENT_TASK_LIMIT) break;
    }
    return unique;
  } catch {
    return [];
  }
}

export function moveTaskToFront(recentIds: string[], taskId: string): string[] {
  return [...new Set([taskId, ...recentIds.filter((id) => id !== taskId)])].slice(0, RECENT_TASK_LIMIT);
}

export function groupTasksForSwitcher(
  tasks: TaskSummary[],
  recentIds: string[],
): { recent: TaskSummary[]; all: TaskSummary[] } {
  const currentIds = new Set(tasks.map((task) => task.id));
  const recentSet = new Set(recentIds.filter((id) => currentIds.has(id)));
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const recent: TaskSummary[] = [];
  const included = new Set<string>();

  for (const id of recentIds) {
    const task = taskById.get(id);
    if (!task || included.has(id)) continue;
    recent.push(task);
    included.add(id);
  }

  return {
    recent,
    all: tasks.filter((task) => !recentSet.has(task.id)),
  };
}

export function filterTasksForSwitcher(tasks: TaskSummary[], query: string): TaskSummary[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return tasks;
  return tasks.filter((task) => {
    const projectName = task.project.split(/[\\/]/).filter(Boolean).at(-1) ?? task.project;
    return [task.title, projectName, task.project].some((value) => value.toLowerCase().includes(normalized));
  });
}
