import { useEffect, useState } from "react";
import { approveProfileRevision, discardProfileRevision, editProfileDraft, getProjectProfile, refreshProjectProfile, registerProjectRecord, type ProjectProfileState } from "../lib/api";
import type { ProfileEntry } from "../lib/tasks";

const inputClass = "w-full rounded-md border border-line bg-panel-2 px-3 py-2 text-sm text-text";

function originLabel(entry: ProfileEntry) {
  return entry.origin === "repository" ? `Repository · ${entry.sourcePath ?? "unknown source"}` : `Yours · ${entry.author ?? "you"}`;
}

export function ProjectProfilePanel({ projectRoot }: { projectRoot: string }) {
  const [state, setState] = useState<ProjectProfileState | null>(null);
  const [edited, setEdited] = useState<Record<string, string> | null>(null);
  const [newKey, setNewKey] = useState("");
  const [newContent, setNewContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    try {
      setState(await getProjectProfile(projectRoot));
      setEdited(null);
    } catch (cause) { setError(String(cause)); }
  }

  useEffect(() => {
    setState(null); setEdited(null); setError(""); setMessage("");
    void load();
  }, [projectRoot]);

  async function run(operation: () => Promise<unknown>, done: string) {
    setBusy(true); setError(""); setMessage("");
    try { await operation(); await load(); setMessage(done); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }

  const draft = state?.revisions.filter((revision) => revision.state === "draft").at(-1);
  const draftEntries = draft && edited
    ? draft.entries.map((entry) => (edited[entry.key] !== undefined ? { ...entry, content: edited[entry.key] } : entry))
    : draft?.entries;

  return <section aria-label="Project profile" className="space-y-3 rounded border border-line bg-panel p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">Project profile</h3>
      <span className="break-all text-xs text-muted">{projectRoot}</span>
    </div>
    {error && <p role="alert" className="break-words text-xs text-err">{error}</p>}
    {message && <p role="status" className="text-xs text-muted">{message}</p>}
    {!state && !error && <p className="text-xs text-muted">Loading profile…</p>}
    {state && !state.project && <div className="space-y-2">
      <p className="text-xs text-muted">This project has no profile yet. Register it to start a reviewed knowledge profile.</p>
      <button type="button" disabled={busy} onClick={() => void run(() => registerProjectRecord(projectRoot), "Project registered.")} className="rounded border border-line px-3 py-2 text-xs disabled:opacity-40">Register project</button>
    </div>}
    {state?.project && !state.activeRevision && !draft && <div className="space-y-2">
      <p className="text-xs text-muted">No approved profile. Discover a draft from repository sources to review.</p>
      <button type="button" disabled={busy} onClick={() => void run(() => refreshProjectProfile(projectRoot), "Draft discovered.")} className="rounded border border-line px-3 py-2 text-xs disabled:opacity-40">Discover draft</button>
    </div>}
    {state?.activeRevision && <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-muted">Active revision · {state.activeRevision.entries.length} entries</h4>
        {state.stale && <p className="text-xs text-err">Sources changed since approval: {state.changed.join(", ") || "unknown"}</p>}
      </div>
      {state.activeRevision.entries.map((entry) => <article key={entry.key} className="rounded-md bg-panel-2 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><span className="text-xs font-semibold">{entry.key}</span><span className="text-[10px] text-faint">{originLabel(entry)}</span></div>
        <p className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words text-xs text-muted">{entry.content}</p>
      </article>)}
    </div>}
    {draft && draftEntries && <div className="space-y-2 border-t border-line-soft pt-3">
      <h4 className="text-xs font-semibold text-muted">Draft under review · {draft.entries.length} entries</h4>
      {draftEntries.map((entry) => <div key={entry.key} className="space-y-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><span className="text-xs font-semibold">{entry.key}</span><span className="text-[10px] text-faint">{originLabel(entry)}</span></div>
        <textarea aria-label={`Draft content for ${entry.key}`} rows={3} value={entry.content} onChange={(event) => setEdited((current) => ({ ...(current ?? {}), [entry.key]: event.target.value }))} className={inputClass} />
      </div>)}
      <label className="block space-y-1 text-xs text-muted"><span>New entry key</span><input value={newKey} onChange={(event) => setNewKey(event.target.value)} placeholder="e.g. release-checklist" className={inputClass} /></label>
      <label className="block space-y-1 text-xs text-muted"><span>New entry content</span><textarea rows={2} value={newContent} onChange={(event) => setNewContent(event.target.value)} placeholder="Your project guidance" className={inputClass} /></label>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || !newKey.trim() || !newContent.trim()} onClick={() => void run(() => editProfileDraft(draft.id, [...(draftEntries ?? []), { key: newKey.trim(), origin: "user", author: "You", content: newContent }]).then(() => { setNewKey(""); setNewContent(""); }), "Entry added.")} className="rounded border border-line px-3 py-2 text-xs disabled:opacity-40">Add entry</button>
        <button type="button" disabled={busy || !edited} onClick={() => draftEntries && void run(() => editProfileDraft(draft.id, draftEntries), "Draft saved.")} className="rounded border border-line px-3 py-2 text-xs disabled:opacity-40">Save edits</button>
        <button type="button" disabled={busy} onClick={() => void run(() => approveProfileRevision(draft.id), "Revision approved.")} className="rounded bg-accent px-3 py-2 text-xs font-semibold text-black disabled:opacity-40">Approve</button>
        <button type="button" disabled={busy} onClick={() => void run(() => discardProfileRevision(draft.id), "Draft discarded.")} className="rounded border border-line px-3 py-2 text-xs disabled:opacity-40">Discard</button>
      </div>
    </div>}
  </section>;
}
