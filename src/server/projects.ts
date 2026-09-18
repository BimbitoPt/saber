import { readFileSync } from "node:fs";
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

export function reloadProjects(): Project[] {
  const inventory = join(homedir(), "Desktop", "mstudio-os", "projects.json");
  const raw = JSON.parse(readFileSync(inventory, "utf8")) as Array<Record<string, unknown>>;
  return raw.map((r) => ({
    name: String(r["name"]),
    path: tokenPath(String(r["path"])),
    port: typeof r["port"] === "number" ? r["port"] : undefined,
  }));
}
