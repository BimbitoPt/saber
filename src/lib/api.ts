export interface Project {
  name: string;
  path: string;
  port?: number;
}

export interface SessionListItem {
  id: string;
  project: string;
  task: string;
  status: "running" | "done" | "stopped" | "error";
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

export interface EventsSnapshot {
  status: "running" | "done" | "stopped" | "error";
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
