import { useEffect, useState } from "react";
import { listVerifications, recordVerification } from "../lib/api";
import type { AcceptanceCriterion, RunRecord, TaskRecord, VerificationRecord, VerificationSummary } from "../lib/tasks";
import { parseCriteria } from "../lib/verification";

const inputClass = "w-full rounded-md border border-line bg-panel-2 px-3 py-2 text-sm text-text";
const summaryLabel: Record<VerificationSummary["state"], string> = {
  needs_ids: "Needs criterion IDs", invalid: "Invalid criteria", incomplete: "Incomplete", failed: "Verification failed", verified: "Verified",
};

export function VerificationPanel({ task, runs, disabled }: { task: TaskRecord; runs: RunRecord[]; disabled: boolean }) {
  const parsed = parseCriteria(task.criteria);
  const [records, setRecords] = useState<VerificationRecord[]>([]);
  const [summary, setSummary] = useState<VerificationSummary | null>(null);
  const [forms, setForms] = useState<Record<string, { check: string; evidence: string; runId: string }>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listVerifications(task.id).then((result) => {
      if (!cancelled) { setRecords(result.records); setSummary(result.summary); }
    }).catch((cause) => { if (!cancelled) setError(String(cause)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [task.id, task.criteria, task.revision]);

  function update(criterionId: string, field: "check" | "evidence" | "runId", value: string) {
    setForms((current) => ({ ...current, [criterionId]: { ...(current[criterionId] ?? { check: "", evidence: "", runId: "" }), [field]: value } }));
  }

  async function submit(criterion: AcceptanceCriterion, outcome: "passed" | "failed") {
    const form = forms[criterion.id] ?? { check: "", evidence: "", runId: "" };
    if (!form.check.trim() || !form.evidence.trim()) { setError("Describe the check and its result before recording evidence."); return; }
    setBusy(criterion.id); setError(""); setMessage("");
    try {
      const result = await recordVerification(task.id, {
        criterionId: criterion.id, outcome, check: form.check, evidence: form.evidence, runId: form.runId || undefined,
      });
      setRecords(result.records); setSummary(result.summary);
      setMessage(`${criterion.id}: ${outcome === "passed" ? "Pass recorded." : "Failure recorded."}`);
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(null); }
  }

  const currentRuns = runs.filter((run) => run.specRevision === task.revision && run.status !== "running" && run.status !== "interrupted");
  const latestFor = (criterion: AcceptanceCriterion) => records
    .filter((record) => record.criterionId === criterion.id)
    .sort((a, b) => b.checkedAt - a.checkedAt || b.id.localeCompare(a.id))[0];

  return <section aria-label="Verification" className="space-y-3 rounded border border-line bg-panel p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">Acceptance verification</h3>
      <span className="text-xs text-muted">{loading ? "Loading evidence…" : summary ? summaryLabel[summary.state] : "Unavailable"}</span>
    </div>
    {summary && <p className="text-xs text-muted">{summary.passed} of {summary.total} criteria passed · {summary.failed} failed · {summary.stale} stale</p>}
    {parsed.needsIds && <p className="text-xs text-muted">Add stable IDs to each acceptance criterion to enable verification, for example <code>AC-01: Selection survives refresh</code>.</p>}
    {parsed.errors.length > 0 && <div role="alert" className="space-y-1 text-xs text-err">{parsed.errors.map((item) => <p key={item}>{item}</p>)}</div>}
    {error && <p role="alert" className="break-words text-xs text-err">{error}</p>}
    {message && <p role="status" className="text-xs text-muted">{message}</p>}
    {!loading && parsed.criteria.map((criterion) => {
      const latest = latestFor(criterion);
      const isCurrent = latest?.revision === task.revision && latest.criterionText === criterion.text;
      const form = forms[criterion.id] ?? { check: "", evidence: "", runId: "" };
      const history = records.filter((record) => record.criterionId === criterion.id).sort((a, b) => b.checkedAt - a.checkedAt);
      return <article key={criterion.id} className="space-y-2 border-t border-line-soft pt-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-xs font-semibold"><span className="mr-2 font-mono text-accent">{criterion.id}</span>{criterion.text}</h4>
          <span className={`text-xs ${isCurrent && latest?.outcome === "passed" ? "text-ok" : isCurrent && latest?.outcome === "failed" ? "text-err" : "text-faint"}`}>
            {isCurrent ? latest!.outcome === "passed" ? "Passed" : "Failed" : latest ? `Stale · Spec ${latest.revision}` : "Not checked"}
          </span>
        </div>
        {latest && <details className="text-xs text-muted"><summary className="cursor-pointer">Latest evidence · {new Date(latest.checkedAt).toLocaleString()}</summary>
          <p className="mt-2">Check: {latest.check}</p><p className="mt-1 whitespace-pre-wrap">Evidence: {latest.evidence}</p>
          {latest.runId && <p className="mt-1">Run: {latest.runId.slice(0, 8)}</p>}
        </details>}
        {history.length > 1 && <details className="text-xs text-faint"><summary className="cursor-pointer">Earlier attempts ({history.length - 1})</summary>
          <div className="mt-2 space-y-2">{history.slice(1).map((record) => <p key={record.id}>Spec {record.revision} · {record.outcome} · {new Date(record.checkedAt).toLocaleString()} · {record.check} — {record.evidence}</p>)}</div>
        </details>}
        <fieldset disabled={disabled || busy !== null || loading} className="space-y-2 disabled:opacity-60">
          <label className="block text-xs text-muted">Check performed<input value={form.check} onChange={(event) => update(criterion.id, "check", event.target.value)} maxLength={10000} placeholder="Command, manual check, or browser steps" className={inputClass} /></label>
          <label className="block text-xs text-muted">Evidence<textarea value={form.evidence} onChange={(event) => update(criterion.id, "evidence", event.target.value)} maxLength={10000} rows={2} placeholder="Observed result or output summary" className={inputClass} /></label>
          {currentRuns.length > 0 && <label className="block text-xs text-muted">Link run (optional)<select value={form.runId} onChange={(event) => update(criterion.id, "runId", event.target.value)} className={inputClass}>
            <option value="">No linked run</option>{currentRuns.map((run) => <option key={run.id} value={run.id}>{run.provider} · {run.status} · {new Date(run.startedAt).toLocaleString()}</option>)}
          </select></label>}
          <div className="flex gap-2">
            <button type="button" disabled={!form.check.trim() || !form.evidence.trim() || disabled || busy !== null} onClick={() => void submit(criterion, "passed")} className="rounded border border-line px-3 py-2 text-xs disabled:opacity-40">Record pass</button>
            <button type="button" disabled={!form.check.trim() || !form.evidence.trim() || disabled || busy !== null} onClick={() => void submit(criterion, "failed")} className="rounded border border-line px-3 py-2 text-xs disabled:opacity-40">Record fail</button>
          </div>
        </fieldset>
      </article>;
    })}
    {!loading && !parsed.needsIds && parsed.criteria.length === 0 && parsed.errors.length === 0 && <p className="text-xs text-muted">Add acceptance criteria with stable IDs to begin verification.</p>}
    {disabled && parsed.criteria.length > 0 && <p className="text-xs text-muted">Save specification edits and finish or reconcile active runs before recording evidence.</p>}
  </section>;
}
