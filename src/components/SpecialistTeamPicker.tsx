import { useEffect, useState } from "react";
import { getProjectProfile, launchTeam, listProviders, listRoles, planTeam, type ProjectProfileState } from "../lib/api";
import { providerLabels, type ProviderId, type ProviderStatus, type SpecialistRole, type TeamPlan } from "../lib/tasks";

const inputClass = "w-full rounded-md border border-line bg-panel-2 px-3 py-2 text-sm text-text";

interface MemberDraft {
  role: string;
  provider: ProviderId;
}

export function SpecialistTeamPicker({ taskId, projectRoot, defaultProvider, onLaunched }: {
  taskId: string;
  projectRoot: string;
  defaultProvider: ProviderId;
  onLaunched: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [roles, setRoles] = useState<SpecialistRole[]>([]);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [members, setMembers] = useState<MemberDraft[]>([]);
  const [plan, setPlan] = useState<TeamPlan | null>(null);
  const [profileState, setProfileState] = useState<ProjectProfileState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void Promise.all([listRoles(projectRoot).catch(() => [] as SpecialistRole[]), listProviders().catch(() => [] as ProviderStatus[]), getProjectProfile(projectRoot).catch(() => null)]).then(([roleList, providerList, profile]) => {
      if (cancelled) return;
      setRoles(roleList.filter((role) => role.enabled));
      setProviders(providerList);
      setProfileState(profile);
      if (roleList.length > 0) {
        const implementer = roleList.find((role) => role.id === "implementer") ?? roleList[0];
        setMembers([{ role: implementer.id, provider: (implementer.providers.includes(defaultProvider) ? defaultProvider : implementer.providers[0]) as ProviderId }]);
      }
    });
    return () => { cancelled = true; };
  }, [open, projectRoot, defaultProvider]);

  function editMember(index: number, patch: Partial<MemberDraft>) {
    setMembers((current) => current.map((member, i) => (i === index ? { ...member, ...patch } : member)));
    setPlan(null);
  }

  async function reviewPlan() {
    setBusy(true); setError(""); setMessage(""); setPlan(null);
    try {
      setPlan(await planTeam(taskId, members));
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }

  async function launch() {
    setBusy(true); setError(""); setMessage("");
    try {
      const team = await launchTeam(taskId, members);
      setMessage(`Team launched with ${team.members.length} members. Each run keeps its own workspace and history.`);
      setPlan(null);
      onLaunched();
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }

  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className="rounded border border-line px-3 py-2 text-sm">Start specialist team</button>;
  }

  const providerStatusFor = (id: ProviderId) => providers.find((item) => item.id === id);
  return <div className="space-y-3 rounded border border-line p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="text-xs font-semibold">Specialist team · explicit launch only</h4>
      <button type="button" onClick={() => setOpen(false)} className="rounded border border-line px-2 py-1 text-xs text-muted">Close</button>
    </div>
    {error && <p role="alert" className="break-words text-xs text-err">{error}</p>}
    {message && <p role="status" className="text-xs text-muted">{message}</p>}
    {profileState && !profileState.activeRevision && <p className="text-xs text-muted">Approve a project profile before launching a team.</p>}
    {roles.length === 0 && <p className="text-xs text-muted">No enabled roles for this project yet.</p>}
    {members.map((member, index) => {
      const role = roles.find((candidate) => candidate.id === member.role);
      const providerOptions = role?.providers ?? [];
      return <div key={index} className="flex flex-wrap items-end gap-2">
        <label className="min-w-40 flex-1 text-xs text-muted">Role
          <select aria-label={`Member ${index + 1} role`} value={member.role} onChange={(e) => {
            const next = roles.find((candidate) => candidate.id === e.target.value);
            editMember(index, { role: e.target.value, provider: next && !next.providers.includes(member.provider) ? next.providers[0] as ProviderId : member.provider });
          }} className={inputClass}>
            {roles.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.displayName}{candidate.write ? " · writes" : " · read-only"}</option>)}
          </select>
        </label>
        <label className="min-w-40 flex-1 text-xs text-muted">Provider
          <select aria-label={`Member ${index + 1} provider`} value={member.provider} onChange={(e) => editMember(index, { provider: e.target.value as ProviderId })} className={inputClass}>
            {providerOptions.map((id) => {
              const readiness = providerStatusFor(id);
              const unavailable = !readiness || !readiness.installed || readiness.auth === "signed-out";
              return <option key={id} value={id}>{providerLabels[id]}{unavailable ? " · unavailable" : ""}</option>;
            })}
          </select>
        </label>
        {members.length > 1 && <button type="button" onClick={() => { setMembers((current) => current.filter((_, i) => i !== index)); setPlan(null); }} className="rounded border border-line px-2 py-2 text-xs">Remove</button>}
      </div>;
    })}
    <div className="flex flex-wrap gap-2">
      {members.length < 4 && roles.length > 0 && <button type="button" onClick={() => {
        const fallback = roles.find((candidate) => !members.some((member) => member.role === candidate.id)) ?? roles[0];
        setMembers((current) => [...current, { role: fallback.id, provider: fallback.providers[0] as ProviderId }]); setPlan(null);
      }} className="rounded border border-line px-3 py-2 text-xs">Add member ({members.length}/4)</button>}
      <button type="button" disabled={busy || members.length === 0} onClick={() => void reviewPlan()} className="rounded border border-line px-3 py-2 text-xs disabled:opacity-40">Review plan</button>
      {plan && <button type="button" disabled={busy} onClick={() => void launch()} className="rounded bg-accent px-3 py-2 text-xs font-semibold text-black disabled:opacity-40">Launch {plan.members.length} members</button>}
    </div>
    {plan && <div className="space-y-1 text-xs text-muted">
      <p>Workspace plan · source {plan.source}</p>
      <ul className="space-y-1">{plan.members.map((member) => <li key={member.role.id + member.provider}>{member.role.displayName} · {providerLabels[member.provider]} · {member.readOnly ? "read-only" : "writes in its own worktree"}</li>)}</ul>
    </div>}
  </div>;
}
