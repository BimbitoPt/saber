// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mounts: {} as Record<string, number>,
  unmounts: {} as Record<string, number>,
  starts: {} as Record<string, number>,
  invoke: vi.fn(),
  listProjects: vi.fn(),
  listTasks: vi.fn(),
  reconcileSessions: vi.fn(),
  getLaunchContext: vi.fn(),
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    listProjects: () => mocks.listProjects(),
    listTasks: () => mocks.listTasks(),
    reconcileTerminalSessions: (...args: unknown[]) => mocks.reconcileSessions(...args),
    getLaunchContext: () => mocks.getLaunchContext(),
    listProviders: vi.fn(async () => []),
    listTaskRuns: vi.fn(async () => []),
    listVerifications: vi.fn(async () => ({ records: [], summary: { passed: 0, failed: 0, stale: 0, total: 0, state: "unverified" } })),
    getProjectProfile: vi.fn(async () => null),
    listRoles: vi.fn(async () => []),
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mocks.invoke(...args),
}));

vi.mock("./TerminalSurface", async () => {
  const React = await import("react");
  return {
    TerminalSurface: ({ task, active, session, startOnOpen, onSessionChange }: {
      task: { id: string; project: string };
      active: boolean;
      session?: { id: string; status: string };
      startOnOpen: boolean;
      onSessionChange: (session: { id: string; taskId: string; workdir: string; status: "running" | "stopped"; createdAt: number; startedAt: number }) => void;
    }) => {
      React.useEffect(() => {
        mocks.mounts[task.id] = (mocks.mounts[task.id] ?? 0) + 1;
        if (startOnOpen && session?.status !== "running") {
          mocks.starts[task.id] = (mocks.starts[task.id] ?? 0) + 1;
          onSessionChange({ id: "session-" + task.id, taskId: task.id, workdir: task.project, status: "running", createdAt: 1, startedAt: 2 });
        }
        return () => { mocks.unmounts[task.id] = (mocks.unmounts[task.id] ?? 0) + 1; };
      }, [task.id]);
      return React.createElement(
        "div",
        {
          "data-testid": "terminal-" + task.id,
          "data-active": String(active),
        },
        "SABER-" + task.id + "-MARKER",
        session?.status === "running"
          ? React.createElement("button", { onClick: () => onSessionChange({ id: "session-" + task.id, taskId: task.id, workdir: task.project, status: "stopped", createdAt: 1, startedAt: 2 }) }, "STOP-SESSION")
          : null,
      );
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
    mocks.invoke.mockResolvedValue([]);
    mocks.listProjects.mockResolvedValue(tasks.map((task) => ({ path: task.project, name: task.title })));
    mocks.listTasks.mockResolvedValue(tasks);
    mocks.reconcileSessions.mockResolvedValue([]);
    mocks.getLaunchContext.mockResolvedValue({ status: "unavailable", launchDirectory: "", fallback: { reason: "Saber was launched from the OS shell without a working directory." } });
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
    expect(taskAMarker?.textContent).toContain("SABER-task-a-MARKER");
    expect(taskAMarker?.getAttribute("data-active")).toBe("true");
    expect(mocks.mounts["task-a"]).toBe(1);
    expect(mocks.unmounts["task-a"] ?? 0).toBe(0);
    expect(mocks.starts["task-a"]).toBe(1);
    expect(mocks.starts["task-b"]).toBe(1);
  });

  it("does not relaunch a stopped terminal when the view is left and revisited", async () => {
    await clickButton("Start terminal");
    expect(mocks.starts["task-a"]).toBe(1);

    await clickButton("STOP-SESSION");
    await clickButton("List");
    expect(mocks.unmounts["task-a"]).toBe(1);

    await clickButton("Terminal");
    expect(mocks.mounts["task-a"]).toBe(2);
    expect(mocks.starts["task-a"]).toBe(1);
  });
});


describe("TaskWorkspace terminal startup errors", () => {
  beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem("saber.selectedTask", "task-a");
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    mocks.invoke.mockRejectedValue(new Error("native terminal unavailable"));
    mocks.listProjects.mockResolvedValue(tasks.map((task) => ({ path: task.project, name: task.title })));
    mocks.listTasks.mockResolvedValue(tasks);
    mocks.reconcileSessions.mockResolvedValue([]);
    mocks.getLaunchContext.mockResolvedValue({ status: "unavailable", launchDirectory: "", fallback: { reason: "Saber was launched from the OS shell without a working directory." } });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => { root.render(createElement(TaskWorkspace)); });
    await flushEffects();
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    localStorage.clear();
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it("ends the loading state and keeps the startup error visible when native session discovery fails", () => {
    const content = document.body.textContent ?? "";
    expect(content).toContain("Saber could not reconcile terminal sessions: Error: native terminal unavailable");
    expect(content).not.toContain("Checking terminal sessions…");
    expect(content).toContain("No terminal is running for this task.");
  });
});

describe("TaskWorkspace repository-first launch", () => {
  beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.mounts = {};
    mocks.unmounts = {};
    mocks.starts = {};
    localStorage.clear();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    mocks.invoke.mockResolvedValue([]);
    mocks.listProjects.mockResolvedValue([{ path: "/home/bimbito/inventory-first", name: "Inventory first" }]);
    mocks.listTasks.mockResolvedValue([]);
    mocks.reconcileSessions.mockResolvedValue([]);
    mocks.getLaunchContext.mockResolvedValue({ status: "unavailable", launchDirectory: "" });
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    localStorage.clear();
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  async function renderWorkspace() {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => { root.render(createElement(TaskWorkspace)); });
    await flushEffects();
  }

  async function openTaskForm() {
    await clickButton("List");
  }

  function projectInputValue() {
    return (document.querySelector('input[list="task-projects"]') as HTMLInputElement | null)?.value;
  }

  it("prefills the new task form with the detected repository and shows the launch summary", async () => {
    mocks.getLaunchContext.mockResolvedValue({
      status: "repository",
      launchDirectory: "/repo/packages/app",
      project: { root: "/repo", displayName: "repo", createdAt: 1 },
      repository: { branch: "main", detached: false, dirty: false },
      guidance: { agentsFile: "/repo/AGENTS.md", packageManager: "bun", scripts: [] },
    });
    await renderWorkspace();
    await openTaskForm();
    expect(projectInputValue()).toBe("/repo");
    const summary = document.body.textContent ?? "";
    expect(summary).toContain("repo");
    expect(summary).toContain("main");
    expect(summary).toContain("clean tree");
    expect(summary).toContain("AGENTS.md detected");
    expect(summary).toContain("bun");
  });

  it("overrides the inventory prefill with the launched repository", async () => {
    mocks.getLaunchContext.mockResolvedValue({
      status: "repository",
      launchDirectory: "/repo",
      project: { root: "/repo", displayName: "repo", createdAt: 1 },
      repository: { branch: "main", detached: false, dirty: true },
    });
    await renderWorkspace();
    await openTaskForm();
    expect(projectInputValue()).toBe("/repo");
  });

  it("keeps a saved draft project over the launched repository", async () => {
    localStorage.setItem("saber.newTask", JSON.stringify({ project: "/home/bimbito/draft-project", title: "Draft", spec: "s", criteria: "c" }));
    mocks.getLaunchContext.mockResolvedValue({
      status: "repository",
      launchDirectory: "/repo",
      project: { root: "/repo", displayName: "repo", createdAt: 1 },
      repository: { branch: "main", detached: false, dirty: false },
    });
    await renderWorkspace();
    await openTaskForm();
    expect(projectInputValue()).toBe("/home/bimbito/draft-project");
  });

  it("explains an outside-git launch instead of guessing a project", async () => {
    mocks.getLaunchContext.mockResolvedValue({
      status: "outside-git",
      launchDirectory: "/tmp/notes",
      fallback: { reason: "The launch directory is not inside a Git repository.", lastProject: { root: "/previous", displayName: "Previous", createdAt: 1 } },
    });
    await renderWorkspace();
    await openTaskForm();
    const summary = document.body.textContent ?? "";
    expect(summary).toContain("The launch directory is not inside a Git repository.");
    expect(summary).toContain("Previous");
    expect(projectInputValue()).toBe("/home/bimbito/inventory-first");
  });
});
