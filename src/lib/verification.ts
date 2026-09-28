import type { AcceptanceCriterion, RunRecord, TaskRecord, VerificationOutcome, VerificationRecord, VerificationSummary } from "./tasks";

export function parseCriteria(criteria: string): { criteria: AcceptanceCriterion[]; errors: string[]; needsIds: boolean } {
  const lines = criteria.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const parsed: AcceptanceCriterion[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  let unnumbered = 0;
  for (const line of lines) {
    const match = /^(AC-\d{2,}):\s*(\S.*)$/.exec(line);
    if (!match) {
      unnumbered++;
      errors.push(`Use “AC-01: criterion text” for: ${line.slice(0, 100)}`);
      continue;
    }
    if (seen.has(match[1])) errors.push(`Duplicate acceptance criterion ID: ${match[1]}`);
    seen.add(match[1]);
    parsed.push({ id: match[1], text: match[2].trim() });
  }
  const containsMalformedId = lines.some((line) => /^AC-/i.test(line));
  const needsIds = lines.length > 0 && parsed.length === 0 && unnumbered === lines.length && !containsMalformedId;
  return { criteria: parsed, errors: needsIds ? [] : errors, needsIds };
}

export function summarizeVerification(criteriaText: string, revision: number, records: VerificationRecord[]): VerificationSummary {
  const parsed = parseCriteria(criteriaText);
  const total = parsed.criteria.length;
  if (parsed.needsIds) return { state: "needs_ids", total: 0, passed: 0, failed: 0, stale: 0 };
  if (parsed.errors.length || total === 0) return { state: "invalid", total, passed: 0, failed: 0, stale: 0 };
  let passed = 0;
  let failed = 0;
  let stale = 0;
  let incomplete = false;
  for (const criterion of parsed.criteria) {
    const history = records.filter((record) => record.criterionId === criterion.id)
      .sort((a, b) => b.checkedAt - a.checkedAt || b.id.localeCompare(a.id));
    const latest = history[0];
    if (!latest || latest.revision !== revision || latest.criterionText !== criterion.text) {
      if (history.length) stale++;
      incomplete = true;
    } else if (latest.outcome === "failed") failed++;
    else passed++;
  }
  const state = failed ? "failed" : incomplete ? "incomplete" : passed === total ? "verified" : "incomplete";
  return { state, total, passed, failed, stale };
}

export function createVerificationRecord(
  task: TaskRecord,
  input: { criterionId?: unknown; outcome?: unknown; check?: unknown; evidence?: unknown; runId?: unknown },
  run?: RunRecord,
  checkedAt = Date.now(),
): VerificationRecord {
  if (typeof input.criterionId !== "string" || (input.outcome !== "passed" && input.outcome !== "failed")
    || typeof input.check !== "string" || !input.check.trim() || input.check.length > 10_000
    || typeof input.evidence !== "string" || !input.evidence.trim() || input.evidence.length > 10_000
    || (input.runId !== undefined && typeof input.runId !== "string")) {
    throw new Error("Enter a criterion, check, evidence, and pass/fail outcome. Text is limited to 10,000 characters.");
  }
  const parsed = parseCriteria(task.criteria);
  if (parsed.needsIds) throw new Error("Add stable IDs such as AC-01: expected behavior to each acceptance criterion first.");
  if (parsed.errors.length) throw new Error(parsed.errors.join("; "));
  const criterion = parsed.criteria.find((item) => item.id === input.criterionId);
  if (!criterion) throw new Error("That acceptance criterion is not in the current task revision.");
  if (input.runId && !run) throw new Error("Run not found");
  if (run && (run.taskId !== task.id || run.specRevision !== task.revision)) throw new Error("Link a run from this task and current spec revision.");
  return {
    id: crypto.randomUUID(), taskId: task.id, criterionId: criterion.id, criterionText: criterion.text,
    revision: task.revision, outcome: input.outcome as VerificationOutcome, check: input.check.trim(),
    evidence: input.evidence.trim(), runId: input.runId as string | undefined, checkedAt,
  };
}
