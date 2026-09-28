import { useEffect, useState } from "react";
import { createWorkspace, mergeWorkspace, removeWorkspace, reviewWorkspace } from "../lib/api";
import type { TaskRecord, WorkspaceReview } from "../lib/tasks";

const buttonClass = "rounded border border-line px-3 py-2 text-xs disabled:opacity-40";

export function WorkspacePanel({ task, locked, onSaved, onBusyChange }: {
  task: TaskRecord;
  locked: boolean;
  onSaved: (task: TaskRecord) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [review, setReview] = useState<WorkspaceReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const workspace = task.workspace;
  const ready = workspace?.state === "ready";

  useEffect(() => { setReview(null); }, [task.id, workspace?.path, workspace?.state, locked]);

  async function action(operation: () => Promise<void>) {
    setBusy(true); onBusyChange(true); setError(""); setMessage("");
    try { await operation(); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); onBusyChange(false); }
  }

  return <section aria-label="Task workspace" className="space-y-3 rounded border border-line bg-panel p-3">
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">Task workspace</h3>
      <span className="text-xs text-muted">{workspace ? workspace.state === "ready" ? "Isolated" : workspace.state === "removed" ? "Removed" : "Setup incomplete" : "Shared checkout"}</span>
    </div>
    <dl className="space-y-1 break-all text-xs text-muted">
      <div><dt className="inline text-faint">Source: </dt><dd className="inline">{workspace?.source ?? task.project}</dd></div>
      {workspace && <>
        <div><dt className="inline text-faint">Workspace: </dt><dd className="inline">{workspace.path}</dd></div>
        <div><dt className="inline text-faint">Task branch: </dt><dd className="inline">{workspace.branch}</dd></div>
        <div><dt className="inline text-faint">Merge target: </dt><dd className="inline">{workspace.targetBranch}</dd></div>
      </>}
    </dl>
    {(!workspace || workspace.state === "provisioning") && <>
      <p className="text-xs text-muted">Create a separate branch and worktree from the source Git checkout's committed HEAD. Choose the checkout root. Uncommitted files are not copied, and dependencies are not installed automatically.</p>
      <button disabled={locked || busy} onClick={() => void action(async () => {
        onSaved(await createWorkspace(task.id)); setReview(null); setMessage("Isolated workspace ready. New runs use its task branch.");
      })} className={buttonClass}>{workspace ? "Retry workspace setup" : "Create isolated workspace"}</button>
    </>}
    {ready && <>
      <p className="text-xs text-muted">Review all changes against the starting commit. Merge applies only committed changes by fast-forward to the source branch; both checkouts must be clean.</p>
      <div className="flex flex-wrap gap-2">
        <button disabled={locked || busy} onClick={() => void action(async () => {
          setReview(null); setReview(await reviewWorkspace(task.id));
        })} className={buttonClass}>Review changes</button>
        <button disabled={locked || busy || !review || !!review.status.trim()} onClick={() => void action(async () => {
          if (!review) return;
          onSaved(await mergeWorkspace(task.id, review.head)); setReview(null); setMessage("Reviewed commit merged into the source branch.");
        })} className={buttonClass}>Merge reviewed commit</button>
        <button disabled={locked || busy} onClick={() => void action(async () => {
          onSaved(await removeWorkspace(task.id)); setReview(null); setMessage("Workspace removed. Its branch, task and run history are preserved.");
        })} className={buttonClass}>Remove workspace</button>
      </div>
      <p className="text-xs text-faint">Removal preserves the branch and refuses local changes, untracked files, or ignored files. Removed workspaces cannot run again.</p>
    </>}
    {workspace?.state === "removed" && <p className="text-xs text-muted">The branch and run history are retained. Create a new task to start another workspace.</p>}
    {locked && <p className="text-xs text-muted">Workspace operations are unavailable while a run is active or awaiting interruption acknowledgement.</p>}
    {error && <p role="alert" className="break-words text-sm text-err">{error}</p>}
    {message && <p role="status" className="text-xs text-muted">{message}</p>}
    {review && <div className="space-y-2 border-t border-line pt-3 text-xs">
      <p className="break-all text-muted">Reviewed branch: {review.branch} · Commit: {review.head}</p>
      <h4 className="font-semibold">Working tree status</h4>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-panel-2 p-3">{review.status || "Clean"}</pre>
      {review.status && <p className="text-muted">Commit and review these changes before merging. Saber does not create commits for you.</p>}
      <h4 className="font-semibold">Changes since workspace creation</h4>
      <pre className="max-h-96 overflow-auto rounded bg-panel-2 p-3">{review.diff || "No tracked changes."}</pre>
      <p className="text-faint">Untracked files appear in status; their contents are not included in the diff. A changed commit requires a fresh review before merging.</p>
    </div>}
  </section>;
}
