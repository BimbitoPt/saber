import type { ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import type { ContextBudget, ReadOnlySupport } from "../../lib/tasks";

export interface SpawnOptions {
  workdir: string;
  task: string;
  model?: string;
  /** opencode session id to continue (follow-ups). */
  session?: string;
  /** read-only member invocation; honored only by adapters that declare support. */
  readOnly?: boolean;
}

export interface AgentProvider {
  name: string;
  contextBudget: ContextBudget;
  readOnly: ReadOnlySupport;
  args(opts: SpawnOptions): string[];
  spawn(opts: SpawnOptions): ChildProcessByStdio<null, Readable, Readable>;
}
