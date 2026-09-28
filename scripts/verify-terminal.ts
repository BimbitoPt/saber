import { spawnSync } from "node:child_process";

const checks: Array<[string, string[]]> = [
  ["cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml", "terminal_session", "--", "--nocapture"]],
  ["bun", ["run", "test", "--", "src/server/terminalLocks.test.ts", "src/server/agentRuns.test.ts", "src/lib/terminalRuntime.test.ts"]],
];

for (const [program, args] of checks) {
  const result = spawnSync(program, args, { stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
