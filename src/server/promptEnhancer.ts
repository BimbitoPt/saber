import { findDevServerForPath } from "./devServers";
import { reloadProjects } from "./projects";

export function projectUrlFor(workdir: string): string | null {
  const live = findDevServerForPath(workdir);
  if (live) return `http://localhost:${live.port}`;

  try {
    const project = reloadProjects().find((p) => workdir.startsWith(p.path));
    if (project?.port && project.port !== 8082) return `http://localhost:${project.port}`;
  } catch {
    /* inventory unreadable; no url */
  }
  return null;
}

export function enhance(task: string, workdir: string): string {
  const url = projectUrlFor(workdir);
  if (!url) return task;
  return `${task}

Verify your work before finishing:
1. Check ${url} serves HTTP 200 and renders correctly.
2. Confirm your change actually appears in the served output (screenshot or DOM proof).
3. If it fails, fix and re-verify. Do not report done without passing verification.`;
}
