export type TerminalRuntime = { __TAURI_INTERNALS__?: unknown } | undefined;

export function isTerminalRuntimeAvailable(runtime: TerminalRuntime): boolean {
  return Boolean(runtime?.__TAURI_INTERNALS__);
}
