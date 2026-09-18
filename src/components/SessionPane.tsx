import { useEffect, useRef, useState } from "react";
import { fetchEvents, type EventsSnapshot } from "../lib/api";

const MAX_RENDERED = 400;

const KIND_COLOR: Record<string, string> = {
  text: "text-text",
  step_start: "text-info",
  step_start_part: "text-info",
  tool: "text-accent",
  tool_use: "text-accent",
  reasoning: "text-muted",
  provider_error: "text-err",
  status: "text-run",
  session_done: "text-muted",
};

function describeLine(rawLine: string): { kind: string; text: string } {
  try {
    const ev = JSON.parse(rawLine) as {
      type?: string;
      part?: { type?: string; text?: string; tool?: string };
    };
    const kind = ev.type ?? ev.part?.type ?? "unknown";
    let text = "";
    if (ev.part?.text) text = ev.part.text.slice(0, 240);
    else if (ev.part?.tool) text = ev.part.tool;
    return { kind, text };
  } catch {
    return { kind: "raw", text: rawLine.trim().slice(0, 240) };
  }
}

export function SessionPane({ sessionId, onClosed }: { sessionId: string | null; onClosed: () => void }) {
  const [lines, setLines] = useState<Array<string>>([]);
  const [status, setStatus] = useState<string>("");

  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    sessionIdRef.current = sessionId;
    setLines([]);
    setStatus("");
    if (!sessionId) return;
    let cancelled = false;
    let cursor = 0;

    async function poll() {
      const id = sessionIdRef.current;
      if (!id || cancelled) return;
      try {
        const snap: EventsSnapshot = await fetchEvents(id, cursor, true);
        if (cancelled || sessionIdRef.current !== id) return;
        if (snap.lines.length > 0) {
          cursor = snap.next;
          setLines((prev) => {
            const merged = [...prev, ...snap.lines.map(describeLine)];
            return merged.length > MAX_RENDERED ? merged.slice(merged.length - MAX_RENDERED) : merged;
          });
        }
        setStatus(snap.status);
        if (snap.status === "running") setTimeout(poll, 60);
        else onClosed();
      } catch {
        if (!cancelled) setTimeout(poll, 1000);
      }
    }

    poll();
    return () => {
      cancelled = true;
    };
  }, [sessionId, onClosed]);

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [lines]);

  if (!sessionId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-faint">
        Select or start a session
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-line-soft bg-panel px-4 py-2 text-xs">
        <span className="font-mono text-[10px] text-faint">{sessionId.slice(0, 8)}</span>
        <span className={KIND_COLOR[`${status}`] ?? "text-muted"}>
          {status === "running" && <span className="animate-pulse">(running)</span>}
          {status !== "running" && `(${status || "connecting"})`}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-[#060607] p-3" aria-live="polite">
        {lines.map((l, i) => (
          <div key={i} className="border-b border-line-soft/40 px-1 py-1.5 font-mono text-[11px] leading-relaxed">
            <span className={`mr-2 ${KIND_COLOR[l.kind] ?? "text-muted"}`}>[{l.kind}]</span>
            <span className="text-neutral-300">{l.text}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
