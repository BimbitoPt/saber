import { getAgentRuns, type AgentRuns } from "./agentRuns";
import { getTerminalLocks, type TerminalLocks } from "./terminalLocks";
import type { TaskStore } from "./taskStore";

export type WorkspaceActiveCheck = (directory: string) => boolean;

export function workspaceActiveCheck(store: TaskStore, agentRuns: AgentRuns = getAgentRuns(), terminalLocks: TerminalLocks = getTerminalLocks()): WorkspaceActiveCheck {
  return (directory) => agentRuns.hasActiveWorkspace(directory) || terminalLocks.hasActiveWorkspace(store, directory);
}
