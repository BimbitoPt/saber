import { describe, expect, it } from "vitest";
import { isVisualWebTask, visualWebContext } from "./visualWeb";

describe("visual web runtime context", () => {
  it("recognizes plain-language 3D website requests", () => {
    expect(isVisualWebTask({
      title: "Build a premium 3D website for my car company",
      spec: "Make it cinematic and responsive.",
      criteria: "Mobile works.",
    })).toBe(true);
  });

  it("recognizes visual-web follow-ups on otherwise generic tasks", () => {
    expect(isVisualWebTask({
      title: "Improve the product",
      spec: "Make the current experience better.",
      criteria: "No regressions.",
    }, "Redesign the homepage and add a 3D hero")).toBe(true);
  });

  it("does not inject visual-web context into backend-only work", () => {
    expect(isVisualWebTask({
      title: "Add rate limiting to the auth API",
      spec: "Reject requests above the configured threshold.",
      criteria: "Unit tests cover the limiter.",
    })).toBe(false);
  });

  it("bundles the skill, guide, and template for arbitrary target workspaces", () => {
    const parts = visualWebContext({
      title: "Create a portfolio website",
      spec: "Build a clean portfolio.",
      criteria: "Responsive layout.",
    });
    expect(parts.map((part) => part.name)).toEqual([
      "visual-web skill",
      "visual-web agent guide",
      "visual-web task template",
    ]);
    expect(parts[0].text).toContain("# Visual Web Skill");
    expect(parts[1].text).toContain("# Visual Web Agent Harness");
    expect(parts[2].text).toContain("# Visual Web Task Template");
  });
});
