import type { TaskInput, TaskPatch, TaskRecord, TaskSummary, RunRecord, ProviderId, ProviderStatus, TerminalSessionRecord, WorkspaceReview, VerificationRecord, VerificationSummary, VerificationOutcome, ProjectRecord, ProfileEntry, ProfileRevision, ScopePreview } from "./tasks";

export interface Project {
  name: string;
  path: string;
  port?: number;
}

export interface SessionListItem {
  id: string;
  project: string;
  task: string;
  status: "running" | "done" | "stopped" | "error" | "interrupted";
  eventCount: number;
  startedAt: number;
  endedAt?: number;
  exitCode: number | null;
}

export interface DevServerItem {
  project: string;
  port: number;
  status: "starting" | "up" | "down";
}

export interface TerminalLock {
  id: string;
  taskId: string;
  workdir: string;
  createdAt: number;
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `${res.status}`);
  return data;
}

export function listProjects() {
  return jsonFetch<Project[]>("/api/projects");
}

export function defaultModel() {
  return jsonFetch<{ default: string }>("/api/default-model");
}

export function listSessions() {
  return jsonFetch<SessionListItem[]>("/api/sessions");
}

export function startSession(project: string, task: string, model?: string) {
  return jsonFetch<{ id: string }>("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ project, task, model }),
  });
}

export function stopSession(id: string) {
  return jsonFetch<{ ok: boolean }>(`/api/sessions/${id}/stop`, { method: "POST" });
}

export function followUp(id: string, task: string) {
  return jsonFetch<{ ok: boolean }>(`/api/sessions/${id}/followup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task }),
  });
}

export interface EventsSnapshot {
  status: "running" | "done" | "stopped" | "error" | "interrupted";
  hasMore?: boolean;
  next: number;
  lines: string[];
}

export async function fetchEvents(id: string, after: number, wait: boolean) {
  const res = await fetch(
    `/api/sessions/${id}/events?after=${after}${wait ? "&wait=1" : ""}`,
  );
  if (!res.ok) throw new Error(`${res.status}`);
  return (await res.json()) as EventsSnapshot;
}

export function startDevServer(project: string) {
  return jsonFetch<{ port: number }>("/api/dev-servers/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ project }),
  });
}

export function stopDevServer(project: string) {
  return jsonFetch<{ ok: boolean }>("/api/dev-servers/stop", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ project }),
  });
}

export function listDevServers() {
  return jsonFetch<DevServerItem[]>("/api/dev-servers");
}

export const listTasks = () => jsonFetch<TaskSummary[]>("/api/tasks");
export const createTask = (input: TaskInput) => jsonFetch<TaskRecord>("/api/tasks", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
});
export const saveTask = (id: string, patch: TaskPatch) => jsonFetch<TaskRecord>(`/api/tasks/${id}`, {
  method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch),
});
export const listTaskRuns = (id: string) => jsonFetch<RunRecord[]>(`/api/tasks/${id}/runs`);
export const listProviders = () => jsonFetch<ProviderStatus[]>("/api/providers");
export const reviewWorkspace = (id: string) => jsonFetch<WorkspaceReview>(`/api/tasks/${id}/workspace`);
export const createWorkspace = (id: string) => jsonFetch<TaskRecord>(`/api/tasks/${id}/workspace`, { method: "POST" });
export const removeWorkspace = (id: string) => jsonFetch<TaskRecord>(`/api/tasks/${id}/workspace`, { method: "DELETE" });
export const mergeWorkspace = (id: string, head: string) => jsonFetch<TaskRecord>(`/api/tasks/${id}/workspace/merge`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ head }),
});
export const listVerifications = (id: string) => jsonFetch<{ records: VerificationRecord[]; summary: VerificationSummary }>(`/api/tasks/${id}/verifications`);
export const acquireTerminalLock = (taskId: string) => jsonFetch<TerminalLock>(`/api/tasks/${taskId}/terminals`, { method: "POST" });
export const releaseTerminalLock = (id: string) => jsonFetch<{ ok: boolean }>(`/api/terminals/${id}`, { method: "DELETE" });
export const getTaskTerminalSessions = (taskId: string) => jsonFetch<TerminalSessionRecord[]>(`/api/tasks/${taskId}/terminals`);
export const listTerminalSessions = () => jsonFetch<TerminalSessionRecord[]>("/api/terminals");
export const reconcileTerminalSessions = (liveSessionIds: string[]) => jsonFetch<TerminalSessionRecord[]>("/api/terminals/reconcile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ liveSessionIds }) });
export const markTerminalSessionRunning = (id: string) => jsonFetch<TerminalSessionRecord>(`/api/terminals/${id}/running`, { method: "POST" });
export const recoverTerminalSession = (id: string, confirmedStopped: boolean) => jsonFetch<TerminalSessionRecord>(`/api/terminals/${id}/recover`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmedStopped }) });
export const recordVerification = (id: string, input: { criterionId: string; outcome: VerificationOutcome; check: string; evidence: string; runId?: string }) => jsonFetch<{ record: VerificationRecord; records: VerificationRecord[]; summary: VerificationSummary }>(`/api/tasks/${id}/verifications`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
});
export const launchTask = (id: string, options: { model?: string; followup?: string; provider?: ProviderId }) => jsonFetch<{ id: string }>(`/api/tasks/${id}/runs`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(options),
});
export const previewTaskScope = (id: string, provider?: ProviderId) => jsonFetch<ScopePreview>(`/api/tasks/${id}/runs/preview`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider }),
});
export const acknowledgeRun = (id: string) => jsonFetch<{ ok: boolean }>(`/api/sessions/${id}/acknowledge`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ processStopped: true }),
});

export interface ProjectProfileState {
  project: ProjectRecord | null;
  revisions: ProfileRevision[];
  activeRevision: ProfileRevision | null;
  stale: boolean;
  changed: string[];
}

export const listProjectRecords = () => jsonFetch<ProjectRecord[]>("/api/project-records");
export const registerProjectRecord = (path: string) => jsonFetch<ProjectRecord>("/api/project-records", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }),
});
export const getProjectProfile = (root: string) => jsonFetch<ProjectProfileState>(`/api/project-profiles?root=${encodeURIComponent(root)}`);
export const saveProfileDraft = (root: string, entries?: ProfileEntry[], discover?: boolean) => jsonFetch<ProfileRevision>("/api/project-profiles/drafts", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ root, entries, discover }),
});
export const refreshProjectProfile = (root: string) => jsonFetch<ProfileRevision>("/api/project-profiles/refresh", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ root }),
});
export const editProfileDraft = (id: string, entries: ProfileEntry[]) => jsonFetch<ProfileRevision>(`/api/project-revisions/${id}`, {
  method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ entries }),
});
export const approveProfileRevision = (id: string) => jsonFetch<ProfileRevision>(`/api/project-revisions/${id}/approve`, { method: "POST" });
export const discardProfileRevision = (id: string) => jsonFetch<{ ok: boolean }>(`/api/project-revisions/${id}/discard`, { method: "POST" });
