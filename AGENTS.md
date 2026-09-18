# AGENTS.md — Saber (by Mstudio)

Stack: Bun + TanStack Start + Tailwind v4, dev on port 8082 (--strictPort).
Rust shell lives in src-tauri (Tauri v2, spawns bun dev as sidecar).
Package manager: Bun only. Tests: vitest (`bun run test`).
No emojis. No comments unless asked. Verify edits by rerunning dev and checking the changed pane in a browser.
Never edit `src/routeTree.gen.*` (generated) or `src-tauri/gen/**` (generated).
Production product name: Saber. Historical repo dir name stays mstudio-ade.
Happy path for spawning agents on Windows: `opencode run --format json --dir <path>` with stdin IGNORED — a piped stdin blocks opencode forever.
Root route must render <HeadContent/> and <Scripts/> or the client bundle never loads (unstyled white page).
