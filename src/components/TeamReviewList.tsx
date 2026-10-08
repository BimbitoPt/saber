import { useEffect, useState } from "react";
import { listTeams, mergeRunWorktree, reviewRunWorktree } from "../lib/api";
import { providerLabels, runStatusLabel, type RunRecord, type TeamRecord, type WorkspaceReview } from "../lib/tasks";

const inputClass = "w-full rounded-md border border-line bg-panel-2 px-3 py-2 text-sm text-text";

export function TeamReviewList({ taskId, runs, onChanged }: { taskId: string; runs: RunRecord[]; onChanged: () => void }) {
  const [teams, setTeams] = useState<TeamRecord[]>([]);
  const [reviews, setReviews] = useState<Record<string, WorkspaceReview>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function refresh() {
    try { setTeams(await listTeams(taskId)); }
    catch (cause) { setError(String(cause)); }
  }

  useEffect(() => {
    setReviews({});
    void refresh();
  }, [taskId]);

  async function loadReview(runId: string) {
    setBusy(runId); setError(""); setMessage("");
    try {
      const result = await reviewRunWorktree(taskId, runId);
      setReviews((current) => ({ ...current, [runId]: result }));
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(null); }
  }

  async function merge(runId: string) {
    const head = reviews[runId]?.head;
    if (!head) return;
    setBusy(runId); setError(""); setMessage("");
    try {
      const result = await mergeRunWorktree(taskId, runId, head);
      setMessage(result.cleanedUp
        ? `Merged ${head.slice(0, 8)} and removed its worktree.`
        : `Merged ${head.slice(0, 8)}; the worktree retains files, remove it explicitly after preserving them.`);
      await refresh();
      onChanged();
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(null); }
  }

  if (teams.length === 0) return null;

  return <div className="space-y-3 border-t border-line pt-3">
    <h3 className="text-sm font-semibold">Specialist teams</h3>
    {error && <p role="alert" className="break-words text-xs text-err">{error}</p>}
    {message && <p role="status" className="text-xs text-muted">{message}</p>}
    {teams.map((team) => {
      const done = team.members.filter((member) => runs.find((run) => run.id === member.runId)?.status === "done").length;
      return <article key={team.id} className="space-y-2 rounded border border-line p-3">
        <p className="text-xs text-muted">Team · {team.members.length} members · {done} ready for review. Merging is explicit per member; nothing here marks the task verified.</p>
        {team.members.map((member) => {
          const run = runs.find((candidate) => candidate.id === member.runId);
          const review = reviews[member.runId];
          const mergeable = !!review && !!run && ["done", "stopped", "error"].includes(run.status);
          return <div key={member.runId} className="space-y-2 rounded-md bg-panel-2 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-xs font-semibold">{member.role} · {providerLabels[member.provider]}</span>
              <span className="text-xs text-muted">{run ? `${runStatusLabel[run.status]} · Spec ${run.specRevision}` : "Blocked · no run recorded"}</span>
            </div>
            {run && <p className="break-all text-[11px] text-faint">Profile revision {run.profileRevisionId ? run.profileRevisionId.slice(0, 8) : "none"} · {run.project}</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy !== null} onClick={() => void loadReview(member.runId)} className="rounded border border-line px-2 py-1 text-xs disabled:opacity-40">Review changes</button>
              <button type="button" disabled={!mergeable || busy !== null} title={mergeable ? "Merge this reviewed head into the source checkout" : "Review a finished member run first"} onClick={() => void merge(member.runId)} className="rounded border border-line px-2 py-1 text-xs disabled:opacity-40">Merge reviewed head</button>
            </div>
            {review && <details open className="text-xs text-muted">
              <summary className="cursor-pointer">Reviewed {review.head.slice(0, 8)} · {review.branch}</summary>
              <p className="mt-1 whitespace-pre-wrap break-words">{review.status || "Clean tree."}</p>
              <pre className={`${inputClass} mt-2 max-h-48 overflow-auto font-mono text-[11px]`}>{review.diff.slice(0, 4000)}</pre>
            </details>}
          </div>;
        })}
      </article>;
    })}
  </div>;
}
