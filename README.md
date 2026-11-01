# 🪄 Saber — Terminal-First Workspace for Agentic Engineering

![Saber Banner](https://raw.githubusercontent.com/BimbitoPt/saber/main/docs/assets/saber-banner.svg || "Saber - the fun way to agent")

[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-Runtime-orange)](https://bun.sh/)
[![Tauri](https://img.shields.io/badge/Tauri-Desktop-app-ff69b4)](https://tauri.app/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![GitHub stars](https://img.shields.io/github/stars/BimbitoPt/saber?style=social)](https://github.com/BimbitoPt/saber/stargazers)

> "Your terminal, superpowered. 🚀"

---

## What in the name of all that is holy is this?

**Saber** is a desktop studio for agentic engineering. Imagine your terminal, but with a native app window, browser preview, and every agent tool you could want living alongside you instead of making you jump through hoops.

**We previously called it** "mstudio-ade" / "MSTUDIO ADE" — honestly, we just got tired of typing 6 syllables. "Saber" is way punchier. Also, we liked the idea of a sword-based tool name for an agent workspace. Don't read too much into it. 🤷‍♂️

---

## ✨ It's Got Stuff

| Feature | Who This Helps |
|---------|---------------|
| 🌐 **Terminal-First** | Open a task's shell, type commands for Herdr, OpenCode, Codex, Claude Code, or your local tool of choice |
| 📋 **Task Board** | List view or board view with attention states: running, interrupted, failed, review-ready, verified, stopped, draft |
| 🤖 **Agent Adapters** | Connect to Codex, Claude, or anything local. Switch tasks while keeping specs & handoff close at hand |
| 🖥️ **Dev Server Registry** | Start/stop/reconcile dev servers without leaving the app |
| 🖼️ **Embedded Browser** | Headless browser preview (because sometimes you actually need to see pixels) |
| 📦 **Project Inventory** | Live `projects.json` reading + AGENTS.md + skills, all linked into your harness |
| 💾 **SQLite Persistence** | Task data at `~/.saber/tasks.sqlite`. Set `SABER_DATA_DIR` if you like living dangerously |

---

## 🛠️ The Techie Bits

- **Frontend**: Tauri v2 + React + TypeScript (fancy, right?)
- **Server**: Bun + TanStack Start on port 8082 (because Node who?)
- **Desktop**: Rust (Tauri) + WebView2
- **Data**: SQLite for task/run persistence
- **Package Manager**: Bun (npm is so 2010s)

---

## 🚀 Quick Start (or How to Not Break Things)

```powershell
# The happy path
bun run dev        # web UI on http://localhost:8082
# OR if you're feeling adventurous
cargo run          # from /src-tauri: full product window

# Optional: set your data dir (for the daring)
export SABER_DATA_DIR=/tmp/i-know-what-i-m-doing

# Pick your provider (Saber won't judge, but it will check)
# codex login      (workspace-write with noninteractive approval refusal)
# claude auth login (uses configured permissions)
# Saber does NOT bypass approval or sandbox settings
```

> ⚠️ **Windows explorers**: Discovery needs a native executable. `.cmd` or `.ps1` shims are NOT supported. We're looking at you, PowerShell fans.

---

## 📁 Folder Structure (at a Glance)

```
saber/
├── src/                    # Main source code
│   ├── server/            # API routes & handlers (our baby)
│   └── server/providers/  # Pluggable adapter thingies
├── src-tauri/             # Tauri build config + Rust
├── docs/                  # Architecture, specs, roadmaps (exciting, right?)
├── scripts/               # Helpful automation scripts
├── tests/                 # Vitest suite (21 tests pass — we checked)
└── .github/              # GitHub Actions & workflows
```

---

## 🎉 We Recently Slayed a Dragon (PR #6)

We [refactored the server into route modules](https://github.com/BimbitoPt/saber/pull/6) — yes, really. The highlights:

- **Split** the 661-line monolith `src/server.ts` into focused modules
- **Moved** every route body byte-identically — zero logic changes, promise
- **Fixed** the route-table generator to scan modules directly, eliminating a bogus `PATCH /api/terminals/:id` row the old heuristic invented
- **Added** golden-set tests (`routeScan.test.ts`) that pin the route set (22 literals + 17 matchers) to catch drift. A forgotten route block will fail a test. You've been warned. 👀

**Result**: All 21 tests pass. Behavior unchanged. Integrity preserved. 🛡️

---

## 🐦 Hang Out With Us

[![GitHub](https://img.shields.io/badge/GitHub-@BimbitoPt-181717?logo=github)](https://github.com/BimbitoPt)

---

*"Saber: because your terminal deserves a graphical interface, and your GUI deserves terminal power."*
✨

---

## 📜 License

MIT — because closed-source agent studios are so 2023. And also because we like open source and don't want to deal with legal department headaches.

---

*Last updated: whenever you're reading this. Features evolve, bugs get fixed, and occasionally we refactor things just to keep things interesting.*