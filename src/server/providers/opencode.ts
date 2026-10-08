import { spawn } from "node:child_process";
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SpawnOptions } from "./types";

const SHIM_DIR_CANDIDATES = [
  join(process.env["APPDATA"] ?? "", "npm", "node_modules", "opencode-ai", "bin", "opencode.exe"),
  join(process.env["LOCALAPPDATA"] ?? "", "Programs", "opencode", "opencode.exe"),
];

function resolveExe(): string {
  for (const candidate of SHIM_DIR_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  console.error("[mstudio-ade] opencode.exe not found in known locations; relying on PATH.");
  return "opencode";
}

export const OPENCODE_EXE = resolveExe();

export function buildArgs(opts: SpawnOptions): string[] {
  if (opts.session) {
    const args = ["run", "-s", opts.session, opts.task, "--format", "json", "--dir", opts.workdir];
    if (opts.model) args.push("--model", opts.model);
    return args;
  }
  const args = ["run", opts.task, "--format", "json", "--dir", opts.workdir];
  if (opts.model) args.push("--model", opts.model);
  return args;
}

export function opencodeProvider(): {
  name: string;
  contextBudget: { maxPromptChars: number; supportsProfileContext: boolean };
  args: typeof buildArgs;
  spawn(opts: SpawnOptions): ChildProcessByStdio<null, Readable, Readable>;
} {
  return {
    name: "opencode",
    contextBudget: { maxPromptChars: 200_000, supportsProfileContext: true },
    args: buildArgs,
    spawn(opts) {
      return spawn(OPENCODE_EXE, buildArgs(opts), {
        shell: false,
        cwd: opts.workdir,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    },
  };
}
