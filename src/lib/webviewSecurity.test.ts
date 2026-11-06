import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WEBVIEW_CSP } from "./csp";

const root = join(import.meta.dirname, "..", "..");

describe("webview trust boundary", () => {
  it("keeps the terminal IPC capability scoped to the documented loopback origin", () => {
    const capability = JSON.parse(readFileSync(join(root, "src-tauri", "capabilities", "default.json"), "utf8")) as {
      windows: string[];
      remote?: { urls: string[] };
      permissions: string[];
    };
    // The packaged server binds an ephemeral port, so this glob is intentional;
    // the command-layer origin guard (src-tauri/src/origin.rs) is the boundary.
    expect(capability.remote?.urls).toEqual(["http://127.0.0.1:*"]);
    expect(capability.windows).toEqual(["main"]);
    const terminalPermissions = capability.permissions.filter((permission) => permission.startsWith("allow-terminal-"));
    expect(terminalPermissions).toEqual([
      "allow-terminal-start",
      "allow-terminal-write",
      "allow-terminal-resize",
      "allow-terminal-close",
      "allow-terminal-list",
    ]);
  });

  it("ships a restrictive document CSP with the app server", () => {
    expect(WEBVIEW_CSP).toContain("default-src 'self'");
    expect(WEBVIEW_CSP).toContain("object-src 'none'");
    expect(WEBVIEW_CSP).toContain("base-uri 'self'");
    expect(WEBVIEW_CSP).not.toContain("unsafe-eval");
    expect(WEBVIEW_CSP).not.toContain("*");
  });

  it("injects the CSP into the app document and gates every terminal command on the server origin", () => {
    const rootRoute = readFileSync(join(root, "src", "routes", "__root.tsx"), "utf8");
    expect(rootRoute).toContain('httpEquiv: "Content-Security-Policy"');
    const terminal = readFileSync(join(root, "src-tauri", "src", "terminal.rs"), "utf8");
    const commands = terminal.match(/pub fn (terminal_\w+)/g) ?? [];
    expect(commands).toHaveLength(5);
    const guards = terminal.match(/ensure_trusted_origin\(&webview, &origin\)\?;/g) ?? [];
    expect(guards).toHaveLength(5);
  });
});
