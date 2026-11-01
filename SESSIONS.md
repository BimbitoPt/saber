# Sessions — Saber (by Mstudio)

## 2026-10-27 — Harness & context-switch focus (Linux/Arch)

### Environment
- Cloned `bimbitopt/saber` → `/home/bimbito/saber`
- Bun 1.4.4 installed; deps installed; 208 tests pass (28 files)
- Docker image `saber-dev:latest` (196MB) built & verified
- `bun run build` + `bunx tsc --noEmit` pass

### Linux desktop (M7)
- Rust toolchain 1.99.1 installed; Tauri release build succeeded
- `Saber_0.1.0_amd64.deb` produced; extracted to `/home/bimbito/saber-local/`
- AppImage bundling fails on `linuxdeploy` (known WSL/Arch limitation)
- Binary running natively on Arch/Omarchy (Hyprland) — PID 976574

### Harness improvements
- `src/server.ts`: `errorResponse()` now surfaces actual error message instead of generic "Request failed"; `profileError()` no longer overrides with generic text
- Added `scripts/verify-harness.ts` + `bun run verify:harness` (passes)
- Extended `docs/harness/diagnostics.md` with Harness verification section
- Fixed trailing comma in `package.json`

### Context-switch verification
- A→B→A task switching verified live on native Linux desktop (distinct cwds, marker output, sessions survive switches)
- `src/lib/taskSwitcher.ts` + tests green
- Responsiveness benchmark (`bench:responsiveness`) blocked: Windows-only (PowerShell memory probe)

### Open gaps
- Native Tauri A→B→A terminal smoke (partially closed: switching works)
- Responsiveness benchmark cross-platform port (PowerShell → /proc)
- AppImage/pacman packaging for Arch

## 2026-10-29 — Bench cross-platform port (Linux/Arch)

- Spec: `docs/superpowers/specs/2026-10-29-bench-cross-platform-probes.md` (BCP-01..06)
- `scripts/bench-probes.ts` + `scripts/bench-probes.test.ts`: `/proc/<pid>/stat` comm/RSS parsing, `/etc/os-release` PRETTY_NAME parse, 10 tests incl. live `/proc` check
- `scripts/bench-responsiveness.ts`: Linux memory probe (sum RSS of `chrome-headless*` via /proc, PAGESIZE from getconf), Linux host block (os.release/cpus/totalmem/distro), detached server spawn + process-group SIGKILL cleanup, receipt path platform-suffixed on non-win32 so the Windows receipt cannot be overwritten
- Windows PowerShell paths preserved verbatim for win32
- `bunx tsc --noEmit` clean; `bun run test` 218 pass (29 files); `bun run verify:harness` OK
- First full 10-minute run failed on a lost streaming page state (opaque `TypeError`, no diagnostics); added BCP-06 fail-fast gate: 5 s in-loop health probe, navigation log (offset + URL), buffered browser errors
- Second full run (no repo edits during the run, i.e. no HMR reload source) passed; Linux receipt at `2026-09-23-responsiveness-baseline-verification.linux.json`: selection p95 32.5 ms (budget 200), render p95 20.6 ms (budget 500), sequence integrity clean at 20.003 evt/s/stream, memory plateau (slope 4.6 MB/min), host `linux 7.2.8-9-omarchy x64 (Omarchy)`
- Open gaps
  - Responsiveness benchmark cross-platform port: closed
  - AppImage/pacman packaging for Arch
  - Cause of the first-run lost page state is inferred (HMR from a mid-run edit), not reproduced; the BCP-06 gate will name the source if it recurs
