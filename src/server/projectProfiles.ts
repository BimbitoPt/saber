import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { ProfileEntry, ProfileRevision, ProjectRecord } from "../lib/tasks";
import { TaskStore } from "./taskStore";
import { canonicalizeProjectRoot } from "./workspaceIdentity";

export const PROFILE_CONTENT_LIMIT = 100_000;

export const DISCOVERY_ALLOWLIST = [
  "AGENTS.md",
  "CLAUDE.md",
  "README.md",
  "package.json",
  "tsconfig.json",
  "vite.config.ts",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
];

const DENIED_BASENAMES = new Set([
  "id_rsa",
  "id_ed25519",
  "id_ecdsa",
  "id_dsa",
  "credentials.json",
  "secrets.json",
  "secrets.yaml",
  "secrets.yml",
  "secrets.toml",
  "credentials.yaml",
  "credentials.yml",
  "credentials.toml",
  ".npmrc",
  ".pypirc",
  ".netrc",
  "_netrc",
  ".git-credentials",
  "kubeconfig",
]);

const DENIED_SEGMENTS = new Set([".ssh", ".aws", "secrets", "credentials"]);
const DENIED_EXTENSIONS = new Set([".pem", ".key", ".p12", ".pfx", ".jks"]);

export function toPosixRelative(path: string) {
  return path.split(sep).join("/");
}

export function isDeniedSourcePath(relativePosix: string) {
  const lower = relativePosix.toLowerCase();
  const segments = lower.split("/").filter(Boolean);
  const basename = segments.at(-1) ?? "";
  if (basename === ".env" || basename.startsWith(".env.") || basename.endsWith(".env") || basename === ".envrc") return true;
  if (segments.some((segment) => DENIED_SEGMENTS.has(segment))) return true;
  if (DENIED_BASENAMES.has(basename)) return true;
  if (basename.includes("secret") || basename.includes("credential") || basename.includes("private_key") || basename.includes("privatekey")) return true;
  const dot = basename.lastIndexOf(".");
  if (dot !== -1 && DENIED_EXTENSIONS.has(basename.slice(dot))) return true;
  return false;
}

function canonicalizeExisting(path: string) {
  const canonical = existsSync(path) ? realpathSync(path) : resolve(path);
  return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}

export function resolveProjectSource(projectRoot: string, sourceRef: string) {
  const rootCanonical = canonicalizeProjectRoot(projectRoot);
  const rootReal = canonicalizeExisting(projectRoot);
  const absolute = sourceRef && (sourceRef.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(sourceRef))
    ? resolve(sourceRef)
    : resolve(projectRoot, sourceRef);
  const absoluteCanonical = canonicalizeExisting(absolute);
  const prefix = rootReal.endsWith(sep) ? rootReal : rootReal + sep;
  const inside = absoluteCanonical !== rootReal && absoluteCanonical.startsWith(prefix);
  if (!inside) throw new Error("Source is outside the registered project");
  const relativePosix = toPosixRelative(relative(resolve(projectRoot), absolute)).replace(/\\/g, "/");
  if (!relativePosix || relativePosix.startsWith("..")) throw new Error("Source is outside the registered project");
  if (isDeniedSourcePath(relativePosix)) throw new Error("Source is secret-bearing and cannot be stored");
  return { absolute, relativePosix, rootCanonical };
}

export function hashContent(content: string | Buffer) {
  return createHash("sha256").update(content).digest("hex");
}

export function hashFile(absolute: string) {
  return hashContent(readFileSync(absolute));
}

function validateEntries(entries: ProfileEntry[], projectRoot: string): ProfileEntry[] {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("At least one profile entry is required");
  if (entries.length > 200) throw new Error("Too many profile entries");
  const seen = new Set<string>();
  return entries.map((entry) => {
    if (!entry || typeof entry.key !== "string" || !entry.key.trim()) throw new Error("Entry key is required");
    if (entry.key.length > 200) throw new Error("Entry key is too long");
    if (seen.has(entry.key)) throw new Error(`Duplicate entry key: ${entry.key}`);
    seen.add(entry.key);
    if (entry.origin !== "repository" && entry.origin !== "user") throw new Error(`Invalid origin for entry ${entry.key}`);
    if (typeof entry.content !== "string") throw new Error(`Invalid content for entry ${entry.key}`);
    if (entry.content.length > PROFILE_CONTENT_LIMIT) throw new Error(`Entry ${entry.key} is too long`);
    if (entry.origin === "repository") {
      if (typeof entry.sourcePath !== "string" || !entry.sourcePath.trim()) throw new Error(`Entry ${entry.key} requires a source path`);
      const { relativePosix } = resolveProjectSource(projectRoot, entry.sourcePath.trim());
      return { key: entry.key, origin: entry.origin, sourcePath: relativePosix, content: entry.content };
    }
    if (typeof entry.author !== "string" || !entry.author.trim()) throw new Error(`Entry ${entry.key} requires an author`);
    if (entry.author.length > 200) throw new Error(`Author for entry ${entry.key} is too long`);
    if (entry.sourcePath !== undefined) resolveProjectSource(projectRoot, entry.sourcePath);
    return { key: entry.key, origin: entry.origin, author: entry.author.trim(), content: entry.content };
  });
}

export class ProjectProfiles {
  constructor(private store: TaskStore) {}

  registerProject(root: string, displayName?: string): ProjectRecord {
    return this.store.registerProject(root, displayName);
  }

  requireProject(root: string): ProjectRecord {
    const project = this.store.getProject(root);
    if (!project) throw new Error("Project not found");
    return project;
  }

  buildDiscoveryEntries(root: string): ProfileEntry[] {
    const project = this.requireProject(root);
    const entries: ProfileEntry[] = [];
    for (const candidate of DISCOVERY_ALLOWLIST) {
      const absolute = join(project.root, ...candidate.split("/"));
      let stat: ReturnType<typeof statSync> | undefined;
      try {
        stat = statSync(absolute);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      if (isDeniedSourcePath(candidate.toLowerCase())) continue;
      const raw = readFileSync(absolute, "utf8");
      entries.push({
        key: candidate,
        origin: "repository",
        sourcePath: candidate,
        content: raw.length > PROFILE_CONTENT_LIMIT ? raw.slice(0, PROFILE_CONTENT_LIMIT) : raw,
      });
    }
    return entries;
  }

  saveDraft(root: string, entries: ProfileEntry[]): ProfileRevision {
    const project = this.requireProject(root);
    const validated = validateEntries(entries, project.root);
    const now = Date.now();
    const revision: ProfileRevision = {
      id: crypto.randomUUID(),
      projectRoot: project.root,
      entries: validated,
      sourceHashes: {},
      state: "draft",
      createdAt: now,
      updatedAt: now,
    };
    return this.store.createProfileRevision(revision);
  }

  discoverDraft(root: string): ProfileRevision {
    return this.saveDraft(root, this.buildDiscoveryEntries(root));
  }

  refreshProject(root: string): ProfileRevision {
    const entries = this.buildDiscoveryEntries(root);
    return this.saveDraft(root, entries);
  }

  editDraft(id: string, entries: ProfileEntry[]): ProfileRevision {
    const existing = this.store.getProfileRevision(id);
    if (!existing) throw new Error("Revision not found");
    if (existing.state !== "draft") throw new Error("Only draft revisions can be edited");
    const project = this.requireProject(existing.projectRoot);
    const validated = validateEntries(entries, project.root);
    return this.store.writeProfileRevision({ ...existing, entries: validated, updatedAt: Date.now() });
  }

  discardDraft(id: string) {
    const existing = this.store.getProfileRevision(id);
    if (!existing) throw new Error("Revision not found");
    if (existing.state !== "draft") throw new Error("Only draft revisions can be discarded");
    const project = this.store.getProject(existing.projectRoot);
    if (project?.activeRevisionId === existing.id) throw new Error("Cannot discard the active revision");
    this.store.deleteProfileRevision(id);
  }

  approveRevision(id: string): ProfileRevision {
    const existing = this.store.getProfileRevision(id);
    if (!existing) throw new Error("Revision not found");
    if (existing.state !== "draft") throw new Error("Only draft revisions can be approved");
    const project = this.requireProject(existing.projectRoot);
    const validated = validateEntries(existing.entries, project.root);
    const sourceHashes: Record<string, string> = {};
    for (const entry of validated) {
      if (entry.origin !== "repository" || !entry.sourcePath) continue;
      const { absolute } = resolveProjectSource(project.root, entry.sourcePath);
      if (!existsSync(absolute) || !statSync(absolute).isFile()) throw new Error(`Source is missing: ${entry.sourcePath}`);
      sourceHashes[entry.sourcePath] = hashFile(absolute);
    }
    const now = Date.now();
    const approved: ProfileRevision = {
      ...existing,
      entries: validated,
      sourceHashes,
      state: "approved",
      updatedAt: now,
      approvedAt: now,
    };
    const written = this.store.writeProfileRevision(approved);
    this.store.setProjectActiveRevision(project.root, written.id);
    return written;
  }

  getRevision(id: string): ProfileRevision | undefined {
    return this.store.getProfileRevision(id);
  }

  listRevisions(root: string): ProfileRevision[] {
    const project = this.requireProject(root);
    return this.store.listProfileRevisions(project.root);
  }

  getActiveRevision(root: string): ProfileRevision | undefined {
    const project = this.requireProject(root);
    if (!project.activeRevisionId) return undefined;
    return this.store.getProfileRevision(project.activeRevisionId);
  }

  checkStaleness(id: string): { stale: boolean; changed: string[] } {
    const revision = this.store.getProfileRevision(id);
    if (!revision) throw new Error("Revision not found");
    const changed: string[] = [];
    for (const entry of revision.entries) {
      if (entry.origin !== "repository" || !entry.sourcePath) continue;
      let current: string | undefined;
      try {
        const { absolute } = resolveProjectSource(revision.projectRoot, entry.sourcePath);
        current = existsSync(absolute) ? hashFile(absolute) : undefined;
      } catch {
        current = undefined;
      }
      if (current !== revision.sourceHashes[entry.sourcePath]) changed.push(entry.sourcePath);
    }
    return { stale: changed.length > 0, changed };
  }

  readSource(root: string, sourceRef: string): string {
    const project = this.requireProject(root);
    const { absolute } = resolveProjectSource(project.root, sourceRef);
    return readFileSync(absolute, "utf8");
  }
}
