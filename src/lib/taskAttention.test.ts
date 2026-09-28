import { describe, expect, it } from "vitest";
import type { TaskSummary } from "./tasks";
import { groupTasksIntoBoardLanes, taskAttentionState } from "./taskAttention";

let taskSequence = 0;
const task = (run?: TaskSummary["latestRun"], verification?: TaskSummary["verificationSummary"]) => ({
  id: `task-${taskSequence++}`, project: "project", title: "Task", spec: "spec", criteria: "criteria", revision: 1,
  context: "", draft: "", createdAt: 0, updatedAt: 0, latestRun: run, verificationSummary: verification,
}) as TaskSummary;

const run = (status: NonNullable<TaskSummary["latestRun"]>["status"]) => ({ status }) as NonNullable<TaskSummary["latestRun"]>;

describe("task attention state", () => {
  it("maps each provider run lifecycle state", () => {
    expect(taskAttentionState(task())).toBe("draft");
    expect(taskAttentionState(task(run("running")))).toBe("running");
    expect(taskAttentionState(task(run("interrupted")))).toBe("interrupted");
    expect(taskAttentionState(task(run("error")))).toBe("failed");
    expect(taskAttentionState(task(run("done")))).toBe("ready_for_review");
    expect(taskAttentionState(task(run("stopped")))).toBe("stopped");
  });

  it("gives verified and failed verification precedence over run completion", () => {
    expect(taskAttentionState(task(run("done"), { state: "verified" } as TaskSummary["verificationSummary"]))).toBe("verified");
    expect(taskAttentionState(task(run("done"), { state: "failed" } as TaskSummary["verificationSummary"]))).toBe("failed");
    expect(taskAttentionState(task(run("running"), { state: "verified" } as TaskSummary["verificationSummary"]))).toBe("verified");
  });

  it("groups every task exactly once into its derived board lane", () => {
    const tasks: TaskSummary[] = [
      task(), task(run("running")), task(run("done")), task(undefined, { state: "verified" } as TaskSummary["verificationSummary"]),
      task(run("error")), task(run("interrupted")), task(run("stopped")),
    ];
    const lanes = groupTasksIntoBoardLanes(tasks);
    expect(Object.fromEntries(Object.entries(lanes).map(([id, items]) => [id, items.length]))).toEqual({
      todo: 1, running: 1, review: 1, done: 1, attention: 3,
    });
    expect(Object.values(lanes).flat()).toHaveLength(tasks.length);
    expect(new Set(Object.values(lanes).flat().map((item) => item.id)).size).toBe(tasks.length);
    expect(lanes.todo.map((item) => item.id)).toEqual([tasks[0].id]);
    expect(lanes.running.map((item) => item.id)).toEqual([tasks[1].id]);
    expect(lanes.review.map((item) => item.id)).toEqual([tasks[2].id]);
    expect(lanes.done.map((item) => item.id)).toEqual([tasks[3].id]);
    expect(lanes.attention.map((item) => item.id)).toEqual([tasks[4].id, tasks[5].id, tasks[6].id]);
  });
});
