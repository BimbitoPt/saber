export interface PercentileSummary {
  count: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
}

export interface SequenceIntegrity {
  expected: number;
  received: number;
  dropped: number[];
  duplicates: number[];
  outOfOrder: number[];
}

export function summarizeSamples(samples: number[]): PercentileSummary {
  if (samples.length === 0) return { count: 0, p50: null, p95: null, p99: null, max: null };
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (p: number) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
  return { count: sorted.length, p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), max: sorted.at(-1)! };
}

export function checkSequenceIntegrity(sequenceIds: number[], expectedCount: number): SequenceIntegrity {
  const seen = new Set<number>();
  const duplicates: number[] = [];
  const outOfOrder: number[] = [];
  let previous = 0;
  for (const id of sequenceIds) {
    if (seen.has(id)) duplicates.push(id);
    if (id <= previous && !seen.has(id)) outOfOrder.push(id);
    seen.add(id);
    previous = id;
  }
  const dropped: number[] = [];
  for (let id = 1; id <= expectedCount; id++) if (!seen.has(id)) dropped.push(id);
  return { expected: expectedCount, received: sequenceIds.length, dropped, duplicates, outOfOrder };
}

export function meetsP95Budget(summary: PercentileSummary, budgetMs: number): boolean {
  return summary.p95 !== null && summary.p95 <= budgetMs;
}

export function memoryTrend(samples: Array<{ elapsedMs: number; workingSetBytes: number }>) {
  if (samples.length < 3) return { classification: "insufficient-samples" as const, startBytes: samples[0]?.workingSetBytes ?? null, endBytes: samples.at(-1)?.workingSetBytes ?? null, slopeBytesPerMinute: null };
  const first = samples[0]!;
  const last = samples.at(-1)!;
  const elapsedMinutes = (last.elapsedMs - first.elapsedMs) / 60_000;
  const slopeBytesPerMinute = elapsedMinutes > 0 ? (last.workingSetBytes - first.workingSetBytes) / elapsedMinutes : 0;
  const lateStart = samples[Math.floor(samples.length / 2)]!;
  const lateMinutes = (last.elapsedMs - lateStart.elapsedMs) / 60_000;
  const lateWindowChangePercent = lateStart.workingSetBytes > 0 ? ((last.workingSetBytes - lateStart.workingSetBytes) / lateStart.workingSetBytes) * 100 : Infinity;
  const lateWindowSlopeBytesPerMinute = lateMinutes > 0 ? (last.workingSetBytes - lateStart.workingSetBytes) / lateMinutes : 0;
  return {
    classification: Math.abs(lateWindowChangePercent) <= 10 ? "plateau" as const : "growth" as const,
    startBytes: first.workingSetBytes,
    endBytes: last.workingSetBytes,
    slopeBytesPerMinute,
    lateWindowStartBytes: lateStart.workingSetBytes,
    lateWindowChangePercent,
    lateWindowSlopeBytesPerMinute,
  };
}
