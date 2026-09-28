# Saber Terminal-First Remake Roadmap

## Product Target
Open a task in Saber, type ordinary shell commands in its native terminal, switch to another task without losing the first shell, and return with the correct task context.

## Keep
- Persistent task/spec/checkpoint records and task/run separation.
- OpenCode, Codex, and Claude Code adapters as optional run controls.
- Isolated Git worktrees, review, verification evidence, and the Kanban overview.
- Tauri v2 desktop shell, Bun, TanStack Start, Tailwind v4, and Vitest.

## Replace
- The task dashboard as the primary landing surface.
- Provider-run buttons as the assumed way to work with coding agents.
- Shared dev-server/browser panes as the main workspace navigation.

## Defer
- Terminal splits, SSH/remote shells, command recording/replay, automatic context injection, autonomous swarms, cloud execution, and automatic merge/deploy.
- Terminal-first visual redesign beyond the first working desktop slice.

## MVP Vertical Slice
User journey: select a task with an isolated worktree, open its OS shell in Saber, run a command, switch to another task, and return to the first still-live shell and checkpoint.

Receipt: `bun run test:terminal`

## Milestones
### M1: Native interactive terminal
Outcome: Saber opens a real host shell in the selected task's effective directory, displays interactive PTY input/output through xterm.js, and reports unavailable shells clearly. Browser-only mode explains why a desktop runtime is required.

Receipt: `bun run test:terminal`

Status: Complete on the Windows host, 2026-09-23. Evidence: `docs/superpowers/specs/2026-09-22-terminal-first-workspace-verification.md`. Linux/macOS remain untested.

### M2: Task-owned context switching
Outcome: Each task restores its own live PTY and checkpoint. Overlapping terminal sessions and agent runs are serialized; separate worktrees may proceed concurrently. Verify A -> B -> A in Tauri and record session recovery behavior.

Receipt: `bun run test -- src/server/taskStore.test.ts src/server/terminalLocks.test.ts src/server/agentRuns.test.ts`, `bun run test:terminal`, and the Tauri flow in the verification receipt.

Status: Complete on Windows, 2026-09-23. Evidence: `docs/superpowers/specs/2026-09-22-terminal-first-workspace-verification.md`. Linux/macOS remain untested.

## Active Slice
M3 responsiveness baseline is complete on Windows. Evidence: `docs/superpowers/specs/2026-09-23-responsiveness-baseline-verification.md` and raw JSON samples. Selection p95 and xterm render p95 meet their budgets; the later-half Chromium memory footprint plateaus. A current-workspace smoke rerun on 2026-09-23 passed with 10 isolated tasks, 10 A/B pairs, 486 rendered output samples, no sequence gaps, and both latency budget checks passing; its 8-second duration is not used to classify memory. No runtime behavior changes were justified by this measurement. Linux/macOS and native Tauri/WebView memory remain untested.

M4 keyboard task switcher is complete and verified on Windows in both browser preview and native Tauri. Spec and requirement evidence: `docs/superpowers/specs/2026-09-23-keyboard-task-switcher.md`. Full `bun run test` passed (13 files, 61 tests); the existing 2,105-event stress test now uses a 15-second per-test timeout. Type check, production build, and diff check passed. Browser checks covered the global shortcut, title filtering, task selection, ignored task-form shortcut, Escape, and focus restoration. Native checks confirmed Ctrl+Shift+P works from a live PowerShell PTY, task switching shows the selected task's saved checkpoint, and returning restores the same idle shell prompt without typing a command or unlocking an interrupted session. Linux/macOS remain untested.

The supplemental native PTY receipt `bun run test:terminal` passed on Windows after making the location output explicit in the PowerShell test and releasing the child, PTY, and reader handles before temporary-directory cleanup (2 Rust and 13 focused Vitest tests).

M5 recent-task ordering is complete and verified on Windows. Spec, requirement receipts, and implementation plan: docs/superpowers/specs/2026-09-23-recent-task-switcher-design.md and docs/superpowers/plans/2026-09-23-recent-task-switcher.md. Ten focused cases and the full suite (13 files, 67 tests) pass; TypeScript and production build pass. Browser preview verified recent-first ordering, search across groups, keyboard selection, reload persistence, and stable ordering of the remaining tasks. Native Tauri verified grouped ordering and A-B-A selection through the palette: selecting the already-interrupted task preserved its lock/checkpoint, and returning to the original task showed the same idle PowerShell prompt. No shell was launched, unlocked, or sent a command. Linux/macOS remain untested.

M6 context preview is implemented and verified in the Windows browser preview and against the rebuilt MSI's packaged server. The approved design and plan are in `docs/superpowers/specs/2026-09-24-resume-context-faster.md` and `docs/superpowers/plans/2026-09-24-resume-context-faster.md`. The highlighted result previews its saved checkpoint and next-action draft; arrow navigation and filtering kept the preview aligned, and Escape left selection unchanged. Ten focused switcher tests, TypeScript, production build, and updated Windows MSI/NSIS packaging pass. Long-text scrolling, pointer navigation, Enter selection, and focus restoration remain unverified. Linux WSL now has the Tauri development dependencies installed and all five Rust tests pass serially, including the real Linux PTY marker. The Linux-built API server also passed health/auth smoke checks. Native Tauri launch and packaging remain unsupported by the Windows-only runtime setup (it requires `node.exe` in production and Bun for development, and configures MSI/NSIS bundles); implement them only after a separate Linux runtime spec. macOS remains untested.

## Active Slice: M7 Linux desktop runtime

M7 implementation has produced checksum-verified Linux Node preparation, platform-aware runtime paths, Linux `.deb`/AppImage configuration, and a dedicated Linux build command. Three default-parallel Rust runs pass on Windows, and five additional consecutive runs pass on Ubuntu 26.04 WSL (8 tests each). Both Linux package artifacts built and their resource layout was inspected. The packaged API returns minimal health and unauthenticated 401 while the desktop stays open when launched in a detached WSLg session; a temporary Node probe confirmed that the earlier exit was `SIGHUP` from the shell used by the test launcher. The Rust stdout reader also now drains after startup readiness. The Windows Vitest, terminal, TypeScript, production build, MSI, and NSIS checks passed before this final Rust reader fix; rebuild Windows installers after the fix before closing M7.

M7 remains incomplete: the `.deb` was extracted for launch rather than installed, and native task-terminal marker/cwd, A-B-A recovery, and graceful owned-child shutdown remain unverified because native UI controls are unavailable to this session. See evidence and limitations in `docs/superpowers/specs/2026-09-24-linux-desktop-runtime.md`; next work is to complete the packaged UI acceptance and rerun Windows MSI/NSIS packaging after the final Rust reader change. This receipt covers Ubuntu 26.04 WSL2 only and does not claim general Linux distro or macOS support.

Windows has two separate outstanding runtime receipts: packaged PTY marker/cleanup and installation under a clean Windows account or VM. Complete them after M7, or earlier if native app interaction becomes available. Do not use the browser preview or PTY unit test as a substitute for the packaged-window terminal flow.

## Coordinator Decisions
- Native PTY process ownership stays in the Tauri runtime. The UI uses xterm.js; do not expose a browser-addressable shell-spawn endpoint.
- Windows uses the discovered user shell, preferring PowerShell 7 and falling back to Windows PowerShell. Linux/macOS uses `$SHELL` or `/bin/sh`.
- Terminal sessions are distinct from agent runs. Never infer task completion or verification from shell output.
- Task effective directory is captured when its session starts. Use the managed worktree when valid; never fall back from a missing managed worktree to the source checkout.
- Keep project identity separate from checkout/worktree path and preserve the no-overlapping-writers rule.
- Run terminal sessions only from the Tauri desktop shell. `http://localhost:8082/` must not spawn local processes.

## Replan Gate
M1 and M2 are complete on Windows. M2's focused and full Vitest receipts, native PTY tests, TypeScript check, production build, task-switch/context-copy flow, restart recovery, and app-close process cleanup are recorded in the verification receipt. Linux/macOS remains outside current-host evidence. M3 is limited to a repeatable benchmark and evidence-based follow-up.

## Worker Brief
Outcome: M1–M6 complete on Windows to the limits recorded in their receipts. M5 recent-task ordering is verified in browser and native Tauri. M6 previews saved checkpoint and next-action text in the task switcher. All five Linux Rust tests and the Linux Node API server passed in WSL, but native Linux Tauri runtime/package support is not implemented in the Windows-only runtime slice. Packaged Windows PTY and clean-account installer verification also remain outstanding; do not report these as complete without their receipts.
Files: `src-tauri/Cargo.toml`, `src-tauri/build.rs`, `src-tauri/src/main.rs`, `src-tauri/src/terminal.rs`, `src-tauri/capabilities/default.json`, `package.json`, `scripts/verify-terminal.ts`, `src/server/terminalLocks.ts`, `src/server/terminalLocks.test.ts`, `src/server/agentRuns.ts`, `src/server/agentRuns.test.ts`, `src/server.ts`, `src/components/TerminalSurface.tsx`, `src/components/TaskWorkspace.tsx`, `src/routes/index.tsx`, and `src/lib/api.ts`.
Guardrails: preserve task/run separation and immutable run scope; do not expose shell spawning over HTTP/WebSocket; do not silently launch or type commands; do not edit `src/routeTree.gen.*` or `src-tauri/gen/**`; use Bun only; do not claim cross-platform success from one host.
Acceptance: preserve the M1 receipt and platform caveat; M2 results are recorded in the verification receipt; do not silently relaunch a process after restart or release an uncertain workspace lock. For M3, use only disposable data and do not optimize without measurements.
