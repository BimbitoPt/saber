import { realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { reloadProjects } from "../projects";

export function resolveWorkdir(projectRef: string): string {
  const looksLikePath = projectRef.includes("\\") || projectRef.includes("/");
  const path = looksLikePath ? projectRef : reloadProjects().find((p) => p.name === projectRef)?.path;
  if (!path || !isAbsolute(path)) throw new Error("Choose an absolute project directory");
  const canonical = realpathSync(path);
  if (!statSync(canonical).isDirectory()) throw new Error("Project path must be a directory");
  return canonical;
}
