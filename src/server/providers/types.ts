import type { ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

export interface SpawnOptions {
  workdir: string;
  task: string;
  model?: string;
  /** opencode session id to continue (follow-ups). */
  session?: string;
}

export interface AgentProvider {
  name: string;
  args(opts: SpawnOptions): string[];
  spawn(opts: SpawnOptions): ChildProcessByStdio<null, Readable, Readable>;
}
