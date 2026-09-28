import { describe, expect, it } from "vitest";
import type { TaskSummary } from "./tasks";
import { filterTasksForSwitcher, groupTasksForSwitcher, moveTaskToFront, parseRecentTaskIds, readRecentTaskIds, RECENT_TASK_STORAGE_KEY, writeRecentTaskIds } from "./taskSwitcher";

const makeTask = (id: string, title: string, project: string): TaskSummary => ({
  id,
  project,
  title,
  spec: "spec",
  criteria: "AC-01: works",
  revision: 1,
  context: "",
  draft: "",
  createdAt: 1,
  updatedAt: 1,
});

describe("filterTasksForSwitcher", () => {
  const tasks = [
    makeTask("task-1", "API Adapter", "C:/workspaces/saber-core"),
    makeTask("task-2", "Terminal Styling", "D:/projects/Saber App"),
  ];

  it("matches task titles without case sensitivity", () => {
    expect(filterTasksForSwitcher(tasks, "  aPi  ")).toEqual([tasks[0]]);
  });

  it("matches project basenames and full paths", () => {
    expect(filterTasksForSwitcher(tasks, "saber app")).toEqual([tasks[1]]);
    expect(filterTasksForSwitcher(tasks, "workspaces")).toEqual([tasks[0]]);
  });

  it("preserves current task order and returns the original tasks for an empty query", () => {
    expect(filterTasksForSwitcher(tasks, "")).toBe(tasks);
    expect(filterTasksForSwitcher(tasks, "saber")).toEqual(tasks);
  });

  it("returns no results when the query does not match", () => {
    expect(filterTasksForSwitcher(tasks, "missing-task")).toEqual([]);
    expect(filterTasksForSwitcher([], "anything")).toEqual([]);
  });
});

describe("recent task ordering", () => {
  const tasks = [
    makeTask("a", "Alpha", "C:/work/alpha"),
    makeTask("b", "Beta", "C:/work/beta"),
    makeTask("c", "Gamma", "C:/work/gamma"),
    makeTask("d", "Delta", "C:/work/delta"),
  ];

  it("parses only unique non-empty string IDs and caps them at eight", () => {
    expect(parseRecentTaskIds(null)).toEqual([]);
    expect(parseRecentTaskIds("{broken")).toEqual([]);
    expect(parseRecentTaskIds(JSON.stringify({ ids: ["a"] }))).toEqual([]);
    expect(parseRecentTaskIds(JSON.stringify(["a", "", "a", 3, "b"]))).toEqual(["a", "b"]);
    expect(parseRecentTaskIds(JSON.stringify(Array.from({ length: 10 }, (_, index) => "task-" + index))))
      .toEqual(Array.from({ length: 8 }, (_, index) => "task-" + index));
  });

  it("moves the selected task first, deduplicates, and evicts IDs past the limit", () => {
    expect(moveTaskToFront(["a", "b", "a", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(moveTaskToFront(Array.from({ length: 8 }, (_, index) => "task-" + index), "new-task"))
      .toEqual(["new-task", ...Array.from({ length: 7 }, (_, index) => "task-" + index)]);
  });

  it("groups current tasks by recent order and preserves source order for the rest", () => {
    expect(groupTasksForSwitcher(tasks, ["c", "a", "missing", "c"])).toEqual({
      recent: [tasks[2], tasks[0]],
      all: [tasks[1], tasks[3]],
    });
    expect(groupTasksForSwitcher(tasks, [])).toEqual({ recent: [], all: tasks });
    expect(groupTasksForSwitcher(tasks, ["stale"])).toEqual({ recent: [], all: tasks });
  });

  it("filters recent and remaining tasks while keeping recents first", () => {
    const groups = groupTasksForSwitcher(tasks, ["c", "a"]);
    expect([
      ...filterTasksForSwitcher(groups.recent, "work"),
      ...filterTasksForSwitcher(groups.all, "work"),
    ]).toEqual([tasks[2], tasks[0], tasks[1], tasks[3]]);
    expect(filterTasksForSwitcher(groups.recent, "gamma")).toEqual([tasks[2]]);
    expect(filterTasksForSwitcher(groups.all, "C:/work/beta")).toEqual([tasks[1]]);
  });

  it("reads and writes only the dedicated preference key", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    writeRecentTaskIds(storage, ["b", "a", "b"]);

    expect(readRecentTaskIds(storage)).toEqual(["b", "a"]);
    expect(values.get(RECENT_TASK_STORAGE_KEY)).toBe(JSON.stringify(["b", "a"]));
    expect(values.size).toBe(1);
  });

  it("treats storage read and write failures as non-fatal", () => {
    expect(readRecentTaskIds({ getItem: () => { throw new Error("blocked"); } })).toEqual([]);
    expect(() => writeRecentTaskIds({ setItem: () => { throw new Error("blocked"); } }, ["a"])).not.toThrow();
  });
});
