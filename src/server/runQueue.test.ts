import { describe, expect, it } from "vitest";
import { annotateQueuePositions, DEFAULT_MAX_ACTIVE_RUNS, maxActiveRuns } from "./runQueue";
import type { RunRecord } from "../lib/tasks";

function run(id: string, status: RunRecord["status"]): RunRecord {
  return {
    id, taskId: "task", project: "C:/project", task: "prompt", provider: "opencode",
    specRevision: 1, spec: "spec", criteria: "criteria", context: "",
    status, eventCount: 0, startedAt: 0, exitCode: null,
  };
}

describe("run queue", () => {
  it("defaults to the documented safe limit and validates the override", () => {
    expect(maxActiveRuns({})).toBe(DEFAULT_MAX_ACTIVE_RUNS);
    expect(maxActiveRuns({ SABER_MAX_ACTIVE_RUNS: " 4 " })).toBe(4);
    expect(maxActiveRuns({ SABER_MAX_ACTIVE_RUNS: "1" })).toBe(1);
    expect(() => maxActiveRuns({ SABER_MAX_ACTIVE_RUNS: "0" })).toThrow("between 1 and");
    expect(() => maxActiveRuns({ SABER_MAX_ACTIVE_RUNS: "17" })).toThrow("between 1 and");
    expect(() => maxActiveRuns({ SABER_MAX_ACTIVE_RUNS: "two" })).toThrow("between 1 and");
    expect(() => maxActiveRuns({ SABER_MAX_ACTIVE_RUNS: "2.5" })).toThrow("between 1 and");
  });

  it("annotates queued runs with 1-based FIFO positions and leaves others untouched", () => {
    // listRuns returns newest first: the last queued entry is the FIFO head.
    const runs = [run("newest-active", "running"), run("queued-2", "queued"), run("queued-1", "queued"), run("done", "done")];
    const annotated = annotateQueuePositions(runs);
    expect(annotated.find((item) => item.id === "queued-1")?.queuePosition).toBe(1);
    expect(annotated.find((item) => item.id === "queued-2")?.queuePosition).toBe(2);
    expect(annotated.find((item) => item.id === "newest-active")?.queuePosition).toBeUndefined();
    expect(annotated.find((item) => item.id === "done")?.queuePosition).toBeUndefined();
  });

  it("returns the input list unchanged when nothing is queued", () => {
    const runs = [run("a", "running"), run("b", "done")];
    expect(annotateQueuePositions(runs)).toBe(runs);
  });
});
