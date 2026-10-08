// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listTeams: vi.fn(),
  reviewRunWorktree: vi.fn(),
  mergeRunWorktree: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  listTeams: (...args: unknown[]) => mocks.listTeams(...args),
  reviewRunWorktree: (...args: unknown[]) => mocks.reviewRunWorktree(...args),
  mergeRunWorktree: (...args: unknown[]) => mocks.mergeRunWorktree(...args),
}));

import { TeamReviewList } from "./TeamReviewList";
import type { RunRecord } from "../lib/tasks";

function run(overrides: Partial<RunRecord> & { id: string }): RunRecord {
  return {
    taskId: "task-1", project: "/work/tree", task: "prompt", provider: "opencode",
    specRevision: 1, spec: "spec", criteria: "AC-01", context: "",
    status: "done", eventCount: 0, startedAt: 1, exitCode: 0, ...overrides,
  } as RunRecord;
}

const team = {
  id: "team-1", taskId: "task-1", createdAt: 1,
  members: [
    { role: "implementer", provider: "opencode" as const, runId: "run-1" },
    { role: "reviewer", provider: "claude" as const, runId: "run-missing" },
  ],
};

let root: Root;
let host: HTMLDivElement;

async function flush() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

async function clickButton(label: string) {
  const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label);
  if (!button) throw new Error("Could not find button: " + label);
  await act(async () => { button.click(); });
  await flush();
}

describe("TeamReviewList", () => {
  beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    mocks.listTeams.mockResolvedValue([team]);
    mocks.reviewRunWorktree.mockResolvedValue({ head: "abc123", branch: "saber/a/b", status: "M file.txt", diff: "+change" });
    mocks.mergeRunWorktree.mockResolvedValue({ ok: true, head: "abc123", cleanedUp: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it("renders member states and marks runs without records blocked", async () => {
    await act(async () => { root.render(createElement(TeamReviewList, { taskId: "task-1", runs: [run({ id: "run-1" })], onChanged: () => {} })); });
    await flush();
    const text = document.body.textContent ?? "";
    expect(text).toContain("implementer · OpenCode");
    expect(text).toContain("Ready for review");
    expect(text).toContain("Blocked · no run recorded");
    expect(text).not.toContain("Verified");
  });

  it("merges only after an explicit review of a finished member", async () => {
    await act(async () => { root.render(createElement(TeamReviewList, { taskId: "task-1", runs: [run({ id: "run-1" })], onChanged: () => {} })); });
    await flush();
    expect(mocks.mergeRunWorktree).not.toHaveBeenCalled();
    await clickButton("Review changes");
    expect(mocks.reviewRunWorktree).toHaveBeenCalledWith("task-1", "run-1");
    expect(document.body.textContent).toContain("+change");
    await clickButton("Merge reviewed head");
    expect(mocks.mergeRunWorktree).toHaveBeenCalledWith("task-1", "run-1", "abc123");
    expect(document.body.textContent).toContain("Merged abc123");
  });

  it("disables merge while a member is still running", async () => {
    await act(async () => { root.render(createElement(TeamReviewList, { taskId: "task-1", runs: [run({ id: "run-1", status: "running" })], onChanged: () => {} })); });
    await flush();
    await clickButton("Review changes");
    const merge = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === "Merge reviewed head");
    expect(merge?.hasAttribute("disabled")).toBe(true);
    expect(mocks.mergeRunWorktree).not.toHaveBeenCalled();
  });
});
