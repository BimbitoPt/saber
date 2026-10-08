export type RunStatus = "running" | "done" | "stopped" | "error" | "interrupted";
export type ProviderId = "opencode" | "codex" | "claude";
export const providerLabels: Record<ProviderId, string> = { opencode: "OpenCode", codex: "Codex", claude: "Claude Code" };
export interface ContextBudget {
  maxPromptChars: number;
  supportsProfileContext: boolean;
}
export interface ReadOnlySupport {
  supported: boolean;
  args?: string[];
  reason?: string;
}
export interface ProviderStatus {
  id: ProviderId;
  installed: boolean;
  auth: "ready" | "signed-out" | "unknown";
  message: string;
  contextBudget?: ContextBudget;
}

export interface TaskRecord {
  id: string;
  project: string;
  title: string;
  spec: string;
  criteria: string;
  revision: number;
  context: string;
  draft: string;
  createdAt: number;
  updatedAt: number;
  workspace?: TaskWorkspaceRecord;
}

export interface TaskWorkspaceRecord {
  path: string;
  source: string;
  baseCommit: string;
  targetBranch: string;
  branch: string;
  state: "provisioning" | "ready" | "removed";
}

export type TerminalSessionStatus = "starting" | "running" | "interrupted" | "stopped";
export interface TerminalSessionRecord {
  id: string;
  taskId: string;
  workdir: string;
  status: TerminalSessionStatus;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
}

export interface WorkspaceReview {
  head: string;
  status: string;
  diff: string;
  branch: string;
}

export type VerificationOutcome = "passed" | "failed";
export interface AcceptanceCriterion { id: string; text: string }
export interface VerificationRecord {
  id: string;
  taskId: string;
  criterionId: string;
  criterionText: string;
  revision: number;
  outcome: VerificationOutcome;
  check: string;
  evidence: string;
  runId?: string;
  checkedAt: number;
}
export interface VerificationSummary {
  state: "needs_ids" | "invalid" | "incomplete" | "failed" | "verified";
  total: number;
  passed: number;
  failed: number;
  stale: number;
}

export type TaskInput = Pick<TaskRecord, "project" | "title" | "spec" | "criteria">;
export type TaskPatch = Partial<Pick<TaskRecord, "title" | "spec" | "criteria" | "context" | "draft">>;

export interface RunRecord {
  id: string;
  taskId: string;
  project: string;
  task: string;
  provider: ProviderId;
  model?: string;
  nativeSessionId?: string;
  specRevision: number;
  spec: string;
  criteria: string;
  context: string;
  profileRevisionId?: string;
  roleId?: string;
  roleInstructions?: string;
  contextSources?: string[];
  contextNotice?: string;
  status: RunStatus;
  eventCount: number;
  startedAt: number;
  endedAt?: number;
  exitCode: number | null;
}

export interface RunContextCapture {
  profileRevisionId?: string;
  roleId?: string;
  roleInstructions?: string;
  contextSources?: string[];
  contextNotice?: string;
}

export interface TaskSummary extends TaskRecord {
  latestRun?: RunRecord;
  verificationSummary?: VerificationSummary;
}

export interface ProjectRecord {
  root: string;
  displayName: string;
  createdAt: number;
  activeRevisionId?: string;
}

export type ProfileEntryOrigin = "repository" | "user";
export interface ProfileEntry {
  key: string;
  origin: ProfileEntryOrigin;
  sourcePath?: string;
  author?: string;
  content: string;
}

export type ProfileRevisionState = "draft" | "approved";
export interface ProfileRevision {
  id: string;
  projectRoot: string;
  entries: ProfileEntry[];
  sourceHashes: Record<string, string>;
  state: ProfileRevisionState;
  createdAt: number;
  updatedAt: number;
  approvedAt?: number;
}

export interface ScopePreviewSource {
  name: string;
  chars: number;
}

export interface ScopePreview {
  provider: ProviderId;
  sources: ScopePreviewSource[];
  totalChars: number;
  budget: number;
  verdict: "ok" | "oversized" | "unsupported" | "no-profile";
  notice?: string;
}

export interface SpecialistRole {
  id: string;
  projectRoot: string;
  displayName: string;
  instructions: string;
  write: boolean;
  providers: ProviderId[];
  basedOnProfileRevisionId?: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface TeamMemberSelection {
  role: string;
  provider: ProviderId;
  model?: string;
}

export interface TeamMemberRef extends TeamMemberSelection {
  runId: string;
}

export interface TeamRecord {
  id: string;
  taskId: string;
  members: TeamMemberRef[];
  createdAt: number;
}

export interface RunWorktreeRecord {
  runId: string;
  taskId: string;
  path: string;
  source: string;
  sourceBranch: string;
  baseCommit: string;
  branch: string;
  state: "ready" | "removed";
}

export interface PlannedTeamMember {
  role: SpecialistRole;
  provider: ProviderId;
  model?: string;
  readOnly: boolean;
}

export interface TeamPlan {
  taskId: string;
  source: string;
  members: PlannedTeamMember[];
}

export const runStatusLabel: Record<RunStatus, string> = {
  running: "Running",
  done: "Ready for review",
  stopped: "Stopped",
  error: "Failed",
  interrupted: "Interrupted",
};
