import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import "../styles/app.css";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <div className="flex h-screen bg-neutral-950 text-neutral-200">
      <nav className="w-48 border-r border-neutral-800 p-4 space-y-2">
        <div className="font-bold tracking-tight">MSTUDIO ADE</div>
        <Link to="/" className="block text-sm text-neutral-400 hover:text-white">Sessions</Link>
        <Link to="/" className="block text-sm text-neutral-400 hover:text-white">Dev Servers</Link>
      </nav>
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
