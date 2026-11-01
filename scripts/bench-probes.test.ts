import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { commFromProcStat, prettyNameFromOsRelease, rssPagesFromProcStat, sumRssForComm } from "./bench-probes.ts";

describe("commFromProcStat", () => {
  test("plain comm", () => {
    expect(commFromProcStat("1234 (chrome-headless) S 1 2")).toBe("chrome-headless");
  });

  test("comm containing spaces", () => {
    expect(commFromProcStat("42 (i have spaces) S 1 2")).toBe("i have spaces");
  });

  test("malformed input", () => {
    expect(commFromProcStat("1234 chrome-headless S")).toBeNull();
    expect(commFromProcStat("no parens at all")).toBeNull();
  });
});

describe("rssPagesFromProcStat", () => {
  test("reads field 24 (rss) from remainder after comm", () => {
    const stat = "1234 (chrome-headless) S 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 12345 final";
    expect(rssPagesFromProcStat(stat)).toBe(12345);
  });

  test("truncated remainder", () => {
    expect(rssPagesFromProcStat("1234 (chrome-headless) S 0 0")).toBeNull();
  });

  test("malformed input", () => {
    expect(rssPagesFromProcStat("garbage")).toBeNull();
  });
});

describe("sumRssForComm", () => {
  test("sums matching prefixes only", () => {
    const entries = [
      { comm: "chrome-headless", rssPages: 100 },
      { comm: "chrome-headless", rssPages: 250 },
      { comm: "bash", rssPages: 5 },
      { comm: "chrome-headless", rssPages: null },
      { comm: null, rssPages: 99 },
    ];
    expect(sumRssForComm(entries, "chrome-headless")).toBe(350);
  });
});

describe("prettyNameFromOsRelease", () => {
  test("unquoted value", () => {
    expect(prettyNameFromOsRelease('NAME="Arch Linux"\nPRETTY_NAME="Arch Linux"\n')).toBe("Arch Linux");
  });

  test("missing entry", () => {
    expect(prettyNameFromOsRelease('ID=arch\n')).toBeNull();
  });
});

test.skipIf(!existsSync("/proc/self/stat"))("live /proc stat parses self rss", () => {
  const stat = readFileSync("/proc/self/stat", "utf8");
  const rss = rssPagesFromProcStat(stat);
  expect(rss).toBeGreaterThan(0);
  expect(commFromProcStat(stat)).not.toBeNull();
});
