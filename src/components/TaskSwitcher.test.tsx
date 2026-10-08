// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { TaskSwitcher } from "./TaskSwitcher";
import type { TaskSummary } from "../lib/tasks";

function makeTask(overrides: Partial<TaskSummary> & { id: string }): TaskSummary {
  return {
    project: "/projects/" + overrides.id,
    title: "Title " + overrides.id,
    spec: "Spec " + overrides.id,
    criteria: "AC-01: " + overrides.id,
    revision: 1,
    context: "",
    draft: "",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

const longCheckpoint = Array.from({ length: 200 }, (_, index) => `checkpoint line ${index}`).join("\n");
const longDraft = Array.from({ length: 200 }, (_, index) => `next-action line ${index}`).join("\n");

const tasks: TaskSummary[] = [
  makeTask({ id: "task-a", title: "Task A", context: "Checkpoint A", draft: "Draft A" }),
  makeTask({ id: "task-b", title: "Task B" }),
  makeTask({ id: "task-c", title: "Task C", context: longCheckpoint, draft: longDraft }),
];

let root: Root;
let host: HTMLDivElement;
let onSelect: Mock<(id: string) => void>;
let onClose: Mock<(restoreFocus: boolean) => void>;

function previewText() {
  return document.querySelector('aside[aria-label="Saved task context"]')?.textContent ?? "";
}

function options() {
  return [...document.querySelectorAll('[role="option"]')] as HTMLElement[];
}

function searchInput() {
  const input = document.querySelector('input[aria-label="Search tasks"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("Search input is missing");
  return input;
}

function dialog() {
  const section = document.querySelector('section[role="dialog"]');
  if (!(section instanceof HTMLElement)) throw new Error("Switcher dialog is missing");
  return section;
}

async function renderSwitcher() {
  await act(async () => { root.render(createElement(TaskSwitcher, { tasks, recentIds: [], selectedId: null, onSelect, onClose })); });
}

async function pressKey(target: HTMLElement, key: string) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

async function typeQuery(value: string) {
  const input = searchInput();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("TaskSwitcher context preview", () => {
  beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    onSelect = vi.fn();
    onClose = vi.fn();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await renderSwitcher();
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it("focuses search on open and previews the first result", () => {
    expect(document.activeElement).toBe(searchInput());
    expect(previewText()).toContain("Checkpoint A");
    expect(previewText()).toContain("Draft A");
    expect(options()[0].getAttribute("aria-selected")).toBe("true");
  });

  it("moves the preview with arrow keys", async () => {
    await pressKey(searchInput(), "ArrowDown");
    expect(previewText()).toContain("No checkpoint saved.");
    expect(previewText()).toContain("No next action saved.");
    expect(options()[1].getAttribute("aria-selected")).toBe("true");
    await pressKey(searchInput(), "ArrowDown");
    expect(previewText()).toContain("checkpoint line 0");
    await pressKey(searchInput(), "ArrowUp");
    expect(previewText()).toContain("No checkpoint saved.");
  });

  it("moves the preview on pointer hover", async () => {
    await act(async () => {
      options()[2].dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(previewText()).toContain("checkpoint line 0");
    expect(previewText()).toContain("next-action line 0");
    expect(options()[2].getAttribute("aria-selected")).toBe("true");
  });

  it("keeps long checkpoint and draft text in bounded scroll regions", async () => {
    await pressKey(searchInput(), "ArrowDown");
    await pressKey(searchInput(), "ArrowDown");
    const paragraphs = [...document.querySelectorAll('aside[aria-label="Saved task context"] p')];
    expect(paragraphs).toHaveLength(2);
    for (const paragraph of paragraphs) {
      expect(paragraph.className).toContain("max-h-32");
      expect(paragraph.className).toContain("overflow-auto");
    }
    expect(paragraphs[0].textContent).toContain("checkpoint line 199");
    expect(paragraphs[1].textContent).toContain("next-action line 199");
  });

  it("follows search-result changes with the preview", async () => {
    await typeQuery("Task C");
    expect(options()).toHaveLength(1);
    expect(previewText()).toContain("checkpoint line 0");
  });

  it("selects the highlighted task on Enter and the clicked task on pointer selection", async () => {
    await pressKey(searchInput(), "ArrowDown");
    await pressKey(dialog(), "Enter");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("task-b");
    expect(onClose).toHaveBeenCalledWith(false);

    onSelect.mockClear();
    onClose.mockClear();
    await act(async () => { options()[2].click(); });
    expect(onSelect).toHaveBeenCalledWith("task-c");
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it("dismisses without selecting on Escape", async () => {
    await pressKey(searchInput(), "ArrowDown");
    await pressKey(dialog(), "Escape");
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledWith(true);
  });
});
