import type { RunRecord } from "../lib/tasks";

export const DEFAULT_MAX_ACTIVE_RUNS = 2;
export const MAX_ACTIVE_RUNS_CEILING = 16;

/**
 * Global cap on concurrently live provider processes. Excess eligible runs are
 * persisted as queued instead of spawned. The safe default is deliberately low:
 * each run is a full agent CLI process with its own context and file access.
 */
export function maxActiveRuns(env: { SABER_MAX_ACTIVE_RUNS?: string } = process.env): number {
  const raw = env.SABER_MAX_ACTIVE_RUNS?.trim();
  if (!raw) return DEFAULT_MAX_ACTIVE_RUNS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_ACTIVE_RUNS_CEILING) {
    throw new Error(`SABER_MAX_ACTIVE_RUNS must be an integer between 1 and ${MAX_ACTIVE_RUNS_CEILING}, got "${raw}"`);
  }
  return parsed;
}

/**
 * Annotate queued runs with their 1-based FIFO position (oldest enqueue first).
 * listRuns returns newest first, so the FIFO head is the last queued entry.
 */
export function annotateQueuePositions(runs: RunRecord[]): RunRecord[] {
  const queued = runs.filter((run) => run.status === "queued");
  if (queued.length === 0) return runs;
  const positions = new Map<string, number>();
  queued.forEach((run, index) => positions.set(run.id, queued.length - index));
  return runs.map((run) => {
    const queuePosition = positions.get(run.id);
    return queuePosition ? { ...run, queuePosition } : run;
  });
}
