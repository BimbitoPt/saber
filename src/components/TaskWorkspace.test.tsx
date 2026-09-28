// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mounts: {} as Record<string, number>,
  unmounts: {} as Record<string, number>,
  starts: {} as Record<string, number>,
  listProjects: vi.fn(),
  listTasks: vi.fn(),
  reconcileSessions: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  createTask: vi.fn(),
  listProjects: () => mocks.listProjects(),
  listTasks: () => mocks.listTasks(),
  reconcileTerminalSessions: (...args: unknown[]) => mocks.reconcileSessions(...args),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string) => command === "terminal_list" ? [] : undefined),
}));

vi.mock("./TerminalSurface", async () => {
  const React = await import("react");
  return {
    TerminalSurface: ({ task, active, session, startOnOpen, onSessionChange }: {
      task: { id: string; project: string };
      active: boolean;
      session?: { id: string; status: string };
      startOnOpen: boolean;
      onSessionChange: (session: { id: string; taskId: string; workdir: string; status: "running"; createdAt: number; startedAt: number }) => void;
    }) => {
      React.useEffect(() => {
        mocks.mounts[task.id] = (mocks.mounts[task.id] ?? 0) + 1;
        if (startOnOpen && session?.status !== "running") {
          mocks.starts[task.id] = (mocks.starts[task.id] ?? 0) + 1;
          onSessionChange({ id: "session-" + task.id, taskId: task.id, workdir: task.project, status: "running", createdAt: 1, startedAt: 2 });
        }
        return () => { mocks.unmounts[task.id] = (mocks.unmounts[task.id] ?? 0) + 1; };
      }, [task.id]);
      return React.createElement("div", {
        "data-testid": "terminal-" + task.id,
        "data-active": String(active),
      }, "SABER-" + task.id + "-MARKER");
    },
  };
});

import { TaskWorkspace } from "./TaskWorkspace";

const tasks = [
  { id: "task-a", project: "/home/bimbito/project-a", title: "Task A", spec: "A", criteria: "AC-01: A", revision: 1, context: "", draft: "", createdAt: 1, updatedAt: 1 },
  { id: "task-b", project: "/home/bimbito/project-b", title: "Task B", spec: "B", criteria: "AC-01: B", revision: 1, context: "", draft: "", createdAt: 2, updatedAt: 2 },
];

let root: Root;
let host: HTMLDivElement;

async function clickButton(label: string) {
  const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label);
  if (!button) throw new Error("Could not find button: " + label);
  await act(async () => { button.click(); });
}

async function flushEffects() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

describe("TaskWorkspace terminal view lifecycle", () => {
  beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.mounts = {};
    mocks.unmounts = {};
    mocks.starts = {};
    mocks.listProjects.mockResolvedValue(tasks.map((task) => ({ path: task.project, name: task.title })));
    mocks.listTasks.mockResolvedValue(tasks);
    mocks.reconcileSessions.mockResolvedValue([]);
    localStorage.setItem("saber.selectedTask", "task-a");
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => { root.render(createElement(TaskWorkspace)); });
    await flushEffects();
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    for (const [taskId, mountCount] of Object.entries(mocks.mounts)) {
      expect(mocks.unmounts[taskId]).toBe(mountCount);
    }
    host.remove();
    localStorage.clear();
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it("keeps task A's live terminal across Board/List selection and defers B until Terminal opens", async () => {
    await clickButton("Start terminal");
    expect(mocks.mounts["task-a"]).toBe(1);
    expect(mocks.starts["task-a"]).toBe(1);

    await clickButton("Board");
    expect(mocks.unmounts["task-a"] ?? 0).toBe(0);

    const taskBCard = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes("Task B"));
    expect(taskBCard).toBeDefined();
    await act(async () => { taskBCard?.click(); });
    expect(mocks.unmounts["task-a"] ?? 0).toBe(0);
    expect(mocks.mounts["task-b"] ?? 0).toBe(0);

    await clickButton("Terminal");
    expect(mocks.mounts["task-a"]).toBe(1);
    expect(mocks.mounts["task-b"]).toBe(1);
    expect(mocks.starts["task-b"]).toBe(1);
    expect(document.querySelector('[data-testid="terminal-task-b"]')?.getAttribute("data-active")).toBe("true");

    await clickButton("Board");
    const taskACard = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes("Task A"));
    expect(taskACard).toBeDefined();
    await act(async () => { taskACard?.click(); });
    await clickButton("Terminal");

    const taskAMarker = document.querySelector('[data-testid="terminal-task-a"]');
    expect(taskAMarker?.textContent).toBe("SABER-task-a-MARKER");
    expect(taskAMarker?.getAttribute("data-active")).toBe("true");
    expect(mocks.mounts["task-a"]).toBe(1);
    expect(mocks.unmounts["task-a"] ?? 0).toBe(0);
    expect(mocks.starts["task-a"]).toBe(1);
    expect(mocks.starts["task-b"]).toBe(1);
  });
});
