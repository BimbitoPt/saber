import { useEffect, useRef, useState } from "react";
import { Wrench, ArrowUp, Loader2 } from "lucide-react";
import { fetchEvents, type EventsSnapshot } from "../lib/api";
import { runStatusLabel, type RunStatus } from "../lib/tasks";

const MAX_ITEMS = 300;

interface StreamItem {
  key: number;
  kind: "agent_message" | "tool" | "meta" | "followup" | "diagnostic";
  text: string;
  detail?: string;
}

function classifyChunk(chunk: string, nextKey: () => number): StreamItem | null {
  for (const line of chunk.split("\n")) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line) as {
        type?: string;
        message?: string;
        part?: {
          type?: string;
          text?: string;
          tool?: string;
          state?: { status?: string; input?: Record<string, unknown> };
        };
      };
      const t = ev.type ?? "";
      if (t === "text" && ev.part?.text) {
        return { key: nextKey(), kind: "agent_message", text: ev.part.text };
      }
      if (t === "tool_use" && ev.part?.tool) {
        const input = (ev.part.state?.input ?? {}) as Record<string, unknown>;
        const target =
          (typeof input["filePath"] === "string" ? (input["filePath"] as string).split("\\").pop() : undefined) ??
          (typeof input["command"] === "string" ? (input["command"] as string).slice(0, 50) : undefined) ??
          (typeof input["pattern"] === "string" ? (input["pattern"] as string) : undefined) ??
          "";
        return {
          key: nextKey(),
          kind: "tool",
          text: ev.part.tool,
          detail: `${target ? target + " " : ""}(${ev.part.state?.status ?? "?"})`,
        };
      }
      if (t === "followup_sent") {
        return { key: nextKey(), kind: "followup", text: ev.message ?? "" };
      }
      if (t === "provider_error") {
        return { key: nextKey(), kind: "diagnostic", text: ev.message ?? "Provider diagnostic" };
      }
      return null;
    } catch {
      continue;
    }
  }
  return null;
}

export function SessionPane({ sessionId }: { sessionId: string | null }) {
  const [items, setItems] = useState<StreamItem[]>([]);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState("");
  const [rawLines, setRawLines] = useState<string[]>([]);

  const keyRef = useRef(0);
  const cursorRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sessionIdRef.current = sessionId;
    cursorRef.current = 0;
    keyRef.current = 0;
    setItems([]);
    setStatus("");
    setError("");
    setRawLines([]);
    if (!sessionId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      const id = sessionIdRef.current;
      if (!id || cancelled) return;
      try {
        const snap: EventsSnapshot = await fetchEvents(id, cursorRef.current, true);
        if (cancelled || sessionIdRef.current !== id) return;

        if (snap.lines.length > 0) {
          cursorRef.current = snap.next;
          setRawLines((previous) => [...previous, ...snap.lines].slice(-MAX_ITEMS));
          const parsed = snap.lines.flatMap((raw): StreamItem[] => {
            try {
              const event = JSON.parse(raw);
              if (event.type === "saber_event" && Array.isArray(event.items)) {
                return event.items.map((item: Omit<StreamItem, "key">) => ({ ...item, key: keyRef.current++ }));
              }
            } catch {}
            const item = classifyChunk(raw, () => keyRef.current++);
            return item ? [item] : [];
          });
          setItems((prev) => {
            const merged = [...prev, ...parsed];
            return merged.length > MAX_ITEMS ? merged.slice(merged.length - MAX_ITEMS) : merged;
          });
        }
        setStatus(snap.status);
        setError("");
        if (snap.hasMore || snap.status === "running") timer = setTimeout(poll, 60);
      } catch (e) {
        if (!cancelled) { setError(`Output connection failed: ${String(e)}`); timer = setTimeout(poll, 1000); }
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "auto" });
  }, [items]);

  if (!sessionId) {
    return <div className="flex h-full items-center justify-center text-sm text-faint">Select or start a session</div>;
  }

  const running = status === "running";
  const diagnostics = items.filter((item) => item.kind === "diagnostic");
  const output = items.filter((item) => item.kind !== "diagnostic");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-line-soft bg-panel px-4 py-2 text-xs">
        <span className="font-mono text-[10px] text-faint">{sessionId.slice(0, 8)}</span>
        <span className={running ? "text-run" : status === "done" ? "text-ok" : "text-err"}>
          {running && <Loader2 size={11} className="mr-1.5 inline animate-spin" />}
          {status ? runStatusLabel[status as RunStatus] : "Connecting"}
        </span>
      </div>

      {error && <p role="alert" className="px-4 py-2 text-xs text-err">{error}</p>}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
        {output.length === 0 && running && (
          <div className="flex items-center gap-2 text-xs text-faint">
            <Loader2 size={12} className="animate-spin" /> waiting for agent output...
          </div>
        )}
        {output.map((item) => {
          if (item.kind === "followup") {
            return (
              <div key={item.key} className="ml-auto w-fit max-w-[80%] rounded-lg rounded-br-sm bg-accent-dim px-3 py-2 text-xs text-text">
                <ArrowUp size={10} className="mb-0.5 mr-1 inline text-accent" />
                {item.text}
              </div>
            );
          }
          if (item.kind === "tool") {
            return (
              <div key={item.key} className="flex items-center gap-2 text-[11px] text-muted">
                <span className="flex items-center gap-1 rounded bg-panel-2 px-1.5 py-0.5 font-mono text-faint">
                  <Wrench size={10} />
                  {item.text}
                </span>
                <span className="truncate">{item.detail}</span>
              </div>
            );
          }
          if (item.kind === "meta") {
            return (
              <div key={item.key} className="text-[11px] text-err">
                {item.text}
              </div>
            );
          }
          return (
            <div key={item.key} className="w-fit max-w-[85%] whitespace-pre-wrap rounded-lg rounded-tl-sm bg-panel px-3 py-2 text-[13px] leading-relaxed text-text">
              {item.text}
            </div>
          );
        })}
        <div ref={bottomRef} />
        {diagnostics.length > 0 && <details className="text-xs text-muted">
          <summary className="cursor-pointer">Provider diagnostics ({diagnostics.length})</summary>
          <p className="mt-2">Provider logs may include warnings or optional integration failures. See the run status above for the task outcome.</p>
          <pre className="mt-2 whitespace-pre-wrap break-all">{diagnostics.map((item) => item.text).join("\n")}</pre>
        </details>}
        <details className="text-xs text-muted"><summary className="cursor-pointer">Raw provider output (latest {MAX_ITEMS} events)</summary><pre className="mt-2 whitespace-pre-wrap break-all">{rawLines.map((line) => {
          try { const event = JSON.parse(line); return event.type === "saber_event" ? event.raw : line; } catch { return line; }
        }).join("\n")}</pre></details>
      </div>


    </div>
  );
}
