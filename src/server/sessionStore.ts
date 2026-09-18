import type { ChildProcessWithoutNullStreams } from "node:child_process";

export type SessionStatus = "running" | "done" | "stopped" | "error";

export interface SessionRecord {
  id: string;
  project: string;
  task: string;
  status: SessionStatus;
  proc: ChildProcessWithoutNullStreams | null;
  eventCount: number;
  lines: string[];
  startedAt: number;
  endedAt?: number;
  exitCode: number | null;
}

const MAX_LINES = 2_000;

const sessions = new Map<string, SessionRecord>();

export function register(s: SessionRecord) {
  sessions.set(s.id, s);
}

export function get(id: string): SessionRecord | undefined {
  return sessions.get(id);
}

export function list(): Array<Omit<SessionRecord, "proc" | "lines">> {
  return [...sessions.values()]
    .map(({ proc, lines, ...rest }) => rest)
    .sort((a, b) => b.startedAt - a.startedAt);
}

export function pushLine(id: string, line: string) {
  const s = sessions.get(id);
  if (!s) return;
  s.eventCount++;
  s.lines.push(line);
  if (s.lines.length > MAX_LINES) {
    s.lines.splice(0, s.lines.length - MAX_LINES);
  }
}

export function linesSince(id: string, after: number): string[] {
  const s = sessions.get(id);
  if (!s) return [];
  return s.lines.slice(after);
}

export function setStatus(id: string, status: SessionStatus, exitCode: number | null = null) {
  const s = sessions.get(id);
  if (!s) return;
  s.status = status;
  s.endedAt = Date.now();
  s.exitCode = exitCode;
}
