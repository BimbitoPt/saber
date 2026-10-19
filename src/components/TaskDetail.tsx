import { useEffect, useRef, useState } from "react";
import { acknowledgeRun, launchTask, listTaskRuns, previewTaskScope, saveTask, stopSession, listProviders } from "../lib/api";
import { runStatusLabel, providerLabels, type ProviderId, type ProviderStatus, type ScopePreview, type TaskRecord, type RunRecord } from "../lib/tasks";
import { SessionPane } from "./SessionPane";
import { WorkspacePanel } from "./WorkspacePanel";
import { VerificationPanel } from "./VerificationPanel";
import { ProjectProfilePanel } from "./ProjectProfilePanel";
import { SpecialistTeamPicker } from "./SpecialistTeamPicker";
import { TeamReviewList } from "./TeamReviewList";

const inputClass = "w-full rounded-md border border-line bg-panel-2 px-3 py-2 text-sm text-text";
const fields = (task: TaskRecord) => ({ title: task.title, spec: task.spec, criteria: task.criteria, context: task.context, draft: task.draft });

export function TaskDetail({ task, onSaved }: { task: TaskRecord; onSaved: (task: TaskRecord) => void }) {
  const [form, setForm] = useState(() => fields(task));
  const [saved, setSaved] = useState(() => fields(task));
  const [base, setBase] = useState(() => ({ revision: task.revision, updatedAt: task.updatedAt }));
  const [conflict, setConflict] = useState(false);
  const taskRef = useRef(task);
  taskRef.current = task;
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [model, setModel] = useState("");
  const [provider, setProvider] = useState<ProviderId>("opencode");
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [preview, setPreview] = useState<ScopePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const readiness = providers.find((item) => item.id === provider);
  const capability = readiness?.contextBudget?.supportsProfileContext === false
    ? "No profile context: launch would omit the profile snapshot and role instructions."
    : readiness?.contextBudget
      ? `Profile context supported · budget ${(readiness.contextBudget.maxPromptChars / 1000).toFixed(0)}k chars.`
      : null;

  async function loadPreview() {
    setPreviewLoading(true); setError("");
    try { setPreview(await previewTaskScope(task.id, provider)); }
    catch (e) { setError(String(e)); }
    finally { setPreviewLoading(false); }
  }
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const storageKey = `saber.task.${task.id}`;
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  async function refreshProviders() {
    setChecking(true);
    try { setProviders(await listProviders()); }
    catch (e) { setError(String(e)); }
    finally { setChecking(false); }
  }

  useEffect(() => {
    void refreshProviders();
    try {
      const previous = localStorage.getItem(`saber.provider.${task.id}`);
      if (previous === "opencode" || previous === "codex" || previous === "claude") setProvider(previous);
    } catch {}
  }, [task.id]);

  useEffect(() => {
    // Read the draft once per task, against the task as it is when that task is opened. Later
    // server bumps must not delete a draft the user is still editing.
    const current = taskRef.current;
    try {
      const recovery = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      const recovered = recovery?.fields ?? recovery;
      const complete = recovered && Object.keys(fields(current)).every((key) => typeof recovered[key] === "string");
      const sameBase = recovery?.baseRevision === current.revision && recovery?.baseUpdatedAt === current.updatedAt;
      if (complete && sameBase) setForm(recovered);
      else if (complete) localStorage.removeItem(storageKey);
    } catch {}
  }, [storageKey]);

  useEffect(() => {
    if (task.revision === base.revision && task.updatedAt === base.updatedAt) return;
    if (dirty) {
      setConflict(true);
      return;
    }
    const next = fields(task);
    setForm(next);
    setSaved(next);
    setBase({ revision: task.revision, updatedAt: task.updatedAt });
    setConflict(false);
  }, [task, dirty, base.revision, base.updatedAt]);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => listTaskRuns(task.id).then((items) => {
      if (!cancelled) { setRuns(items); setRunId((old) => old ?? items[0]?.id ?? null); }
    }).catch((e) => { if (!cancelled) setError(String(e)); });
    void refresh();
    const timer = setInterval(refresh, 1500);
    return () => { cancelled = true; clearInterval(timer); };
  }, [task.id]);

  function edit(key: keyof typeof form, value: string) {
    const next = { ...form, [key]: value };
    setForm(next); setMessage("");
    try { localStorage.setItem(storageKey, JSON.stringify({ fields: next, baseRevision: base.revision, baseUpdatedAt: base.updatedAt })); }
    catch { setError("Local recovery is unavailable. Save changes before switching tasks."); }
  }

  function reloadFromServer() {
    const next = fields(task);
    setForm(next); setSaved(next);
    setBase({ revision: task.revision, updatedAt: task.updatedAt });
    setConflict(false); setMessage(""); setError("");
    try { localStorage.removeItem(storageKey); } catch {}
  }

  async function save() {
    const result = await saveTask(task.id, { ...form, expectedRevision: base.revision, expectedUpdatedAt: base.updatedAt });
    setSaved(fields(result));
    setBase({ revision: result.revision, updatedAt: result.updatedAt });
    setConflict(false);
    onSaved(result);
    try { localStorage.removeItem(storageKey); } catch {}
    return result;
  }

  async function action(operation: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await operation(); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  async function launch(followup = false) {
    await save();
    const result = await launchTask(task.id, { provider, model: model.trim() || undefined, followup: followup ? form.draft : undefined });
    setRunId(result.id);
    setRuns(await listTaskRuns(task.id));
    setMessage("Run started. The saved draft is retained for recovery.");
  }

  const latest = runs[0];
  const active = runs.some((run) => run.status === "running");
  const interrupted = runs.filter((run) => run.status === "interrupted");
  const selectedRun = runs.find((run) => run.id === runId);
  const unavailable = checking || !readiness || !readiness.installed || readiness.auth === "signed-out";
  const workspaceUnavailable = !!task.workspace && task.workspace.state !== "ready";
  const executionPath = task.workspace?.path ?? task.project;

  return <div className="space-y-4 p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-semibold">{task.title}</h2><p className="mt-1 text-xs text-muted">Spec {task.revision} · {latest ? `${runStatusLabel[latest.status]} · ${providerLabels[latest.provider]}` : "Draft"}</p><p className="mt-1 break-all text-xs text-faint">{task.project}</p></div>
      <button disabled={busy || workspaceBusy} onClick={() => void action(async () => { await save(); setMessage("Task and context saved."); })} className="rounded border border-line px-3 py-2 text-xs disabled:opacity-40">{dirty ? "Save changes" : "Saved"}</button>
    </div>
    {error && <p role="alert" className="text-sm text-err">{error}</p>}
    {message && <p role="status" className="text-xs text-muted">{message}</p>}
    {conflict && <div role="alert" className="flex flex-wrap items-center gap-2 rounded border border-line p-2 text-xs text-err">
      This task changed on the server. Your unsaved edits were kept, but saving them would overwrite newer state.
      <button onClick={reloadFromServer} className="rounded border border-line px-2 py-1 text-xs">Discard local changes and reload</button>
    </div>}
    {dirty && <p className="text-xs text-muted">Unsaved edits restored locally. Save to update the task.</p>}
    <WorkspacePanel task={task} locked={busy || active || interrupted.length > 0} onSaved={onSaved} onBusyChange={setWorkspaceBusy} />
    <ProjectProfilePanel projectRoot={task.project} />
    <VerificationPanel task={task} runs={runs} disabled={busy || workspaceBusy || active || interrupted.length > 0 || dirty} />
    <fieldset disabled={busy || workspaceBusy} className="space-y-3 disabled:opacity-60">
      <details>
        <summary className="cursor-pointer text-sm text-muted">Specification and acceptance criteria</summary>
        <div className="mt-3 space-y-3">
          <label className="block text-xs text-muted">Task title<input value={form.title} onChange={(e) => edit("title", e.target.value)} className={inputClass} /></label>
          <label className="block text-xs text-muted">Specification<textarea rows={4} value={form.spec} onChange={(e) => edit("spec", e.target.value)} className={inputClass} /></label>
          <label className="block text-xs text-muted">Acceptance criteria<textarea rows={3} value={form.criteria} onChange={(e) => edit("criteria", e.target.value)} placeholder={"AC-01: What must be true?\nAC-02: What else must hold?"} className={inputClass} /></label>
        </div>
      </details>
      <label className="block space-y-1 text-xs text-muted"><span>Context checkpoint</span><textarea rows={3} value={form.context} onChange={(e) => edit("context", e.target.value)} placeholder="Decisions, relevant files, blockers, and next action" className={inputClass} /></label>
      <label className="block space-y-1 text-xs text-muted"><span>Follow-up draft</span><textarea rows={2} value={form.draft} onChange={(e) => edit("draft", e.target.value)} placeholder="Keep your next instruction here while you switch tasks" className={inputClass} /></label>
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-40 text-xs text-muted">Provider<select value={provider} onChange={(e) => {
          const next = e.target.value as ProviderId; setProvider(next); setModel("");
          try { localStorage.setItem(`saber.provider.${task.id}`, next); } catch {}
        }} className={inputClass}>{Object.entries(providerLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label className="min-w-40 flex-1 text-xs text-muted">Model (optional)<input value={model} onChange={(e) => setModel(e.target.value)} placeholder={`${providerLabels[provider]} default`} className={inputClass} /></label>
        <button disabled={unavailable || workspaceUnavailable || active || interrupted.length > 0 || conflict} onClick={() => void action(() => launch())} className="rounded bg-accent px-3 py-2 text-sm font-semibold text-black disabled:opacity-40">{latest ? "New run" : "Run specification"}</button>
        {runs.some((run) => run.provider === provider && run.nativeSessionId && run.project === executionPath) && <button disabled={unavailable || workspaceUnavailable || active || interrupted.length > 0 || conflict || !form.draft.trim()} onClick={() => void action(() => launch(true))} className="rounded border border-line px-3 py-2 text-sm disabled:opacity-40">Send follow-up</button>}
        {active && <button onClick={() => void action(async () => { await stopSession(runs.find((run) => run.status === "running")!.id); setRuns(await listTaskRuns(task.id)); })} className="rounded border border-line px-3 py-2 text-sm">Stop run</button>}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted"><span>{checking ? "Checking providers..." : readiness?.message ?? "Provider status unavailable."}</span><button disabled={checking} onClick={() => void refreshProviders()} className="underline disabled:opacity-40">Refresh providers</button>{capability && <span aria-label="Provider context capability">· {capability}</span>}</div>
      <SpecialistTeamPicker taskId={task.id} projectRoot={task.project} defaultProvider={provider} onLaunched={() => { void listTaskRuns(task.id).then(setRuns); }} />
      <details open={previewOpen} onToggle={(e) => { setPreviewOpen((e.target as HTMLDetailsElement).open); if ((e.target as HTMLDetailsElement).open && !preview && !previewLoading) void loadPreview(); }} className="rounded border border-line p-3 text-xs text-muted">
        <summary className="cursor-pointer">Outgoing context{preview ? ` · ${preview.totalChars.toLocaleString()} / ${preview.budget.toLocaleString()} chars` : ""}</summary>
        <div className="mt-2 space-y-2">
          <button disabled={previewLoading} onClick={() => void loadPreview()} className="rounded border border-line px-3 py-1 disabled:opacity-40">{previewLoading ? "Loading preview..." : preview ? "Refresh preview" : "Load preview"}</button>
          {preview && <>
            <ul className="space-y-1">{preview.sources.map((source) => <li key={source.name}>{source.name} · {source.chars.toLocaleString()} chars</li>)}</ul>
            <p role="status">{preview.verdict === "ok" ? `Ready to launch: ${preview.totalChars.toLocaleString()} of ${preview.budget.toLocaleString()} chars.` : preview.verdict === "oversized" ? `Blocked: ${preview.notice}` : preview.notice}</p>
          </>}
        </div>
      </details>
      {latest && latest.provider !== provider && <p className="text-xs text-muted">A new {providerLabels[provider]} run receives the saved specification and checkpoint. Native conversation history stays with its original provider.</p>}
    </fieldset>
    {interrupted.map((run) => <div key={run.id} className="rounded border border-line p-3 text-xs text-muted">
      <p>Saber restarted during this run. Its process may still be running. Stop it before releasing this workspace.</p>
      <button disabled={busy} onClick={() => void action(async () => { await acknowledgeRun(run.id); setRuns(await listTaskRuns(task.id)); })} className="mt-2 rounded border border-line px-3 py-2">I confirm the old process has stopped</button>
    </div>)}
    {runs.length > 0 && <div className="space-y-2 border-t border-line pt-3">
      <label className="block text-xs text-muted">Run history<select aria-label="Run history" value={runId ?? ""} onChange={(e) => setRunId(e.target.value)} className={inputClass}>
        {runs.map((run, index) => <option key={run.id} value={run.id}>Attempt {runs.length - index} · {providerLabels[run.provider]} · Spec {run.specRevision} · {runStatusLabel[run.status]} · {new Date(run.startedAt).toLocaleString()}</option>)}
      </select></label>
      {selectedRun && <details className="text-xs text-muted"><summary className="cursor-pointer">Scope captured for this run</summary><p className="mt-2 break-all">Working directory: {selectedRun.project}</p><pre className="mt-2 whitespace-pre-wrap rounded bg-panel p-3 font-sans">{selectedRun.task}</pre></details>}
      <div className="h-80 min-h-0 rounded border border-line"><SessionPane sessionId={runId} /></div>
    </div>}
    <TeamReviewList taskId={task.id} runs={runs} onChanged={() => { void listTaskRuns(task.id).then(setRuns); }} />
  </div>;
}
