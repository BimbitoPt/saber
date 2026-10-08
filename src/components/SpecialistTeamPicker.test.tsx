// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listRoles: vi.fn(),
  listProviders: vi.fn(),
  getProjectProfile: vi.fn(),
  planTeam: vi.fn(),
  launchTeam: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  listRoles: (...args: unknown[]) => mocks.listRoles(...args),
  listProviders: (...args: unknown[]) => mocks.listProviders(...args),
  getProjectProfile: (...args: unknown[]) => mocks.getProjectProfile(...args),
  planTeam: (...args: unknown[]) => mocks.planTeam(...args),
  launchTeam: (...args: unknown[]) => mocks.launchTeam(...args),
}));

import { SpecialistTeamPicker } from "./SpecialistTeamPicker";

const roles = [
  { id: "implementer", projectRoot: "/projects/demo", displayName: "Implementer", instructions: "Build.", write: true, providers: ["opencode"], enabled: true, createdAt: 1, updatedAt: 1 },
  { id: "reviewer", projectRoot: "/projects/demo", displayName: "Reviewer", instructions: "Review.", write: false, providers: ["claude"], enabled: true, createdAt: 1, updatedAt: 1 },
];

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

describe("SpecialistTeamPicker", () => {
  beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    mocks.listRoles.mockResolvedValue(roles);
    mocks.listProviders.mockResolvedValue([
      { id: "opencode", installed: true, auth: "unknown", message: "Ok." },
      { id: "claude", installed: true, auth: "unknown", message: "Ok." },
    ]);
    mocks.getProjectProfile.mockResolvedValue({ project: { root: "/projects/demo" }, revisions: [], activeRevision: { id: "rev-1" }, stale: false, changed: [] });
    mocks.planTeam.mockResolvedValue({ taskId: "task-1", source: "/projects/demo", members: [{ role: roles[0], provider: "opencode", readOnly: false }] });
    mocks.launchTeam.mockResolvedValue({ id: "team-1", taskId: "task-1", members: [], createdAt: 1 });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => { root.render(createElement(SpecialistTeamPicker, { taskId: "task-1", projectRoot: "/projects/demo", defaultProvider: "opencode", onLaunched: () => {} })); });
    await flush();
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it("stays collapsed without launching and requires plan review before launch", async () => {
    expect(mocks.launchTeam).not.toHaveBeenCalled();
    expect(mocks.planTeam).not.toHaveBeenCalled();
    await clickButton("Start specialist team");
    expect(document.body.textContent).toContain("explicit launch only");
    expect(mocks.launchTeam).not.toHaveBeenCalled();
    await clickButton("Review plan");
    expect(mocks.planTeam).toHaveBeenCalledWith("task-1", [{ role: "implementer", provider: "opencode" }]);
    expect(mocks.launchTeam).not.toHaveBeenCalled();
    await clickButton("Launch 1 members");
    expect(mocks.launchTeam).toHaveBeenCalledWith("task-1", [{ role: "implementer", provider: "opencode" }]);
  });

  it("surfaces plan validation errors without launching", async () => {
    await clickButton("Start specialist team");
    mocks.planTeam.mockRejectedValueOnce(new Error("Teams that edit files must include the implementer role"));
    await clickButton("Review plan");
    expect(document.body.textContent).toContain("must include the implementer role");
    expect(mocks.launchTeam).not.toHaveBeenCalled();
  });
});
