import { describe, expect, it } from "vitest";
import { checkSequenceIntegrity, meetsP95Budget, memoryTrend, summarizeSamples } from "./responsiveness";

describe("responsiveness benchmark metrics", () => {
  it("summarizes nearest-rank percentiles and empty samples", () => {
    expect(summarizeSamples([9, 1, 5, 3, 7])).toEqual({ count: 5, p50: 5, p95: 9, p99: 9, max: 9 });
    expect(summarizeSamples([])).toEqual({ count: 0, p50: null, p95: null, p99: null, max: null });
  });

  it("evaluates the responsiveness budget from measured p95", () => {
    expect(meetsP95Budget(summarizeSamples([100, 200]), 200)).toBe(true);
    expect(meetsP95Budget(summarizeSamples([100, 201]), 200)).toBe(false);
    expect(meetsP95Budget(summarizeSamples([]), 200)).toBe(false);
  });

  it("reports missing, duplicate, and out-of-order event sequences independently", () => {
    expect(checkSequenceIntegrity([1, 3, 3, 2], 4)).toEqual({
      expected: 4,
      received: 4,
      dropped: [4],
      duplicates: [3],
      outOfOrder: [2],
    });
  });

  it("does not call a short memory sample set a plateau", () => {
    expect(memoryTrend([{ elapsedMs: 0, workingSetBytes: 100 }]).classification).toBe("insufficient-samples");
    expect(memoryTrend([
      { elapsedMs: 0, workingSetBytes: 1000 },
      { elapsedMs: 60_000, workingSetBytes: 1050 },
      { elapsedMs: 120_000, workingSetBytes: 1080 },
    ]).classification).toBe("plateau");
    expect(memoryTrend([
      { elapsedMs: 0, workingSetBytes: 1000 },
      { elapsedMs: 60_000, workingSetBytes: 1200 },
      { elapsedMs: 120_000, workingSetBytes: 1500 },
    ]).classification).toBe("growth");
  });

  it("distinguishes warmup growth from a later retained-memory plateau", () => {
    const trend = memoryTrend([
      { elapsedMs: 0, workingSetBytes: 1000 },
      { elapsedMs: 60_000, workingSetBytes: 1200 },
      { elapsedMs: 120_000, workingSetBytes: 1400 },
      { elapsedMs: 180_000, workingSetBytes: 1410 },
      { elapsedMs: 240_000, workingSetBytes: 1420 },
      { elapsedMs: 300_000, workingSetBytes: 1430 },
    ]);
    expect(trend.classification).toBe("plateau");
    expect(trend.lateWindowChangePercent).toBeCloseTo(1.42, 1);
  });
});
