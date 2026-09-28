import { describe, expect, it } from "vitest";
import { createVerificationRecord, parseCriteria, summarizeVerification } from "./verification";
import type { VerificationRecord } from "./tasks";

const base: Omit<VerificationRecord, "id" | "criterionId" | "criterionText" | "outcome"> = {
  taskId: "task", revision: 2, check: "bun run test", evidence: "passed output", checkedAt: 10,
};
const record = (id: string, criterionId: string, criterionText: string, outcome: VerificationRecord["outcome"], checkedAt: number, revision = 2): VerificationRecord => ({
  ...base, id: `${criterionId}-${checkedAt}`, criterionId, criterionText, outcome, checkedAt, revision,
});

describe("acceptance criterion parsing and verification", () => {
  it("parses stable IDs and reports duplicate or malformed lines", () => {
    expect(parseCriteria("AC-01: Refresh restores selection\n\nAC-12: Show verification" )).toMatchObject({
      criteria: [{ id: "AC-01", text: "Refresh restores selection" }, { id: "AC-12", text: "Show verification" }], errors: [], needsIds: false,
    });
    expect(parseCriteria("AC-01: one\nAC-01: duplicate").errors).toContain("Duplicate acceptance criterion ID: AC-01");
    expect(parseCriteria("AC-1: too short\nAC-02:").errors).toHaveLength(2);
  });

  it("leaves legacy plain-language criteria readable but unverified", () => {
    expect(parseCriteria("Selection survives refresh")).toMatchObject({ criteria: [], errors: [], needsIds: true });
    expect(summarizeVerification("Selection survives refresh", 1, [])).toMatchObject({ state: "needs_ids" });
  });

  it("requires passing current-revision evidence for every criterion", () => {
    const criteria = "AC-01: Selection survives refresh\nAC-02: No data is lost";
    const first = record("one", "AC-01", "Selection survives refresh", "passed", 10);
    expect(summarizeVerification(criteria, 2, [first])).toMatchObject({ state: "incomplete", passed: 1, total: 2 });
    const all = [first, record("two", "AC-02", "No data is lost", "passed", 11)];
    expect(summarizeVerification(criteria, 2, all)).toMatchObject({ state: "verified", passed: 2, total: 2 });
    expect(summarizeVerification(criteria, 3, all)).toMatchObject({ state: "incomplete", stale: 2 });
  });

  it("uses the latest outcome and invalidates evidence when criterion text changes", () => {
    const oldPass = record("old", "AC-01", "The pane renders", "passed", 10);
    const laterFail = record("new", "AC-01", "The pane renders", "failed", 11);
    expect(summarizeVerification("AC-01: The pane renders", 2, [oldPass, laterFail])).toMatchObject({ state: "failed", failed: 1 });
    expect(summarizeVerification("AC-01: The pane is styled", 2, [oldPass])).toMatchObject({ state: "incomplete", stale: 1 });
  });

  it("snapshots criterion text and rejects unrelated or old-revision runs", () => {
    const task = { id: "task", project: "C:/project", title: "T", spec: "S", criteria: "AC-01: Visible result", revision: 2, context: "", draft: "", createdAt: 0, updatedAt: 0 };
    const input = { criterionId: "AC-01", outcome: "passed", check: "bun run test", evidence: "ok", runId: "run" };
    const run = { id: "run", taskId: "task", project: "C:/project", task: "", provider: "codex", specRevision: 2, spec: "S", criteria: task.criteria, context: "", status: "done", eventCount: 0, startedAt: 1, exitCode: 0 } as const;
    expect(createVerificationRecord(task, input, run, 100)).toMatchObject({ taskId: "task", criterionId: "AC-01", criterionText: "Visible result", revision: 2, runId: "run", checkedAt: 100 });
    expect(() => createVerificationRecord(task, { ...input, criterionId: "AC-99" }, run)).toThrow("current task revision");
    expect(() => createVerificationRecord(task, input, { ...run, specRevision: 1 })).toThrow("current spec revision");
  });
});
