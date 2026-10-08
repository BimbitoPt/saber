import type { AgentProvider, SpawnOptions } from "./types";
import { spawnNative } from "./executables";

export function codexArgs(opts: SpawnOptions): string[] {
  const args = ["exec", "-c", 'sandbox_mode="workspace-write"', "-c", 'approval_policy="never"'];
  if (opts.session) args.push("resume");
  args.push("--json", "--skip-git-repo-check");
  if (opts.model) args.push("--model", opts.model);
  args.push("--");
  if (opts.session) args.push(opts.session);
  args.push(opts.task);
  return args;
}

export function codexProvider(): AgentProvider {
  return { name: "codex", contextBudget: { maxPromptChars: 200_000, supportsProfileContext: true }, readOnly: { supported: false, reason: "Codex read-only flags are unverified because the CLI is not installed; re-verify before enabling." }, args: codexArgs, spawn: (opts) => spawnNative("codex", codexArgs(opts), opts) };
}
