import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Project {
  name: string;
  path: string;
  port?: number;
}

export function tokenPath(p: string): string {
  return p.replace(/%USERPROFILE%/g, homedir());
}

export function projectsFile(): string {
  const override = process.env["SABER_PROJECTS_FILE"];
  if (override) return override;
  const saberFile = join(homedir(), ".saber", "projects.json");
  if (existsSync(saberFile)) return saberFile;
  return join(homedir(), "Desktop", "mstudio-os", "projects.json");
}

export function parseProjects(raw: string): Project[] {
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error("The projects inventory must be a JSON array");
  const projects: Project[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record["name"] !== "string" || !record["name"].trim()) continue;
    if (typeof record["path"] !== "string" || !record["path"].trim()) continue;
    const port = typeof record["port"] === "number" && Number.isInteger(record["port"]) && record["port"] > 0 ? record["port"] : undefined;
    projects.push({ name: record["name"], path: tokenPath(record["path"]), port });
  }
  return projects;
}

export function reloadProjects(): Project[] {
  return parseProjects(readFileSync(projectsFile(), "utf8"));
}
