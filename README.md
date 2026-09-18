# SABER — by Mstudio

An agentic development forge: one cockpit where you spawn coding agents
(opencode first), watch their live event stream, run your project dev
servers, and watch them self-verify their work in an embedded browser.

Previously named "mstudio-ade" / "MSTUDIO ADE". The repo dir keeps the old
path for stability; the product name is Saber.

## Layers

- **Saber app** (this repo): Tauri shell + Bun/TanStack Start server on
  port 8082. Owns agent lifecycle (pluggable `src/server/providers/`),
  dev-server registry, and the embedded headless browser.
- **Mstudio profile** (`Desktop\mstudio-os`): the portable settings layer.
  Saber reads `projects.json` live for the project inventory and links
  the global AGENTS.md + skills into your harness.
  See mstudio-os/docs/USAGE.md for how the profile installs.

## Run

```powershell
bun run dev        # web UI on http://localhost:8082
cargo run          # from /src-tauri: full product window
```

Sellable product story: agents are skilled metalworkers; Saber is the
bench where they work.
