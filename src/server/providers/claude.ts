import type { AgentProvider, SpawnOptions } from "./types";
import { spawnNative } from "./executables";

export function claudeArgs(opts: SpawnOptions): string[] {
  const args = ["--print", "--verbose", "--output-format", "stream-json"];
  if (opts.session) args.push("--resume", opts.session);
  if (opts.model) args.push("--model", opts.model);
  args.push("--", opts.task);
  return args;
}

export function claudeProvider(): AgentProvider {
  return { name: "claude", contextBudget: { maxPromptChars: 200_000, supportsProfileContext: true }, args: claudeArgs, spawn: (opts) => spawnNative("claude", claudeArgs(opts), opts) };
}
