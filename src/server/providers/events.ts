import type { ProviderId } from "../../lib/tasks";

export interface DisplayEvent {
  kind: "agent_message" | "tool" | "meta";
  text: string;
  detail?: string;
}

export function parseProviderEvent(provider: ProviderId, line: string): { nativeSessionId?: string; failed: boolean; items: DisplayEvent[] } {
  const result: { nativeSessionId?: string; failed: boolean; items: DisplayEvent[] } = { failed: false, items: [] };
  let event: any;
  try { event = JSON.parse(line); } catch { return { ...result, items: [{ kind: "meta", text: line }] }; }
  if (!event || typeof event !== "object") return result;
  const message = (text: unknown) => { if (typeof text === "string" && text) result.items.push({ kind: "agent_message", text }); };
  const failure = (text: unknown) => { result.failed = true; result.items.push({ kind: "meta", text: typeof text === "string" ? text : "Provider reported a failed result. Inspect raw output for details." }); };
  if (event.type === "provider_error") result.items.push({ kind: "meta", text: String(event.message ?? "Provider diagnostic") });
  if (provider === "opencode") {
    if (typeof event.sessionID === "string") result.nativeSessionId = event.sessionID;
    if (event.type === "text") message(event.part?.text);
    if (event.type === "tool_use") result.items.push({ kind: "tool", text: String(event.part?.tool ?? "Tool"), detail: String(event.part?.state?.status ?? "") });
    if (event.type === "error") failure(event.error?.data?.message ?? event.error?.message);
  } else if (provider === "codex") {
    if (event.type === "thread.started" && typeof event.thread_id === "string") result.nativeSessionId = event.thread_id;
    if (event.type === "item.completed" && event.item?.type === "agent_message") message(event.item.text);
    if (["item.started", "item.completed"].includes(event.type) && ["command_execution", "file_change", "mcp_tool_call", "web_search"].includes(event.item?.type)) {
      result.items.push({ kind: "tool", text: event.item.type, detail: String(event.item.command ?? event.item.tool ?? event.item.status ?? "") });
    }
    if (event.type === "error") result.items.push({ kind: "meta", text: String(event.error?.message ?? event.message ?? "Provider diagnostic") });
    if (event.type === "turn.failed") failure(event.error?.message ?? event.message);
  } else {
    if (typeof event.session_id === "string") result.nativeSessionId = event.session_id;
    if (event.type === "assistant" && Array.isArray(event.message?.content)) {
      for (const part of event.message.content) {
        if (part.type === "text") message(part.text);
        if (part.type === "tool_use") result.items.push({ kind: "tool", text: String(part.name ?? "Tool") });
      }
    }
    if (event.type === "result") {
      if (event.is_error || (typeof event.subtype === "string" && event.subtype.startsWith("error"))) failure(event.result ?? event.errors?.join("\n"));
      if (Array.isArray(event.permission_denials) && event.permission_denials.length) failure("Claude Code denied tool permissions. Configure the required permissions in Claude Code, then start a new run.");
    }
  }
  return result;
}
