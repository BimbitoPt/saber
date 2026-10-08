import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { TaskStore } from "./taskStore";
import { ProjectProfiles } from "./projectProfiles";

const directories: string[] = [];
const stores: TaskStore[] = [];

function setupProject(files: Record<string, string> = {}) {
  const base = mkdtempSync(join(tmpdir(), "saber-profile-"));
  directories.push(base);
  const projectRoot = join(base, "project");
  mkdirSync(projectRoot, { recursive: true });
  for (const [relative, content] of Object.entries(files)) {
    const absolute = join(projectRoot, ...relative.split("/"));
    mkdirSync(absolute.slice(0, absolute.lastIndexOf(sep)), { recursive: true });
    writeFileSync(absolute, content);
  }
  const dbPath = join(base, "tasks.sqlite");
  const store = new TaskStore(dbPath);
  stores.push(store);
  const profiles = new ProjectProfiles(store);
  return { base, projectRoot, dbPath, store, profiles };
}

function reopen(dbPath: string) {
  const store = new TaskStore(dbPath);
  stores.push(store);
  return { store, profiles: new ProjectProfiles(store) };
}

afterEach(() => {
  for (const store of stores.splice(0)) {
    try {
      store.close();
    } catch {}
  }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("project profiles", () => {
  it("persists project record and approved profile across SQLite reopen", () => {
    const { projectRoot, dbPath, store, profiles } = setupProject({
      "AGENTS.md": "# Instructions",
      "package.json": JSON.stringify({ name: "demo" }),
    });
    profiles.registerProject(projectRoot, "Demo");
    const draft = profiles.discoverDraft(projectRoot);
    expect(draft.state).toBe("draft");
    expect(draft.entries.map((entry) => entry.sourcePath).sort()).toEqual(["AGENTS.md", "package.json"]);
    const approved = profiles.approveRevision(draft.id);
    expect(approved.state).toBe("approved");
    expect(Object.keys(approved.sourceHashes).sort()).toEqual(["AGENTS.md", "package.json"]);
    store.close();

    const next = reopen(dbPath);
    expect(next.store.getProject(projectRoot)?.displayName).toBe("Demo");
    expect(next.profiles.getActiveRevision(projectRoot)?.id).toBe(approved.id);
    expect(next.profiles.getActiveRevision(projectRoot)?.entries).toEqual(approved.entries);
    expect(next.profiles.listRevisions(projectRoot)).toHaveLength(1);
  });

  it("accepts valid sources and rejects invalid, out-of-project, and secret-bearing sources", () => {
    const { projectRoot, profiles } = setupProject({
      "AGENTS.md": "ok",
      ".env": "SECRET=top-secret-value",
      "keys/deploy.pem": "private",
    });
    const sibling = join(projectRoot, "..", "sibling");
    mkdirSync(sibling, { recursive: true });
    writeFileSync(join(sibling, "other.txt"), "outside");
    profiles.registerProject(projectRoot);

    const valid = profiles.saveDraft(projectRoot, [
      { key: "notes", origin: "repository", sourcePath: "AGENTS.md", content: "ok" },
      { key: "decision", origin: "user", author: "guilherme", content: "use sqlite" },
    ]);
    expect(valid.entries).toHaveLength(2);

    expect(() => profiles.saveDraft(projectRoot, [
      { key: "outside", origin: "repository", sourcePath: join(sibling, "other.txt"), content: "x" },
    ])).toThrow("outside the registered project");
    expect(() => profiles.saveDraft(projectRoot, [
      { key: "traversal", origin: "repository", sourcePath: "../sibling/other.txt", content: "x" },
    ])).toThrow("outside the registered project");
    expect(() => profiles.saveDraft(projectRoot, [
      { key: "env", origin: "repository", sourcePath: ".env", content: "x" },
    ])).toThrow("secret-bearing");
    expect(() => profiles.saveDraft(projectRoot, [
      { key: "key", origin: "repository", sourcePath: "keys/deploy.pem", content: "x" },
    ])).toThrow("secret-bearing");
    expect(() => profiles.saveDraft(projectRoot, [
      { key: "creds", origin: "repository", sourcePath: "credentials.json", content: "x" },
    ])).toThrow("secret-bearing");
    expect(() => profiles.saveDraft(projectRoot, [
      { key: "key2", origin: "repository", sourcePath: "id_rsa", content: "x" },
    ])).toThrow("secret-bearing");
    expect(() => profiles.readSource(projectRoot, ".env")).toThrow("secret-bearing");
    expect(() => profiles.readSource(projectRoot, join(sibling, "other.txt"))).toThrow("outside the registered project");
  });

  it("never interpolates environment values into stored content", () => {
    process.env.SABER_TEST_PROFILE_SECRET = "super-secret-env-value-12345";
    const { projectRoot, profiles } = setupProject({
      "AGENTS.md": "literal $SABER_TEST_PROFILE_SECRET and ${SABER_TEST_PROFILE_SECRET} stay literal",
    });
    profiles.registerProject(projectRoot);
    const draft = profiles.discoverDraft(projectRoot);
    expect(draft.entries[0].content).toContain("$SABER_TEST_PROFILE_SECRET");
    expect(draft.entries[0].content).not.toContain("super-secret-env-value-12345");
    delete process.env.SABER_TEST_PROFILE_SECRET;
  });

  it("supports editing a draft and discarding a rejected draft", () => {
    const { projectRoot, profiles } = setupProject({ "AGENTS.md": "v1" });
    profiles.registerProject(projectRoot);
    const draft = profiles.saveDraft(projectRoot, [
      { key: "a", origin: "user", author: "guilherme", content: "first" },
    ]);
    const edited = profiles.editDraft(draft.id, [
      { key: "a", origin: "user", author: "guilherme", content: "second" },
      { key: "b", origin: "repository", sourcePath: "AGENTS.md", content: "v1" },
    ]);
    expect(edited.entries).toHaveLength(2);
    expect(edited.entries.find((entry) => entry.key === "a")?.content).toBe("second");

    profiles.discardDraft(draft.id);
    expect(profiles.getRevision(draft.id)).toBeUndefined();
    expect(profiles.listRevisions(projectRoot)).toHaveLength(0);
    expect(() => profiles.editDraft(draft.id, [])).toThrow("Revision not found");
  });

  it("keeps prior approved revisions immutable and readable after approval moves only the active pointer", () => {
    const { projectRoot, profiles } = setupProject({ "AGENTS.md": "v1" });
    profiles.registerProject(projectRoot);
    const first = profiles.approveRevision(profiles.saveDraft(projectRoot, [
      { key: "a", origin: "repository", sourcePath: "AGENTS.md", content: "v1" },
    ]).id);
    const firstSnapshot = JSON.parse(JSON.stringify(first));
    writeFileSync(join(projectRoot, "AGENTS.md"), "v2");
    const second = profiles.approveRevision(profiles.saveDraft(projectRoot, [
      { key: "a", origin: "repository", sourcePath: "AGENTS.md", content: "v2" },
    ]).id);

    expect(second.id).not.toBe(first.id);
    expect(profiles.requireProject(projectRoot).activeRevisionId).toBe(second.id);
    const reread = profiles.getRevision(first.id)!;
    expect(reread).toEqual(firstSnapshot);
    expect(reread.state).toBe("approved");
    expect(profiles.listRevisions(projectRoot).map((revision) => revision.id).sort()).toEqual([first.id, second.id].sort());
    expect(() => profiles.editDraft(first.id, first.entries)).toThrow("Only draft");
    expect(() => profiles.discardDraft(first.id)).toThrow("Only draft");
  });

  it("surfaces a stale flag after source change without rewriting the active revision", () => {
    const { projectRoot, profiles } = setupProject({ "AGENTS.md": "original", "package.json": "{}" });
    profiles.registerProject(projectRoot);
    const approved = profiles.approveRevision(profiles.discoverDraft(projectRoot).id);
    expect(profiles.checkStaleness(approved.id)).toEqual({ stale: false, changed: [] });
    const before = readFileSync(join(projectRoot, "AGENTS.md"), "utf8");

    writeFileSync(join(projectRoot, "AGENTS.md"), "changed content");
    const status = profiles.checkStaleness(approved.id);
    expect(status.stale).toBe(true);
    expect(status.changed).toEqual(["AGENTS.md"]);

    const reread = profiles.getRevision(approved.id)!;
    expect(reread.entries.find((entry) => entry.sourcePath === "AGENTS.md")?.content).toBe(before);
    expect(reread.sourceHashes["AGENTS.md"]).toBe(approved.sourceHashes["AGENTS.md"]);

    const refreshed = profiles.refreshProject(projectRoot);
    expect(refreshed.state).toBe("draft");
    expect(refreshed.entries.find((entry) => entry.sourcePath === "AGENTS.md")?.content).toBe("changed content");
  });

  it("recovers projects, drafts, and active pointer after restart and decodes absent optional fields", () => {
    const { projectRoot, dbPath, store, profiles } = setupProject({ "AGENTS.md": "keep" });
    profiles.registerProject(projectRoot);
    const approved = profiles.approveRevision(profiles.saveDraft(projectRoot, [
      { key: "a", origin: "user", author: "guilherme", content: "stable" },
    ]).id);
    const pending = profiles.saveDraft(projectRoot, [
      { key: "b", origin: "user", author: "guilherme", content: "pending" },
    ]);
    store.close();

    const next = reopen(dbPath);
    expect(next.store.listProjects()).toHaveLength(1);
    expect(next.profiles.getActiveRevision(projectRoot)?.id).toBe(approved.id);
    expect(next.profiles.getRevision(pending.id)?.state).toBe("draft");

    const legacy = next.store.createProfileRevision({
      id: "legacy-revision",
      projectRoot,
      entries: [{ key: "old", origin: "user", author: "guilherme", content: "legacy" }],
    } as never);
    expect(legacy.sourceHashes).toEqual({});
    expect(legacy.state).toBe("draft");
    expect(legacy.approvedAt).toBeUndefined();
    expect(next.store.getProject(projectRoot)?.activeRevisionId).toBe(approved.id);
  });
});
