import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { TaskWorkspace } from "../components/TaskWorkspace";
import { DevServerPane } from "../components/DevServerPane";
import { BrowserPane } from "../components/BrowserPane";

export const Route = createFileRoute("/")({ component: IndexComponent });

function IndexComponent() {
  const [panel, setPanel] = useState<"tasks" | "dev" | "browser">("tasks");
  return <div className="flex h-full min-h-0 flex-col">
    <nav className="flex shrink-0 items-center gap-2 border-b border-line bg-panel px-4 py-2" aria-label="Workspace views">
      {(["tasks", "dev", "browser"] as const).map((item) => <button key={item} onClick={() => setPanel(item)} aria-pressed={panel === item}
        className={`rounded px-3 py-1.5 text-xs ${panel === item ? "bg-panel-2 text-text" : "text-muted"}`}>
        {item === "tasks" ? "Terminal workspace" : item === "dev" ? "Shared dev servers" : "Shared browser"}
      </button>)}
    </nav>
    <div className={panel === "tasks" ? "min-h-0 flex-1" : "hidden"}><TaskWorkspace /></div>
    {panel === "dev" && <div className="min-h-0 flex-1"><DevServerPane /></div>}
    {panel === "browser" && <div className="min-h-0 flex-1"><BrowserPane /></div>}
  </div>;
}
