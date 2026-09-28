# AGENTS.md — Saber (by Mstudio)

Stack: Bun + TanStack Start + Tailwind v4, dev on port 8082 (--strictPort).
Rust shell lives in src-tauri (Tauri v2, spawns bun dev as sidecar).
Package manager: Bun only. Tests: vitest (`bun run test`).
No emojis. No comments unless asked. Verify edits by rerunning dev and checking the changed pane in a browser.
Never edit `src/routeTree.gen.*` (generated) or `src-tauri/gen/**` (generated).
Production product name: Saber. Historical repo dir name stays mstudio-ade.
Happy path for spawning agents on Windows: `opencode run --format json --dir <path>` with stdin IGNORED — a piped stdin blocks opencode forever.
Root route must render <HeadContent/> and <Scripts/> or the client bundle never loads (unstyled white page).

Develop Saber from versioned specifications. Product direction: docs/superpowers/specs/2026-09-21-saber-product-direction.md.
Before behavior changes, define scope, stable requirement IDs, acceptance criteria, and verification in a feature spec; map implementation plans and completion evidence to those criteria.
Feature spec template: docs/superpowers/specs/TEMPLATE.md.
Current slice: M7 Linux desktop runtime in docs/superpowers/specs/2026-09-24-linux-desktop-runtime.md. M1-M6 are implemented and verified on Windows to the limits in their feature receipts. Linux runtime, packaging, Rust/PTY, and API checks pass in Ubuntu 26.04 WSL; native task-terminal, A-to-B-to-A UI, and graceful desktop-close acceptance remain unverified because native app controls are unavailable here. M7 plan: docs/superpowers/plans/2026-09-24-linux-desktop-runtime.md. A successful build or agent exit means ready for review, not verified completion.
Preserve task/run separation and immutable run scope. Use task worktrees for parallel changes. Existing shared-checkout tasks remain serialized.
