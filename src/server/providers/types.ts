import type { ChildProcessWithoutNullStreams } from "node:child_process";

export interface SpawnOptions {
  workdir: string;
  task: string;
  model?: string;
}

export interface AgentProvider {
  name: string;
  args(opts: SpawnOptions): string[];
  spawn(opts: SpawnOptions): ChildProcessWithoutNullStreams;
}
