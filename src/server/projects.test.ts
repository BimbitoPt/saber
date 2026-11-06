import { afterEach, describe, it, expect } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseProjects, projectsFile, tokenPath } from "./projects";

const savedEnv: Record<string, string | undefined> = {};

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    delete savedEnv[key];
  }
});

function withEnv(key: string, value: string | undefined) {
  savedEnv[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe("tokenPath", () => {
  it("expands %USERPROFILE%", () => {
    expect(tokenPath("%USERPROFILE%\\Desktop\\Automaçao")).toBe(
      `${homedir()}\\Desktop\\Automaçao`,
    );
  });
});

describe("projectsFile", () => {
  it("prefers the SABER_PROJECTS_FILE override", () => {
    withEnv("SABER_PROJECTS_FILE", "/tmp/my-projects.json");
    expect(projectsFile()).toBe("/tmp/my-projects.json");
  });

  it("falls back to the legacy Desktop inventory when no Saber inventory exists", () => {
    withEnv("SABER_PROJECTS_FILE", undefined);
    const saberFile = join(homedir(), ".saber", "projects.json");
    if (saberFile === projectsFile()) {
      expect(projectsFile()).toBe(saberFile);
    } else {
      expect(projectsFile()).toBe(join(homedir(), "Desktop", "mstudio-os", "projects.json"));
    }
  });
});

describe("parseProjects", () => {
  it("keeps valid entries and drops malformed ones", () => {
    const projects = parseProjects(JSON.stringify([
      { name: "saber", path: "C:\\code\\saber", port: 8082 },
      { name: "", path: "C:\\code\\x" },
      { path: "C:\\code\\y" },
      { name: "no-port", path: "~/code/z", port: "bad" },
      "junk",
      null,
    ]));
    expect(projects).toEqual([
      { name: "saber", path: "C:\\code\\saber", port: 8082 },
      { name: "no-port", path: "~/code/z", port: undefined },
    ]);
  });

  it("rejects a non-array inventory", () => {
    expect(() => parseProjects(JSON.stringify({ name: "saber" }))).toThrow("JSON array");
    expect(() => parseProjects("not json")).toThrow();
  });
});
