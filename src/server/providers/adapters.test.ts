import { describe, expect, it } from "vitest";
import { codexArgs, codexProvider } from "./codex";
import { claudeArgs, claudeProvider } from "./claude";
import { opencodeProvider } from "./opencode";
import { parseProviderEvent } from "./events";
import { providerStatus } from "./executables";

describe("provider argv", () => {
  it("reports a missing executable without attempting authentication", async () => {
    expect(await providerStatus("claude", () => undefined)).toMatchObject({ installed: false, auth: "unknown" });
  });
  it("keeps Codex prompts literal and configures bounded write access", () => {
    const args = codexArgs({ workdir: "C:/project", task: "--arbitrary prompt", model: "chosen-model" });
    expect(args.slice(0, 5)).toEqual(["exec", "-c", 'sandbox_mode="workspace-write"', "-c", 'approval_policy="never"']);
    expect(args.slice(-2)).toEqual(["--", "--arbitrary prompt"]);
    expect(args).toContain("--json");
    expect(args).toContain("chosen-model");
    expect(args.join(" ")).not.toContain("dangerously");
  });
  it("resumes an explicit Codex identity without selecting the last global session", () => {
    const args = codexArgs({ workdir: "C:/project", task: "follow up", session: "native-id" });
    expect(args).toContain("resume");
    expect(args.slice(-3)).toEqual(["--", "native-id", "follow up"]);
    expect(args).not.toContain("--last");
  });
  it("uses Claude JSON streaming and explicit continuation", () => {
    const args = claudeArgs({ workdir: "C:/project", task: "hello", session: "native-id", model: "chosen-model" });
    expect(args).toEqual(["--print", "--verbose", "--output-format", "stream-json", "--resume", "native-id", "--model", "chosen-model", "--", "hello"]);
    expect(args.join(" ")).not.toContain("skip-permissions");
  });
});

describe("provider read-only declarations", () => {
  it("reports opencode read-only unavailable: its CLI exposes no sandbox flags", () => {
    expect(opencodeProvider().readOnly).toEqual({ supported: false, reason: expect.stringContaining("no read-only") });
  });
  it("declares claude read-only through plan mode with writing tools denied", () => {
    expect(claudeProvider().readOnly).toEqual({ supported: true, args: ["--permission-mode", "plan", "--disallowedTools", "Edit Write NotebookEdit"] });
    expect(claudeArgs({ workdir: "C:/project", task: "review", readOnly: true }).slice(0, 8)).toEqual(["--print", "--verbose", "--output-format", "stream-json", "--permission-mode", "plan", "--disallowedTools", "Edit Write NotebookEdit"]);
    expect(claudeArgs({ workdir: "C:/project", task: "review" })).not.toContain("--permission-mode");
  });
  it("reports codex read-only unavailable until its CLI interface is verified", () => {
    expect(codexProvider().readOnly).toEqual({ supported: false, reason: expect.stringContaining("unverified") });
  });
});

describe("provider event normalization", () => {
  it("captures Codex identity, output, tool activity, and terminal failure", () => {
    expect(parseProviderEvent("codex", '{"type":"thread.started","thread_id":"thread-1"}').nativeSessionId).toBe("thread-1");
    expect(parseProviderEvent("codex", '{"type":"item.completed","item":{"type":"agent_message","text":"done"}}').items).toEqual([{ kind: "agent_message", text: "done" }]);
    expect(parseProviderEvent("codex", '{"type":"item.started","item":{"type":"command_execution","command":"bun run test"}}').items[0]).toMatchObject({ kind: "tool", detail: "bun run test" });
    expect(parseProviderEvent("codex", '{"type":"turn.failed","error":{"message":"rate limit"}}')).toMatchObject({ failed: true, items: [{ text: "rate limit" }] });
  });
  it("extracts every Claude message block without duplicating the result", () => {
    const event = { type: "assistant", session_id: "claude-1", message: { content: [{ type: "text", text: "one" }, { type: "tool_use", name: "Read" }, { type: "text", text: "two" }] } };
    const parsed = parseProviderEvent("claude", JSON.stringify(event));
    expect(parsed.nativeSessionId).toBe("claude-1");
    expect(parsed.items.map((item) => item.text)).toEqual(["one", "Read", "two"]);
    expect(parseProviderEvent("claude", '{"type":"result","result":"one two","is_error":false}').items).toEqual([]);
  });
  it("treats Claude errors and denied permissions as failed results", () => {
    expect(parseProviderEvent("claude", '{"type":"result","is_error":true,"result":"authentication required"}').failed).toBe(true);
    expect(parseProviderEvent("claude", '{"type":"result","is_error":false,"permission_denials":[{"tool_name":"Bash"}]}').failed).toBe(true);
  });
  it("retains OpenCode interpretation and tolerates unknown output", () => {
    expect(parseProviderEvent("opencode", '{"sessionID":"open-1","type":"text","part":{"text":"hello"}}')).toMatchObject({ nativeSessionId: "open-1", items: [{ text: "hello" }] });
    expect(parseProviderEvent("opencode", '{"type":"error","error":{"data":{"message":"failed"}}}').failed).toBe(true);
    expect(parseProviderEvent("claude", 'null').items).toEqual([]);
    expect(parseProviderEvent("codex", 'plain diagnostic').items[0].text).toBe("plain diagnostic");
  });
});
