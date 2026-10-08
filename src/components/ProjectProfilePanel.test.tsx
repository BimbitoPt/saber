// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  state: null as null | {
    project: { root: string; displayName: string; createdAt: number; activeRevisionId?: string } | null;
    revisions: Array<{ id: string; projectRoot: string; entries: Array<{ key: string; origin: "repository" | "user"; sourcePath?: string; author?: string; content: string }>; sourceHashes: Record<string, string>; state: "draft" | "approved"; createdAt: number; updatedAt: number }>;
    activeRevision: { id: string; projectRoot: string; entries: Array<{ key: string; origin: "repository" | "user"; sourcePath?: string; author?: string; content: string }>; sourceHashes: Record<string, string>; state: "draft" | "approved"; createdAt: number; updatedAt: number } | null;
    stale: boolean;
    changed: string[];
  },
  getProjectProfile: vi.fn(),
  registerProjectRecord: vi.fn(),
  refreshProjectProfile: vi.fn(),
  editProfileDraft: vi.fn(),
  approveProfileRevision: vi.fn(),
  discardProfileRevision: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  getProjectProfile: (...args: unknown[]) => mocks.getProjectProfile(...args),
  registerProjectRecord: (...args: unknown[]) => mocks.registerProjectRecord(...args),
  refreshProjectProfile: (...args: unknown[]) => mocks.refreshProjectProfile(...args),
  editProfileDraft: (...args: unknown[]) => mocks.editProfileDraft(...args),
  approveProfileRevision: (...args: unknown[]) => mocks.approveProfileRevision(...args),
  discardProfileRevision: (...args: unknown[]) => mocks.discardProfileRevision(...args),
}));

import { ProjectProfilePanel } from "./ProjectProfilePanel";

const approvedRevision = {
  id: "rev-approved", projectRoot: "/projects/demo",
  entries: [
    { key: "AGENTS.md", origin: "repository" as const, sourcePath: "AGENTS.md", content: "Stack: Bun." },
    { key: "team-rule", origin: "user" as const, author: "You", content: "Verify in the app." },
  ],
  sourceHashes: { "AGENTS.md": "abc" }, state: "approved" as const, createdAt: 1, updatedAt: 2,
};
const draftRevision = {
  id: "rev-draft", projectRoot: "/projects/demo",
  entries: [{ key: "AGENTS.md", origin: "repository" as const, sourcePath: "AGENTS.md", content: "Stack: Bun. Updated." }],
  sourceHashes: {}, state: "draft" as const, createdAt: 3, updatedAt: 4,
};

function fullState() {
  return {
    project: { root: "/projects/demo", displayName: "demo", createdAt: 1, activeRevisionId: "rev-approved" },
    revisions: [approvedRevision, draftRevision],
    activeRevision: approvedRevision,
    stale: false,
    changed: [] as string[],
  };
}

let root: Root;
let host: HTMLDivElement;

async function renderPanel() {
  await act(async () => { root.render(createElement(ProjectProfilePanel, { projectRoot: "/projects/demo" })); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

async function clickButton(label: string) {
  const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label);
  if (!button) throw new Error("Could not find button: " + label);
  await act(async () => { button.click(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

describe("ProjectProfilePanel", () => {
  beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    mocks.getProjectProfile.mockResolvedValue(fullState());
    mocks.registerProjectRecord.mockResolvedValue({ root: "/projects/demo", displayName: "demo", createdAt: 1 });
    mocks.editProfileDraft.mockImplementation(async (_id: string, entries: unknown) => ({ ...draftRevision, entries }));
    mocks.approveProfileRevision.mockResolvedValue({ ...draftRevision, state: "approved" });
    mocks.discardProfileRevision.mockResolvedValue({ ok: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it("offers registration when the project has no profile", async () => {
    mocks.getProjectProfile.mockResolvedValue({ project: null, revisions: [], activeRevision: null, stale: false, changed: [] });
    await renderPanel();
    expect(document.body.textContent).toContain("no profile yet");
    await clickButton("Register project");
    expect(mocks.registerProjectRecord).toHaveBeenCalledWith("/projects/demo");
  });

  it("labels each entry with its origin and source", async () => {
    await renderPanel();
    const text = document.body.textContent ?? "";
    expect(text).toContain("Repository · AGENTS.md");
    expect(text).toContain("Yours · You");
    expect(text).toContain("Stack: Bun.");
  });

  it("surfaces the stale flag with changed sources", async () => {
    mocks.getProjectProfile.mockResolvedValue({ ...fullState(), stale: true, changed: ["AGENTS.md"] });
    await renderPanel();
    expect(document.body.textContent).toContain("Sources changed since approval: AGENTS.md");
  });

  it("approves and discards the draft under review", async () => {
    await renderPanel();
    await clickButton("Approve");
    expect(mocks.approveProfileRevision).toHaveBeenCalledWith("rev-draft");
    await clickButton("Discard");
    expect(mocks.discardProfileRevision).toHaveBeenCalledWith("rev-draft");
  });

  it("saves edited draft content", async () => {
    await renderPanel();
    const area = document.querySelector('textarea[aria-label="Draft content for AGENTS.md"]');
    if (!(area instanceof HTMLTextAreaElement)) throw new Error("Draft textarea is missing");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(area, "Stack: Bun. Edited in review.");
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await clickButton("Save edits");
    expect(mocks.editProfileDraft).toHaveBeenCalledWith("rev-draft", [
      { key: "AGENTS.md", origin: "repository", sourcePath: "AGENTS.md", content: "Stack: Bun. Edited in review." },
    ]);
  });
});
