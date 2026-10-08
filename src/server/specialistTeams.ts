import type { PlannedTeamMember, ProviderId, SpecialistRole, TaskRecord, TeamPlan, TeamRecord } from "../lib/tasks";
import { TaskStore, getTaskStore } from "./taskStore";
import type { AgentProvider } from "./providers/types";
import { getProvider } from "./providers";
import { AgentRuns } from "./agentRuns";
import { GitWorkspaceService, taskSourceRoot } from "./gitWorkspaces";
import { TerminalLocks, getTerminalLocks } from "./terminalLocks";
import { workspacesOverlap } from "./workspaceIdentity";

export const KNOWN_PROVIDERS: ProviderId[] = ["opencode", "codex", "claude"];
export const MAX_TEAM_SIZE = 4;
export const ROLE_ID_LIMIT = 100;
export const ROLE_TEXT_LIMIT = 100_000;

export interface RoleInput {
  id?: unknown;
  displayName?: unknown;
  instructions?: unknown;
  write?: unknown;
  providers?: unknown;
}

export interface RolePatch {
  displayName?: unknown;
  instructions?: unknown;
  write?: unknown;
  providers?: unknown;
  enabled?: unknown;
}

export interface MemberSelection {
  role?: unknown;
  provider?: unknown;
  model?: unknown;
}

export class SpecialistTeams {
  private agentRunsInstance?: AgentRuns;
  private workspacesInstance?: GitWorkspaceService;

  constructor(
    private store: TaskStore,
    private provider: (name?: ProviderId) => AgentProvider = getProvider,
    private terminalLocks: TerminalLocks = getTerminalLocks(),
  ) {}

  private runs() {
    return this.agentRunsInstance ??= new AgentRuns(this.store, this.provider, undefined, this.terminalLocks);
  }

  private git() {
    return this.workspacesInstance ??= new GitWorkspaceService(this.store, (path) => this.runs().hasActiveWorkspace(path));
  }

  withServices(agentRuns: AgentRuns, workspaces: GitWorkspaceService) {
    this.agentRunsInstance = agentRuns;
    this.workspacesInstance = workspaces;
    return this;
  }

  providerFor(name?: ProviderId): AgentProvider {
    return this.provider(name);
  }

  private requireProject(root: string) {
    const project = this.store.getProject(root);
    if (!project) throw new Error("Project not found");
    return project;
  }

  listRoles(root: string): SpecialistRole[] {
    const project = this.requireProject(root);
    const roles = this.store.listRoles(project.root);
    if (roles.length > 0 || !project.activeRevisionId) return roles;
    const now = Date.now();
    const seeds: SpecialistRole[] = [
      {
        id: "implementer", projectRoot: project.root, displayName: "Implementer",
        instructions: "Implement the task specification in the workspace and report verification per acceptance criterion.",
        write: true, providers: [...KNOWN_PROVIDERS],
        basedOnProfileRevisionId: project.activeRevisionId, enabled: true, createdAt: now, updatedAt: now,
      },
      {
        id: "reviewer", projectRoot: project.root, displayName: "Reviewer",
        instructions: "Review the workspace changes without modifying files and report findings per acceptance criterion.",
        write: false, providers: ["claude", "codex"],
        basedOnProfileRevisionId: project.activeRevisionId, enabled: true, createdAt: now, updatedAt: now,
      },
    ];
    return seeds.map((role) => this.store.createRole(role));
  }

  createRole(root: string, input: RoleInput): SpecialistRole {
    const project = this.requireProject(root);
    const id = typeof input.id === "string" ? input.id.trim() : "";
    if (!id) throw new Error("Role ID is required");
    if (id.length > ROLE_ID_LIMIT) throw new Error("Role ID is too long");
    if (typeof input.displayName !== "string" || !input.displayName.trim()) throw new Error("Role display name is required");
    if (typeof input.instructions !== "string" || !input.instructions.trim()) throw new Error("Role instructions are required");
    if (input.instructions.length > ROLE_TEXT_LIMIT) throw new Error("Role instructions are too long");
    if (typeof input.write !== "boolean") throw new Error("Role write flag is required");
    const providers = this.requireProviders(input.providers);
    const now = Date.now();
    return this.store.createRole({
      id, projectRoot: project.root, displayName: input.displayName.trim(), instructions: input.instructions,
      write: input.write, providers, basedOnProfileRevisionId: project.activeRevisionId,
      enabled: true, createdAt: now, updatedAt: now,
    });
  }

  updateRole(root: string, id: string, patch: RolePatch): SpecialistRole {
    const project = this.requireProject(root);
    const existing = this.store.getRole(project.root, id);
    if (!existing) throw new Error("Role not found");
    const updated: SpecialistRole = { ...existing };
    if (patch.displayName !== undefined) {
      if (typeof patch.displayName !== "string" || !patch.displayName.trim()) throw new Error("Role display name is required");
      updated.displayName = patch.displayName.trim();
    }
    if (patch.instructions !== undefined) {
      if (typeof patch.instructions !== "string" || !patch.instructions.trim()) throw new Error("Role instructions are required");
      if (patch.instructions.length > ROLE_TEXT_LIMIT) throw new Error("Role instructions are too long");
      updated.instructions = patch.instructions;
    }
    if (patch.write !== undefined) {
      if (typeof patch.write !== "boolean") throw new Error("Role write flag is required");
      updated.write = patch.write;
    }
    if (patch.providers !== undefined) updated.providers = this.requireProviders(patch.providers);
    if (patch.enabled !== undefined) {
      if (typeof patch.enabled !== "boolean") throw new Error("Role enabled flag is required");
      updated.enabled = patch.enabled;
    }
    updated.updatedAt = Date.now();
    return this.store.writeRole(updated);
  }

  private requireProviders(value: unknown): ProviderId[] {
    if (!Array.isArray(value) || value.length === 0) throw new Error("At least one provider is required");
    for (const entry of value) {
      if (typeof entry !== "string" || !(KNOWN_PROVIDERS as string[]).includes(entry)) throw new Error(`Unknown provider: ${String(entry)}`);
    }
    return [...new Set(value as ProviderId[])];
  }

  planTeam(taskId: string, selections: MemberSelection[]): TeamPlan {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error("Task not found");
    const activeTeam = this.store.listTeams(taskId).find((team) => team.members.some((member) => {
      const run = this.store.getRun(member.runId);
      return !!run && (run.status === "running" || run.status === "interrupted");
    }));
    if (activeTeam) throw new Error("A team is already active for this task. Wait for its members or reconcile interrupted runs before launching another team.");
    if (!Array.isArray(selections) || selections.length === 0) throw new Error("Select at least one specialist role");
    if (selections.length > MAX_TEAM_SIZE) throw new Error(`Select at most ${MAX_TEAM_SIZE} specialist roles`);
    const projectRoot = task.workspace?.source ?? task.project;
    const project = this.store.getProject(projectRoot);
    if (!project?.activeRevisionId) throw new Error("Approve a project profile before launching a team");
    const roles = this.listRoles(project.root);
    const members: PlannedTeamMember[] = selections.map((selection) => {
      if (!selection || typeof selection.role !== "string" || !selection.role.trim()) throw new Error("Each member needs a role");
      if (typeof selection.provider !== "string" || !(KNOWN_PROVIDERS as string[]).includes(selection.provider)) {
        throw new Error(`Unknown provider: ${String(selection.provider)}`);
      }
      const provider = selection.provider as ProviderId;
      const role = roles.find((candidate) => candidate.id === selection.role);
      if (!role) throw new Error(`Role not found: ${selection.role}`);
      if (!role.enabled) throw new Error(`Role is disabled: ${selection.role}`);
      if (!role.providers.includes(provider)) throw new Error(`Role ${role.id} does not support provider ${provider}`);
      if (selection.model !== undefined && (typeof selection.model !== "string" || !selection.model.trim())) throw new Error("Invalid model");
      const readOnly = !role.write;
      if (readOnly && !this.provider(provider).readOnly.supported) {
        throw new Error(`Role ${role.id} cannot review with ${provider}: ${this.provider(provider).readOnly.reason ?? "read-only is unsupported"}`);
      }
      return { role, provider, model: typeof selection.model === "string" ? selection.model.trim() : undefined, readOnly };
    });
    if (members.some((member) => member.role.write) && !members.some((member) => member.role.id === "implementer" && member.role.enabled)) {
      throw new Error("Teams that edit files must include the implementer role");
    }
    const source = taskSourceRoot(task);
    this.terminalLocks.hydrate(this.store);
    if (this.terminalLocks.hasActiveWorkspace(source)) throw new Error("An interactive terminal owns this workspace. Close it before launching a team.");
    const conflict = this.store.listRuns().find((run) =>
      ["running", "interrupted"].includes(run.status) && workspacesOverlap(run.project, source));
    if (conflict) throw new Error(conflict.status === "interrupted"
      ? "An interrupted run owns this workspace. Confirm its old process has stopped before launching a team."
      : "Another run is already using this workspace. Wait or stop it before launching a team.");
    return { taskId, source, members };
  }

  launchTeam(taskId: string, selections: MemberSelection[]): TeamRecord {
    const plan = this.planTeam(taskId, selections);
    const runIds = plan.members.map(() => crypto.randomUUID());
    const reserved: string[] = [];
    try {
      for (const runId of runIds) {
        this.git().createRunWorktree(taskId, runId);
        reserved.push(runId);
      }
    } catch (error) {
      for (const runId of reserved) {
        try {
          this.git().removeRunWorktree(taskId, runId);
        } catch {
          // Preserve the original reservation failure.
        }
      }
      throw error;
    }
    const team = this.store.createTeam(taskId, plan.members.map((member, index) => ({
      role: member.role.id, provider: member.provider, model: member.model, runId: runIds[index],
    })));
    plan.members.forEach((member, index) => {
      const runId = runIds[index];
      const worktree = this.store.getRunWorktree(runId);
      if (!worktree) return;
      try {
        this.runs().start(taskId, {
          provider: member.provider, model: member.model,
          role: { id: member.role.id, instructions: member.role.instructions },
          workdir: worktree.path, readOnly: member.readOnly, runId,
        });
      } catch {
        // The run record (in error state) or its absence stays visible; member outcomes are never hidden.
      }
    });
    return team;
  }
}

const runtime = globalThis as typeof globalThis & { saberSpecialistTeams?: SpecialistTeams };

export function getSpecialistTeams() {
  return runtime.saberSpecialistTeams ??= new SpecialistTeams(getTaskStore());
}
