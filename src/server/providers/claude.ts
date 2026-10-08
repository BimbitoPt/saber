import type { AgentProvider, SpawnOptions } from "./types";
import { spawnNative } from "./executables";

export const CLAUDE_READONLY_ARGS = ["--permission-mode", "plan", "--disallowedTools", "Edit Write NotebookEdit"];

export function claudeArgs(opts: SpawnOptions): string[] {
  const args = ["--print", "--verbose", "--output-format", "stream-json"];
  if (opts.readOnly) args.push(...CLAUDE_READONLY_ARGS);
  if (opts.session) args.push("--resume", opts.session);
  if (opts.model) args.push("--model", opts.model);
  args.push("--", opts.task);
  return args;
}

export function claudeProvider(): AgentProvider {
  return { name: "claude", contextBudget: { maxPromptChars: 200_000, supportsProfileContext: true }, readOnly: { supported: true, args: CLAUDE_READONLY_ARGS }, args: claudeArgs, spawn: (opts) => spawnNative("claude", claudeArgs(opts), opts) };
}
