import { StringDecoder } from "node:string_decoder";
import { execFile } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { statSync } from "node:fs";
import type { AgentProvider } from "./providers/types";
import { getProvider } from "./providers";
import { TaskStore, getTaskStore } from "./taskStore";
import { enhance } from "./promptEnhancer";
import { workspacesOverlap } from "./workspaceIdentity";
import { parseProviderEvent } from "./providers/events";
import type { ProviderId, TaskRecord } from "../lib/tasks";
import { taskWorkdir } from "./gitWorkspaces";
import { resolveProjectSource } from "./projectProfiles";
import { getTerminalLocks, type TerminalLocks } from "./terminalLocks";
import { formatOnyxSection, queryOnyxContext, type OnyxResolution } from "./onyxContext";

export const DEFAULT_ROLE_ID = "default";
export const DEFAULT_ROLE_INSTRUCTIONS = "Act as the project's implementing agent: follow the profile conventions and stack, verify each acceptance criterion with real checks, and report verification per criterion without merging or deploying.";

function isExistingDirectory(path: string) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export interface AssembledScope {
  prompt: string;
  model?: string;
  profileRevisionId?: string;
  roleId: string;
  roleInstructions: string;
  contextSources: string[];
  contextNotice?: string;
  onyxContextSha?: string;
  onyxProvenance?: "onyx" | "unavailable";
  onyxNotice?: string;
}

export interface ScopePreview {
  provider: ProviderId;
  sources: Array<{ name: string; chars: number }>;
  totalChars: number;
  budget: number;
  verdict: "ok" | "oversized" | "unsupported" | "no-profile";
  notice?: string;
}

export interface MemberRole {
  id: string;
  instructions: string;
}

export interface StartOptions {
  model?: string;
  followup?: string;
  provider?: ProviderId;
  role?: MemberRole;
  workdir?: string;
  readOnly?: boolean;
  runId?: string;
  onyx?: OnyxResolution;
}

export class AgentRuns {
  private active = new Map<string, ChildProcess>();
  private stopping = new Set<string>();

  constructor(private store: TaskStore, private provider: (name?: ProviderId) => AgentProvider = getProvider, private enhancePrompt = enhance, private terminalLocks: TerminalLocks = getTerminalLocks()) {}

  async start(taskId: string, options: StartOptions = {}) {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error("Task not found");
    const workdir = options.workdir ?? taskWorkdir(task);
    if (options.workdir && !isExistingDirectory(options.workdir)) throw new Error("Run workspace is not a directory");
    if (this.hasActiveWorkspace(workdir)) throw new Error("The previous process is still closing. Wait before launching again.");
    if (this.terminalLocks.hasActiveWorkspace(this.store, workdir)) throw new Error("An interactive terminal owns this workspace. Close it before launching an agent run.");
    const providerId = options.provider ?? "opencode";
    const adapter = this.provider(providerId);
    const previous = this.store.listRuns(taskId).find((run) => run.provider === providerId && run.project === workdir && run.nativeSessionId);
    if (options.followup && !previous) throw new Error(`No ${providerId} session was captured for this task. Start a new run with this provider first.`);
    const model = options.model?.trim() || (options.followup ? previous?.model : undefined);
    const role = options.role ?? { id: DEFAULT_ROLE_ID, instructions: DEFAULT_ROLE_INSTRUCTIONS };
    const onyx = options.onyx ?? await queryOnyxContext(task);
    const scope = this.assembleScope(task, workdir, adapter, model, options.followup, role, onyx);
    const run = this.store.createRun(task.id, scope.prompt, model, providerId, workdir, scope, options.runId);
    try {
      const child = adapter.spawn({ workdir, task: scope.prompt, model, readOnly: options.readOnly,
        session: options.followup ? previous?.nativeSessionId : undefined });
      this.active.set(run.id, child);
      const decoder = new StringDecoder("utf8");
      let pending = "";
      let providerFailed = false;
      const append = (line: string) => {
        if (!line.trim()) return;
        const parsed = parseProviderEvent(providerId, line);
        if (parsed.nativeSessionId) this.store.setNativeSession(run.id, parsed.nativeSessionId);
        providerFailed ||= parsed.failed;
        this.store.appendEvent(run.id, JSON.stringify({ type: "saber_event", provider: providerId, raw: line, items: parsed.items }));
      };
      child.stdout?.on("data", (data: Buffer) => {
        pending += decoder.write(data);
        let end: number;
        while ((end = pending.indexOf("\n")) !== -1) {
          append(pending.slice(0, end));
          pending = pending.slice(end + 1);
        }
        if (pending.length > 1_000_000) {
          append(JSON.stringify({ type: "provider_error", message: "Provider emitted an oversized incomplete line; output was truncated." }));
          pending = "";
        }
      });
      child.stderr?.on("data", (data: Buffer) => {
        this.store.appendEvent(run.id, JSON.stringify({ type: "provider_error", message: data.toString().slice(0, 16000) }));
      });
      child.on("error", (error) => {
        this.store.appendEvent(run.id, JSON.stringify({ type: "provider_error", message: error.message }));
        this.store.finishRun(run.id, "error", null);
      });
      child.on("close", (code) => {
        append(pending + decoder.end());
        pending = "";
        this.active.delete(run.id);
        const current = this.store.getRun(run.id);
        if (current?.status === "running") this.store.finishRun(run.id, this.stopping.has(run.id) ? "stopped" : code === 0 && !providerFailed ? "done" : "error", code);
        this.stopping.delete(run.id);
      });
    } catch (error) {
      this.store.appendEvent(run.id, JSON.stringify({ type: "provider_error", message: String(error) }));
      this.store.finishRun(run.id, "error", null);
      throw error;
    }
    return run.id;
  }

  private profileRevisionFor(task: TaskRecord) {
    const projectRoot = task.workspace?.source ?? task.project;
    const project = this.store.getProject(projectRoot);
    const activeId = project?.activeRevisionId;
    if (!activeId) return { revision: undefined };
    return { revision: this.store.getProfileRevision(activeId) };
  }

  private scopeParts(task: TaskRecord, role: MemberRole, followup?: string) {
    const { revision } = this.profileRevisionFor(task);
    const parts: Array<{ name: string; text: string }> = [
      { name: "task title and specification", text: [`Task: ${task.title}`, `Specification revision: ${task.revision}`, task.spec, `Acceptance criteria:\n${task.criteria}`].join("\n\n") },
    ];
    if (task.context) parts.push({ name: "saved context", text: `Saved context:\n${task.context}` });
    if (revision) {
      parts.push({ name: `project profile revision ${revision.id.slice(0, 8)}`, text: [`Project profile (revision ${revision.id}, ${revision.entries.length} entries):`, ...revision.entries.map((entry) => `${entry.key} (${entry.origin}):\n${entry.content}`)].join("\n\n") });
    }
    parts.push({ name: `${role.id} role instructions`, text: `Role: ${role.id}\n${role.instructions}` });
    parts.push({ name: followup ? "follow-up" : "task instruction", text: followup ? `Follow-up:\n${followup}` : "Implement the specification and report verification against each acceptance criterion." });
    return { revision, parts };
  }

  assembleScope(task: TaskRecord, workdir: string, adapter: AgentProvider, model?: string, followup?: string, role: MemberRole = { id: DEFAULT_ROLE_ID, instructions: DEFAULT_ROLE_INSTRUCTIONS }, onyx?: OnyxResolution): AssembledScope {
    const { revision, parts } = this.scopeParts(task, role, followup);
    let onyxContextSha: string | undefined;
    let onyxProvenance: "onyx" | "unavailable" | undefined;
    let onyxNotice: string | undefined;
    if (onyx?.ok && onyx.hits.length > 0) {
      onyxContextSha = onyx.sha;
      onyxProvenance = "onyx";
      parts.push({ name: `project context from Onyx (cited, ${onyx.sha.slice(0, 8)})`, text: formatOnyxSection(onyx.sha, onyx.hits) });
    } else if (onyx?.ok) {
      onyxContextSha = onyx.sha;
      onyxProvenance = "onyx";
    } else if (onyx) {
      onyxProvenance = "unavailable";
      onyxNotice = onyx.notice;
    }
    const prompt = this.enhancePrompt(parts.map((part) => part.text).filter(Boolean).join("\n\n"), workdir);
    if (!adapter.contextBudget.supportsProfileContext) {
      const omitted = revision ? ["project profile snapshot", "role instructions"] : ["role instructions"];
      throw new Error(`${adapter.name} does not support profile context. Omitted sources: ${omitted.join(", ")}. No run was started.`);
    }
    const total = prompt.length;
    const budget = adapter.contextBudget.maxPromptChars;
    if (total > budget) {
      const largest = [...parts.map((part) => ({ name: part.name, chars: part.text.length }))].sort((a, b) => b.chars - a.chars)[0];
      throw new Error(`Prompt exceeds the ${adapter.name} context budget (${total} > ${budget} chars); largest source: ${largest.name} (${largest.chars} chars). Reduce that source and retry. No run was started.`);
    }
    return {
      prompt, model,
      profileRevisionId: revision?.id, roleId: role.id, roleInstructions: role.instructions,
      contextSources: parts.map((part) => part.name),
      contextNotice: revision ? undefined : "No approved project profile; this run launches without profile context.",
      onyxContextSha, onyxProvenance, onyxNotice,
    };
  }

  preview(taskId: string, providerId: ProviderId = "opencode"): ScopePreview {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error("Task not found");
    const adapter = this.provider(providerId);
    const workdir = taskWorkdir(task);
    const { revision, parts } = this.scopeParts(task, { id: DEFAULT_ROLE_ID, instructions: DEFAULT_ROLE_INSTRUCTIONS });
    const prompt = this.enhancePrompt(parts.map((part) => part.text).filter(Boolean).join("\n\n"), workdir);
    const sources = parts.map((part) => ({ name: part.name, chars: part.text.length }));
    const budget = adapter.contextBudget.maxPromptChars;
    if (!adapter.contextBudget.supportsProfileContext) {
      return { provider: providerId, sources, totalChars: prompt.length, budget, verdict: "unsupported", notice: `${adapter.name} does not support profile context; launch would omit the profile snapshot and role instructions.` };
    }
    if (prompt.length > budget) {
      const largest = [...sources].sort((a, b) => b.chars - a.chars)[0];
      return { provider: providerId, sources, totalChars: prompt.length, budget, verdict: "oversized", notice: `Prompt exceeds the budget; largest source: ${largest.name} (${largest.chars} chars).` };
    }
    if (!revision) return { provider: providerId, sources, totalChars: prompt.length, budget, verdict: "no-profile", notice: "No approved project profile; the run would launch without profile context." };
    return { provider: providerId, sources, totalChars: prompt.length, budget, verdict: "ok" };
  }

  async stop(id: string) {
    const child = this.active.get(id);
    if (!child) throw new Error("No owned process is available to stop");
    this.stopping.add(id);
    try {
      if (process.platform === "win32" && child.pid) {
        await new Promise<void>((resolve, reject) => {
          execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, (error) => error ? reject(error) : resolve());
        });
      } else if (!child.kill()) throw new Error("The process could not be stopped");
    } catch (error) {
      this.stopping.delete(id);
      throw error;
    }
  }

  hasActiveWorkspace(project: string) {
    return [...this.active.keys()].some((id) => workspacesOverlap(this.store.getRun(id)!.project, project));
  }
}

const runtime = globalThis as typeof globalThis & { saberAgentRuns?: AgentRuns };

export function getAgentRuns() {
  return runtime.saberAgentRuns ??= new AgentRuns(getTaskStore());
}
