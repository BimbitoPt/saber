import { StringDecoder } from "node:string_decoder";
import { execFile } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type { AgentProvider } from "./providers/types";
import { getProvider } from "./providers";
import { TaskStore, getTaskStore } from "./taskStore";
import { enhance } from "./promptEnhancer";
import { workspacesOverlap } from "./workspaceIdentity";
import { parseProviderEvent } from "./providers/events";
import type { ProviderId } from "../lib/tasks";
import { taskWorkdir } from "./gitWorkspaces";
import { getTerminalLocks, type TerminalLocks } from "./terminalLocks";

export class AgentRuns {
  private active = new Map<string, ChildProcess>();
  private stopping = new Set<string>();

  constructor(private store: TaskStore, private provider: (name?: ProviderId) => AgentProvider = getProvider, private enhancePrompt = enhance, private terminalLocks: TerminalLocks = getTerminalLocks()) {}

  start(taskId: string, options: { model?: string; followup?: string; provider?: ProviderId } = {}) {
    this.terminalLocks.hydrate(this.store);
    const task = this.store.getTask(taskId);
    if (!task) throw new Error("Task not found");
    const workdir = taskWorkdir(task);
    if (this.hasActiveWorkspace(workdir)) throw new Error("The previous process is still closing. Wait before launching again.");
    if (this.terminalLocks.hasActiveWorkspace(workdir)) throw new Error("An interactive terminal owns this workspace. Close it before launching an agent run.");
    const providerId = options.provider ?? "opencode";
    const adapter = this.provider(providerId);
    const previous = this.store.listRuns(taskId).find((run) => run.provider === providerId && run.project === workdir && run.nativeSessionId);
    if (options.followup && !previous) throw new Error(`No ${providerId} session was captured for this task. Start a new run with this provider first.`);
    const prompt = [
      `Task: ${task.title}`, `Specification revision: ${task.revision}`, task.spec,
      `Acceptance criteria:\n${task.criteria}`, task.context ? `Saved context:\n${task.context}` : "",
      options.followup ? `Follow-up:\n${options.followup}` : "Implement the specification and report verification against each acceptance criterion.",
    ].filter(Boolean).join("\n\n");
    const model = options.model?.trim() || (options.followup ? previous?.model : undefined);
    const submittedPrompt = this.enhancePrompt(prompt, workdir);
    const run = this.store.createRun(taskId, submittedPrompt, model, providerId, workdir);
    try {
      const child = adapter.spawn({ workdir, task: submittedPrompt, model,
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
