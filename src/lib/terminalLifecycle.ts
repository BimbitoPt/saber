import type { TerminalSessionRecord } from "./tasks";

function describe(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * What stopping a terminal session did to the persisted record and the workspace
 * lock.
 * - `released`: the native process is closed and the record is stopped.
 * - `still-running`: the native process is confirmed alive, so it keeps its lock.
 * - `interrupted`: the process is gone but the record could not be released; only
 *   the explicit recovery confirmation may unlock the workspace.
 * - `unresolved`: neither the process state nor the record could be read, so the
 *   lock is deliberately left in place and the caller must surface the failure.
 */
export type TerminalCloseOutcome =
  | { status: "released" }
  | { status: "still-running"; session?: TerminalSessionRecord }
  | { status: "interrupted"; session?: TerminalSessionRecord }
  | { status: "unresolved"; message: string };

export type TerminalCloseEffects = {
  close: (id: string) => Promise<void>;
  listLive: () => Promise<string[]>;
  reconcile: (liveSessionIds: string[]) => Promise<TerminalSessionRecord[]>;
  release: (id: string) => Promise<void>;
};

/**
 * Stop a terminal session on its confirmed exit (PROC-07). Only a confirmed
 * native close releases the lock: when `terminal_close` fails the record is
 * reconciled against the live pty list instead, so a pty that is still alive
 * keeps its lock and a pty that is gone becomes `interrupted`.
 */
export async function closeTerminalSession({
  id,
  close,
  listLive,
  reconcile,
  release,
}: { id: string } & TerminalCloseEffects): Promise<TerminalCloseOutcome> {
  try {
    await close(id);
  } catch (cause) {
    return reconcileFailedClose({ id, failure: describe(cause), listLive, reconcile });
  }
  try {
    await release(id);
  } catch (cause) {
    return {
      status: "unresolved",
      message: `Saber closed this shell but could not release the workspace lock: ${describe(cause)}`,
    };
  }
  return { status: "released" };
}

async function reconcileFailedClose({
  id,
  failure,
  listLive,
  reconcile,
}: {
  id: string;
  failure: string;
  listLive: () => Promise<string[]>;
  reconcile: (liveSessionIds: string[]) => Promise<TerminalSessionRecord[]>;
}): Promise<TerminalCloseOutcome> {
  let live: string[];
  try {
    live = await listLive();
  } catch (cause) {
    return {
      status: "unresolved",
      message: `Saber could not stop this shell and could not read the running shells (${failure}). The workspace stays locked: ${describe(cause)}`,
    };
  }
  let records: TerminalSessionRecord[];
  try {
    records = await reconcile(live);
  } catch (cause) {
    return {
      status: "unresolved",
      message: `Saber could not stop this shell and could not reconcile its record (${failure}). The workspace stays locked: ${describe(cause)}`,
    };
  }
  const session = records.find((record) => record.id === id);
  if (live.includes(id)) return { status: "still-running", session };
  if (session?.status === "interrupted") return { status: "interrupted", session };
  // No record, or a record that already stopped: nothing holds this workspace.
  return { status: "released" };
}

export type TerminalRecoveryOutcome =
  | { status: "recovered"; session: TerminalSessionRecord }
  | { status: "refused"; message: string };

/**
 * Recovering an interrupted session claims the old shell has stopped, so it is
 * refused while the id is still in the live pty list (PROC-08). A list that
 * cannot be read also refuses: without it the shell cannot be confirmed stopped.
 */
export async function canRecoverTerminal({
  id,
  listLive,
}: {
  id: string;
  listLive: () => Promise<string[]>;
}): Promise<{ allowed: true } | { allowed: false; message: string }> {
  let live: string[];
  try {
    live = await listLive();
  } catch (cause) {
    return {
      allowed: false,
      message: `Saber cannot confirm that this shell has stopped because the running shells could not be read: ${describe(cause)}`,
    };
  }
  if (live.includes(id)) {
    return {
      allowed: false,
      message: "This shell is still running. Stop it before recovering the terminal session.",
    };
  }
  return { allowed: true };
}

export async function recoverInterruptedTerminal({
  id,
  listLive,
  recover,
}: {
  id: string;
  listLive: () => Promise<string[]>;
  recover: (id: string) => Promise<TerminalSessionRecord>;
}): Promise<TerminalRecoveryOutcome> {
  const permission = await canRecoverTerminal({ id, listLive });
  if (!permission.allowed) return { status: "refused", message: permission.message };
  try {
    return { status: "recovered", session: await recover(id) };
  } catch (cause) {
    return { status: "refused", message: `Saber could not recover this terminal: ${describe(cause)}` };
  }
}
