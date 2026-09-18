import { useEffect, useRef, useState } from "react";
import { fetchEvents, type EventsSnapshot } from "../lib/api";

const MAX_RENDERED = 400;

function describeLine(rawLine: string): string {
  try {
    const ev = JSON.parse(rawLine) as {
      type?: string;
      part?: { type?: string; text?: string; tool?: string };
    };
    const kind = ev.type ?? ev.part?.type ?? "unknown";
    let detail = "";
    if (ev.part?.text) {
      detail = ev.part.text.slice(0, 200);
    } else if (ev.part?.tool) {
      detail = ev.part.tool;
    }
    return `[${kind}] ${detail}`;
  } catch {
    return rawLine.trim().slice(0, 220);
  }
}

export function SessionPane({ sessionId, onClosed }: { sessionId: string | null; onClosed: () => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState<string>("");
  const cursorRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    sessionIdRef.current = sessionId;
    cursorRef.current = 0;
    setLines([]);
    setStatus("");
    if (!sessionId) return;
    let cancelled = false;

    async function poll() {
      const id = sessionIdRef.current;
      if (!id || cancelled) return;
      try {
        const snap: EventsSnapshot = await fetchEvents(id, cursorRef.current, true);
        if (cancelled || sessionIdRef.current !== id) return;
        if (snap.lines.length > 0) {
          cursorRef.current = snap.next;
          setLines((prev) => {
            const merged = [...prev, ...snap.lines.map(describeLine)];
            return merged.length > MAX_RENDERED ? merged.slice(merged.length - MAX_RENDERED) : merged;
          });
        }
        setStatus(snap.status);
        if (snap.status === "running") {
          setTimeout(poll, 100);
        } else {
          onClosed();
        }
      } catch {
        if (!cancelled) setTimeout(poll, 1000);
      }
    }

    poll();
    return () => {
      cancelled = true;
    };
  }, [sessionId, onClosed]);

  useEffect(() => {
    const el = document.getElementById("session-stream");
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  if (!sessionId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-500">
        Select or start a session
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2 text-xs">
        <span className="font-mono text-neutral-500">{sessionId.slice(0, 8)}</span>
        <span
          className={
            status === "running" ? "text-yellow-400" : status === "done" ? "text-green-400" : "text-red-400"
          }
        >
          {status || "connecting"}
        </span>
      </div>
      <div
        id="session-stream"
        className="flex-1 overflow-y-auto bg-black p-3 font-mono text-xs leading-relaxed text-neutral-300"
      >
        {lines.map((line, i) => (
          <div key={i} className="border-b border-neutral-900/60 py-0.5">
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}
