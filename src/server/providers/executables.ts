import { existsSync, readdirSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { homedir } from "node:os";
import { execFile, spawn } from "node:child_process";
import type { ProviderId, ProviderStatus } from "../../lib/tasks";
import type { SpawnOptions } from "./types";
import { getProvider } from "./index";

export function findExecutable(id: ProviderId): string | undefined {
  const executable = process.platform === "win32" ? `${id}.exe` : id;
  const candidates = (process.env.PATH ?? "").split(delimiter).filter(Boolean).map((directory) => join(directory.replace(/^"|"$/g, ""), executable));
  if (id === "opencode") candidates.unshift(join(process.env.APPDATA ?? "", "npm", "node_modules", "opencode-ai", "bin", executable), join(process.env.LOCALAPPDATA ?? "", "Programs", "opencode", executable));
  if (id === "claude") candidates.unshift(join(homedir(), ".local", "bin", executable));
  if (id === "codex") {
    const root = join(process.env.LOCALAPPDATA ?? "", "OpenAI", "Codex", "bin");
    try {
      const versions = readdirSync(root).map((name) => join(root, name, executable)).filter(existsSync)
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
      candidates.push(...versions);
    } catch {}
  }
  return candidates.find((path) => { try { return statSync(path).isFile(); } catch { return false; } });
}

export function spawnNative(id: ProviderId, args: string[], opts: SpawnOptions) {
  const executable = findExecutable(id);
  if (!executable) throw new Error(`${id} is not installed or its native executable is not on PATH.`);
  return spawn(executable, args, { cwd: opts.workdir, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
}

export async function providerStatus(id: ProviderId, locate = findExecutable): Promise<ProviderStatus> {
  const executable = locate(id);
  const contextBudget = { ...getProvider(id).contextBudget };
  if (!executable) return { id, installed: false, auth: "unknown", message: `Install ${id} and make its native executable available on PATH.`, contextBudget };
  if (id === "opencode") return { id, installed: true, auth: "unknown", message: "Installed. Authentication depends on your selected OpenCode model.", contextBudget };
  if (id === "codex" && process.env.CODEX_API_KEY) return { id, installed: true, auth: "unknown", message: "An API key is configured. Its validity will be checked at launch.", contextBudget };
  return new Promise((resolve) => {
    execFile(executable, id === "codex" ? ["login", "status"] : ["auth", "status"], { timeout: 8000, windowsHide: true, maxBuffer: 64 * 1024 }, (error, stdout, stderr) => {
      let auth: ProviderStatus["auth"] = "unknown";
      if (!(error as NodeJS.ErrnoException & { killed?: boolean } | null)?.killed) {
        if (id === "codex") {
          const output = `${stdout}\n${stderr}`;
          if (!error && /logged in/i.test(output)) auth = "ready";
          else if (/not logged in/i.test(output)) auth = "signed-out";
        } else {
          try {
            const status = JSON.parse(stdout) as { loggedIn?: boolean };
            if (status.loggedIn === true) auth = "ready";
            if (status.loggedIn === false) auth = "signed-out";
          } catch {}
        }
      }
      resolve({ id, installed: true, auth, message: auth === "ready" ? "Signed in and ready."
        : auth === "signed-out" ? `Sign in from your terminal with ${id === "codex" ? "codex login" : "claude auth login"}, then refresh providers.`
        : "Installed. Authentication could not be confirmed; launch errors will appear in run history.", contextBudget });
    });
  });
}
