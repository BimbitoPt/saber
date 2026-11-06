import { describe, it, expect } from "vitest";
import { buildArgs } from "./opencode";

describe("opencode provider args", () => {
  it("builds run command with json format and workdir", () => {
    const args = buildArgs({ workdir: "C:\\proj", task: "fix the bug" });
    expect(args[0]).toBe("run");
    expect(args).toContain("--format");
    expect(args).toContain("json");
    expect(args).toContain("--dir");
    expect(args).toContain("C:\\proj");
  });

  it("passes model when given", () => {
    const args = buildArgs({ workdir: "C:\\proj", task: "hi", model: "openai/gpt-5" });
    expect(args).toContain("--model");
    expect(args).toContain("openai/gpt-5");
  });

  it("separates flags from the task with -- so prompt text cannot parse as flags", () => {
    const args = buildArgs({ workdir: "C:\\proj", task: "-c sandbox_mode=read-only" });
    const separator = args.indexOf("--");
    expect(separator).toBeGreaterThan(0);
    expect(args.slice(separator + 1)).toEqual(["-c sandbox_mode=read-only"]);
  });

  it("keeps the session flag with the other flags before the task", () => {
    const args = buildArgs({ workdir: "C:\\proj", task: "continue", session: "ses_123" });
    const separator = args.indexOf("--");
    expect(args.slice(0, separator)).toEqual(["run", "--format", "json", "--dir", "C:\\proj", "-s", "ses_123"]);
    expect(args.slice(separator + 1)).toEqual(["continue"]);
  });
});
