// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  previewTaskScope: vi.fn(),
  listProviders: vi.fn(),
  listTaskRuns: vi.fn(),
  saveTask: vi.fn(),
  launchTask: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  acknowledgeRun: vi.fn(),
  launchTask: (...args: unknown[]) => mocks.launchTask(...args),
  listTaskRuns: (...args: unknown[]) => mocks.listTaskRuns(...args),
  previewTaskScope: (...args: unknown[]) => mocks.previewTaskScope(...args),
  saveTask: (...args: unknown[]) => mocks.saveTask(...args),
  stopSession: vi.fn(),
  listProviders: (...args: unknown[]) => mocks.listProviders(...args),
}));

vi.mock("./SessionPane", () => ({ SessionPane: () => null }));
vi.mock("./WorkspacePanel", () => ({ WorkspacePanel: () => null }));
vi.mock("./VerificationPanel", () => ({ VerificationPanel: () => null }));
vi.mock("./ProjectProfilePanel", () => ({ ProjectProfilePanel: () => null }));

import { TaskDetail } from "./TaskDetail";

const task = {
  id: "task-1", project: "/projects/demo", title: "Demo", spec: "Do work", criteria: "AC-01: done",
  revision: 1, context: "checkpoint", draft: "", createdAt: 1, updatedAt: 1,
};

let root: Root;
let host: HTMLDivElement;

async function flush() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

async function renderDetail() {
  await act(async () => { root.render(createElement(TaskDetail, { task, onSaved: () => {} })); });
  await flush();
}

function findButton(label: string) {
  return [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label);
}

async function clickButton(label: string) {
  const button = findButton(label);
  if (!button) throw new Error("Could not find button: " + label);
  await act(async () => { button.click(); });
  await flush();
}

async function togglePreview(open: boolean) {
  const target = [...document.querySelectorAll("details")].find((candidate) => candidate.textContent?.includes("Outgoing context"));
  if (!(target instanceof HTMLDetailsElement)) throw new Error("Preview section is missing");
  await act(async () => {
    target.open = open;
    target.dispatchEvent(new Event("toggle", { bubbles: true }));
  });
  await flush();
}


describe("TaskDetail outgoing context preview", () => {
  beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    localStorage.clear();
    mocks.listTaskRuns.mockResolvedValue([]);
    mocks.saveTask.mockImplementation(async (_id: string, form: unknown) => ({ ...task, ...(form as object) }));
    mocks.launchTask.mockResolvedValue({ id: "run-1" });
    mocks.listProviders.mockResolvedValue([{
      id: "opencode", installed: true, auth: "unknown", message: "Installed.",
      contextBudget: { maxPromptChars: 200_000, supportsProfileContext: true },
    }]);
    mocks.previewTaskScope.mockResolvedValue({
      provider: "opencode",
      sources: [
        { name: "task title and specification", chars: 120 },
        { name: "project profile revision abc123", chars: 340 },
      ],
      totalChars: 460, budget: 200_000, verdict: "ok",
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    localStorage.clear();
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it("expands with sources and budget verdict on demand", async () => {
    await renderDetail();
    expect(mocks.previewTaskScope).not.toHaveBeenCalled();
    await togglePreview(true);
    expect(mocks.previewTaskScope).toHaveBeenCalledWith("task-1", "opencode");
    const text = document.body.textContent ?? "";
    expect(text).toContain("Outgoing context");
    expect(text).toContain("project profile revision abc123");
    expect(text).toContain("Ready to launch");
  });

  it("blocks with the named source when the payload is oversized", async () => {
    mocks.previewTaskScope.mockResolvedValue({
      provider: "opencode",
      sources: [{ name: "saved context", chars: 250_000 }],
      totalChars: 250_000, budget: 200_000, verdict: "oversized",
      notice: "Prompt exceeds the budget; largest source: saved context (250000 chars).",
    });
    await renderDetail();
    await togglePreview(true);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Blocked");
    expect(text).toContain("saved context");
  });

  it("shows the no-profile notice without blocking launch", async () => {
    mocks.previewTaskScope.mockResolvedValue({
      provider: "opencode",
      sources: [{ name: "task title and specification", chars: 120 }],
      totalChars: 120, budget: 200_000, verdict: "no-profile",
      notice: "No approved project profile; the run would launch without profile context.",
    });
    await renderDetail();
    await togglePreview(true);
    expect(document.body.textContent).toContain("No approved project profile");
    expect(findButton("Run specification")).toBeTruthy();
  });

  it("launches only on explicit action, never by expanding the preview", async () => {
    await renderDetail();
    await togglePreview(true);
    expect(mocks.previewTaskScope).toHaveBeenCalled();
    expect(mocks.launchTask).not.toHaveBeenCalled();
    await clickButton("Run specification");
    expect(mocks.launchTask).toHaveBeenCalledWith("task-1", { model: undefined, followup: undefined, provider: "opencode" });
  });

  it("shows provider capability state next to the picker", async () => {
    mocks.listProviders.mockResolvedValue([{
      id: "opencode", installed: true, auth: "unknown", message: "Installed.",
      contextBudget: { maxPromptChars: 200_000, supportsProfileContext: false },
    }]);
    await renderDetail();
    expect(document.body.textContent).toContain("No profile context");
  });

  it("sends the rendered revision so a stale form cannot overwrite newer state", async () => {
    await renderDetail();
    const titleInput = [...document.querySelectorAll("input")].find((element) => element.value === "Demo");
    if (!(titleInput instanceof HTMLInputElement)) throw new Error("Title input is missing");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(titleInput, "Renamed");
      titleInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
    await clickButton("Save changes");
    expect(mocks.saveTask).toHaveBeenCalledWith("task-1", expect.objectContaining({
      title: "Renamed", expectedRevision: 1, expectedUpdatedAt: 1,
    }));
  });

  it("surfaces a stale-form rejection instead of silently overwriting", async () => {
    mocks.saveTask.mockRejectedValueOnce(new Error("This task changed after the form was loaded (server revision 2, form revision 1). Reload and reapply your changes."));
    await renderDetail();
    const titleInput = [...document.querySelectorAll("input")].find((element) => element.value === "Demo");
    if (!(titleInput instanceof HTMLInputElement)) throw new Error("Title input is missing");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(titleInput, "Renamed");
      titleInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
    await clickButton("Save changes");
    expect(document.body.textContent).toContain("changed after the form was loaded");
  });

  it("flags the conflict and keeps the local draft when the server advances", async () => {
    localStorage.setItem("saber.task.task-1", JSON.stringify({
      fields: { title: "Local edit", spec: "Do work", criteria: "AC-01: done", context: "checkpoint", draft: "" },
      baseRevision: 1, baseUpdatedAt: 1,
    }));
    await renderDetail();
    const recovered = [...document.querySelectorAll("input")].find((element) => element.value === "Local edit");
    if (!(recovered instanceof HTMLInputElement)) throw new Error("Recovered draft was not applied");
    await act(async () => { root.render(createElement(TaskDetail, { task: { ...task, revision: 2, updatedAt: 99 }, onSaved: () => {} })); });
    await flush();
    expect(document.body.textContent).toContain("This task changed on the server");
    expect(localStorage.getItem("saber.task.task-1")).not.toBeNull();
  });
});
