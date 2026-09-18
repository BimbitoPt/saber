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
    expect(args.at(1)).toBe("fix the bug");
  });

  it("passes model when given", () => {
    const args = buildArgs({ workdir: "C:\\proj", task: "hi", model: "openai/gpt-5" });
    expect(args).toContain("--model");
    expect(args).toContain("openai/gpt-5");
  });
});
