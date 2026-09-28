import { createRootRoute, Link, Outlet, HeadContent, Scripts } from "@tanstack/react-router";
import { type ReactNode } from "react";
import { Terminal } from "lucide-react";
import "../styles/app.css";

export const Route = createRootRoute({
  component: RootComponent,
});

function Shell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>{children}</body>
    </html>
  );
}

function TitleBar() {
  const tauri = typeof window !== "undefined" ? ((window as Record<string, any>)["__TAURI_INTERNALS__"] ?? null) : null;
  async function win(action: "minimize" | "toggleMaximize" | "close") {
    if (!tauri) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    if (action === "minimize") win.minimize();
    else if (action === "close") win.close();
    else win.toggleMaximize();
  }

  return (
    <header
      data-tauri-drag-region
      className="flex h-10 shrink-0 items-center justify-between border-b border-line bg-panel pl-3"
    >
      <div className="flex items-center gap-2">
        <div className="flex h-5 w-5 items-center justify-center rounded-sm bg-accent text-[10px] font-black text-black">
          M
        </div>
        <span className="select-none text-[13px] font-semibold tracking-wide">SABER</span>
        <span className="select-none text-[10px] uppercase tracking-[0.2em] text-faint">by Mstudio</span>
      </div>
      <div className="flex" style={{ height: "100%" }}>
        <TitleButton onClick={() => win("minimize")} label="Minimize">
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M0 5h10" stroke="currentColor" strokeWidth="1" /></svg>
        </TitleButton>
        <TitleButton onClick={() => win("toggleMaximize")} label="Maximize">
          <svg width="10" height="10" aria-hidden><rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" fill="none" strokeWidth="1" /></svg>
        </TitleButton>
        <TitleButton onClick={() => win("close")} label="Close" close>
          <svg width="10" height="10" aria-hidden><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" /></svg>
        </TitleButton>
      </div>
    </header>
  );
}

function TitleButton({ children, onClick, close, label }: { children: React.ReactNode; onClick: () => void; close?: boolean; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`flex h-full w-11 items-center justify-center text-muted transition-colors duration-150 hover:bg-panel-2 ${
        close ? "hover:bg-err hover:text-black" : ""
      }`}
    >
      {children}
    </button>
  );
}

function RootComponent() {
  return (
    <Shell>
      <div className="flex h-screen min-h-0 flex-col bg-bg text-text">
        <TitleBar />
        <div className="flex min-h-0 flex-1">
          <nav className="flex w-48 shrink-0 flex-col gap-1 border-r border-line bg-panel p-2">
            <div className="mb-2 px-2 pt-2 text-[10px] font-bold uppercase tracking-[0.18em] text-faint">
              Workspace
            </div>
            <NavItem to="/" icon={<Terminal size={15} />} label="Tasks" />
          </nav>
          <main className="min-h-0 flex-1 overflow-hidden">
            <Outlet />
          </main>
        </div>
      </div>
      <Scripts />
    </Shell>
  );
}

function NavItem({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-2.5 rounded-md px-2 py-2 text-[13px] text-muted transition-colors duration-150 hover:bg-panel-2 hover:text-text"
    >
      {icon}
      {label}
    </Link>
  );
}
