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
import type { ProviderId, RunRecord, TaskRecord } from "../lib/tasks";
import { taskWorkdir } from "./gitWorkspaces";
import { resolveProjectSource } from "./projectProfiles";
import { getTerminalLocks, type TerminalLocks } from "./terminalLocks";
import { maxActiveRuns } from "./runQueue";
import { formatOnyxSection, queryOnyxContext, type OnyxResolution } from "./onyxContext";
import { visualWebContext } from "./visualWeb";

export const DEFAULT_ROLE_ID = "default";
export const DEFAULT_ROLE_INSTRUCTIONS = "Act as the project's implementing agent: follow the profile conventions and stack, verify each acceptance criterion with real checks, and report verification per criterion without merging or deploying.";
export const AGENT_STOP_ESCALATION_MS = 2_000;

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
  private escalationTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private promotionInFlight?: Promise<void>;

  constructor(private store: TaskStore, private provider: (name?: ProviderId) => AgentProvider = getProvider, private enhancePrompt = enhance, private terminalLocks: TerminalLocks = getTerminalLocks()) {}

  async start(taskId: string, options: StartOptions = {}, signal?: AbortSignal) {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error("Task not found");
    const workdir = options.workdir ?? await taskWorkdir(task, signal);
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
    // Strict FIFO: a new run queues whenever capacity is exhausted or older work
    // is still queued, so no accepted request can be overtaken by a later one.
    const shouldQueue = this.active.size >= maxActiveRuns() || this.store.listRuns().some((run) => run.status === "queued");
    const run = this.store.createRun(task.id, scope.prompt, model, providerId, workdir, scope, options.runId,
      shouldQueue ? { status: "queued", launch: { readOnly: options.readOnly, followup: options.followup !== undefined } } : undefined);
    if (run.status === "queued") {
      this.store.appendEvent(run.id, JSON.stringify({ type: "run_queued", message: `The active-run limit is reached. This run holds its workspace and is queued at position ${this.queuePosition(run.id)}.` }));
      return run.id;
    }
    try {
      const child = this.spawnChild(run, adapter, { workdir, readOnly: options.readOnly, session: options.followup ? previous?.nativeSessionId : undefined });
      this.active.set(run.id, child);
      this.wireChild(run, child, providerId);
    } catch (error) {
      this.store.appendEvent(run.id, JSON.stringify({ type: "provider_error", message: String(error) }));
      this.store.finishRun(run.id, "error", null);
      throw error;
    }
    return run.id;
  }

  private spawnChild(run: RunRecord, adapter: AgentProvider, launch: { workdir: string; readOnly?: boolean; session?: string }) {
    return adapter.spawn({ workdir: launch.workdir, task: run.task, model: run.model, readOnly: launch.readOnly, session: launch.session });
  }

  private queuePosition(id: string): number {
    const queued = this.store.listRuns().filter((run) => run.status === "queued");
    return queued.length - queued.findIndex((run) => run.id === id);
  }

  /** Promote queued runs into free process slots, oldest first. */
  private async promoteQueued(): Promise<void> {
    const limit = maxActiveRuns();
    while (this.active.size < limit) {
      // listRuns is newest first; reversed, it is the FIFO queue order.
      const queued = this.store.listRuns().filter((run) => run.status === "queued").reverse();
      const next = queued.find((run) =>
        !this.hasActiveWorkspace(run.project)
        && !this.terminalLocks.hasActiveWorkspace(this.store, run.project));
      if (!next) return;
      try {
        await this.launchQueued(next);
      } catch (error) {
        // The failed run is already settled as errored; keep promoting the rest
        // so one broken launch cannot stall the accepted work behind it.
        console.error("Run-queue promotion failed:", error);
      }
    }
  }

  private async launchQueued(run: RunRecord): Promise<void> {
    this.store.promoteRun(run.id);
    const adapter = this.provider(run.provider);
    const previous = run.launch?.followup
      ? this.store.listRuns(run.taskId).find((item) => item.id !== run.id && item.provider === run.provider && item.project === run.project && item.nativeSessionId)
      : undefined;
    try {
      const child = this.spawnChild(run, adapter, { workdir: run.project, readOnly: run.launch?.readOnly, session: previous?.nativeSessionId });
      this.active.set(run.id, child);
      this.wireChild(run, child, run.provider);
      this.store.appendEvent(run.id, JSON.stringify({ type: "run_promoted", message: "The run left the queue and its provider process started." }));
    } catch (error) {
      this.store.appendEvent(run.id, JSON.stringify({ type: "provider_error", message: String(error) }));
      try {
        this.store.finishRun(run.id, "error", null);
      } catch {
        // A concurrent close event may have already settled the run; the terminal state stands.
      }
      throw error;
    }
  }

  private schedulePromotion(): void {
    this.promotionInFlight ??= this.promoteQueued().catch((error) => {
      console.error("Run-queue promotion failed:", error);
    }).finally(() => {
      this.promotionInFlight = undefined;
    });
  }

  /** Recover queued work after a restart: promote eligible runs into free slots. */
  async recoverQueued(): Promise<void> {
    await this.drainPromotion();
    this.schedulePromotion();
    await this.promotionInFlight;
  }

  private async drainPromotion(): Promise<void> {
    while (this.promotionInFlight) await this.promotionInFlight;
  }

  private wireChild(run: RunRecord, child: ChildProcess, providerId: ProviderId) {
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
      if (!this.active.has(run.id)) return;
      this.active.delete(run.id);
      this.clearEscalation(run.id);
      try { this.store.appendEvent(run.id, JSON.stringify({ type: "provider_error", message: error.message })); } catch {}
      try {
        this.store.finishRun(run.id, "error", null);
      } catch {
        // A close event may have already settled the run; the terminal state stands.
      } finally {
        this.stopping.delete(run.id);
        this.schedulePromotion();
      }
    });
    child.on("close", (code) => {
      if (!this.active.has(run.id)) return;
      this.active.delete(run.id);
      this.clearEscalation(run.id);
      try {
        append(pending + decoder.end());
      } catch {
        // A failed output flush must not stop the run from reaching a terminal state.
      } finally {
        pending = "";
      }
      try {
        const current = this.store.getRun(run.id);
        if (current?.status === "running") {
          this.store.finishRun(run.id, this.stopping.has(run.id) ? "stopped" : code === 0 && !providerFailed ? "done" : "error", code);
        }
      } catch {
        // A concurrent error event may have already settled the run; the terminal state stands.
      } finally {
        this.stopping.delete(run.id);
        this.schedulePromotion();
      }
    });
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
    parts.push(...visualWebContext(task, followup));
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

  async preview(taskId: string, providerId: ProviderId = "opencode", signal?: AbortSignal): Promise<ScopePreview> {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error("Task not found");
    const adapter = this.provider(providerId);
    const workdir = await taskWorkdir(task, signal);
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
    const run = this.store.getRun(id);
    if (!run) throw new Error("Run not found");
    if (run.status === "queued") {
      // A queued run owns no process: cancellation only settles the record.
      this.store.finishRun(id, "stopped", null);
      this.store.appendEvent(id, JSON.stringify({ type: "run_cancelled", message: "Queued run cancelled before launch." }));
      return;
    }
    if (run.status !== "running" && run.status !== "interrupted") return;
    const child = this.active.get(id);
    if (!child) {
      if (run.status === "running") {
        // No process is owned for this run, so settle it instead of leaving the workspace falsely locked.
        this.store.finishRun(id, "interrupted", null);
      }
      return;
    }
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
    this.escalateLater(id, child);
  }

  /** A provider that ignores SIGTERM must not hold its workspace open forever. */
  private escalateLater(id: string, child: ChildProcess): void {
    const timer = setTimeout(() => {
      this.escalationTimers.delete(id);
      if (this.active.get(id) !== child) return;
      try { child.kill("SIGKILL"); } catch {}
    }, AGENT_STOP_ESCALATION_MS);
    (timer as unknown as { unref?: () => void }).unref?.();
    this.escalationTimers.set(id, timer);
  }

  private clearEscalation(id: string): void {
    const timer = this.escalationTimers.get(id);
    if (!timer) return;
    clearTimeout(timer);
    this.escalationTimers.delete(id);
  }

  hasActiveWorkspace(project: string) {
    return [...this.active.keys()].some((id) => workspacesOverlap(this.store.getRun(id)!.project, project));
  }

  async stopAll(timeoutMs = 5_000): Promise<void> {
    const ids = [...this.active.keys()];
    await Promise.allSettled(ids.map((id) => this.stop(id)));
    const deadline = Date.now() + timeoutMs;
    while (this.active.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    for (const child of [...this.active.values()]) {
      try { child.kill("SIGKILL"); } catch {}
    }
  }
}

const runtime = globalThis as typeof globalThis & { saberAgentRuns?: AgentRuns };

export function getAgentRuns() {
  if (!runtime.saberAgentRuns) {
    runtime.saberAgentRuns = new AgentRuns(getTaskStore());
    // Queued work is accepted work: after a restart, promote it once the
    // process can own provider children again. Never retries interrupted runs.
    void runtime.saberAgentRuns.recoverQueued().catch((error) => {
      console.error("Run-queue recovery failed:", error);
    });
  }
  return runtime.saberAgentRuns;
}

export function stopAllAgentRuns(): Promise<void> {
  return getAgentRuns().stopAll();
}
