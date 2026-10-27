import { describeError } from "../lib/error-capture";
import { reconcileDevServers, stopAllDevServers } from "./devServers";
import { shutdown as browserShutdown } from "./browser";

// The server process owns the dev-server children and the verification browser, so
// both are torn down here: stop dev servers, then the browser, as the spec orders it.
export interface ShutdownDeps {
  reconcile(): string[];
  stopAll(): Promise<void>;
  shutdownBrowser(): Promise<void>;
}

const defaultShutdownDeps: ShutdownDeps = {
  reconcile: reconcileDevServers,
  stopAll: stopAllDevServers,
  shutdownBrowser: browserShutdown,
};

let shutdownOnce: Promise<void> | undefined;

async function runShutdown(deps: ShutdownDeps): Promise<void> {
  try {
    deps.reconcile();
  } catch (error) {
    console.error(describeError(error));
  }
  try {
    await deps.stopAll();
  } catch (error) {
    console.error(describeError(error));
  }
  try {
    await deps.shutdownBrowser();
  } catch (error) {
    console.error(describeError(error));
  }
}

export function shutdownResources(deps: ShutdownDeps = defaultShutdownDeps): Promise<void> {
  if (deps !== defaultShutdownDeps) return runShutdown(deps);
  // Deduplicate concurrent shutdowns, but let a later one run again: a dev server
  // started after an earlier shutdown must still be stopped by the next one.
  shutdownOnce ??= runShutdown(deps).finally(() => {
    shutdownOnce = undefined;
  });
  return shutdownOnce;
}

const shutdownRegistry = globalThis as typeof globalThis & { saberShutdownHooked?: boolean };

export function registerShutdownHooks(): void {
  // Node re-evaluates this entry on dev reloads, so the guard lives on globalThis.
  if (shutdownRegistry.saberShutdownHooked) return;
  shutdownRegistry.saberShutdownHooked = true;
  const handle = () => {
    void shutdownResources().finally(() => {
      // Installing a listener replaces the default terminate, so exit explicitly.
      process.exit(0);
    });
  };
  process.once("SIGINT", handle);
  process.once("SIGTERM", handle);
}
