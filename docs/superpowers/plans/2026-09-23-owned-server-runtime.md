# Tauri-Owned Application Server Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Saber for Windows x64 with its own bundled Node 24.21.0 server, and have Tauri open the UI only after the owned server passes health checks.

**Architecture:** The existing Nitro `.output` tree is copied as an immutable Tauri resource. A checksum-pinned Node executable is bundled as a Tauri external binary. Rust launches either the development Vite child or the production Node child, parses that child’s loopback URL, checks `/api/v1/health`, creates a WebView at that exact URL, and retains the child handle for shutdown.

**Tech Stack:** Bun, TanStack Start/Nitro, Tauri v2, Rust standard process APIs, Windows x64 MSI/NSIS packaging.

## Global Constraints

- Implement the Windows x64 runtime only; Linux/macOS remain unverified.
- Pin Node.js v24.21.0 Windows x64 and verify it against the official `SHASUMS256.txt` before packaging.
- Bind to `127.0.0.1`; production uses `PORT=0`; development uses strict port 8082.
- Never adopt an unrelated process by probing a port; retain and stop only the child Saber started.
- Do not bundle Bun, provider CLIs, or repository checkout dependencies.
- Preserve the per-user API token/data location, task/run contract, and existing PTY ownership/cleanup.
- Do not edit generated `src/routeTree.gen.*` or `src-tauri/gen/**`.
- Use Bun for JavaScript package operations and run the existing Vitest suite.

---

## File map

- `scripts/prepare-tauri-runtime.ts` — download Node 24.21.0 x64, verify the official checksum manifest, stage the required Tauri target-suffixed executable, and stage the built `.output` resource tree.
- `src-tauri/binaries/` — ignored generated external binary directory; contains `node-x86_64-pc-windows-msvc.exe` after preparation.
- `src-tauri/resources/saber-server/` — ignored generated resource directory containing `.output` after preparation.
- `.gitignore` — exclude generated runtime payloads while keeping scripts/config tracked.
- `package.json` — add preparation, Tauri dev, and Tauri build scripts.
- `src-tauri/Cargo.toml` / `Cargo.lock` — keep the minimal Tauri dialog dependency for visible safe startup failures; use `std::process::Child` for server ownership without a process plugin.
- `src-tauri/tauri.conf.json` — enable Windows packaging, external binary and server resource mapping; remove the fixed localhost window URL so Rust creates it after health succeeds.
- `src-tauri/capabilities/default.json` — allow the dynamic `http://127.0.0.1:*` remote origin for the main window.
- `src-tauri/src/runtime.rs` — pure parsing and HTTP health helpers with unit tests.
- `src-tauri/src/main.rs` — start, monitor, own and stop the dev/production child; create main WebView only after readiness; preserve PTY cleanup.
- `docs/superpowers/specs/2026-09-23-owned-server-runtime.md` — record implementation and verification evidence after checks.

## Interfaces

- `runtime::parse_listening_url(line: &str) -> Option<SocketAddr>` accepts Nitro’s `➜ Listening on: http://127.0.0.1:<port>/` output or Vite’s `➜ Local: http://127.0.0.1:8082/` development output, rejecting all other hosts and ports.
- `runtime::health_check(address: SocketAddr, timeout: Duration) -> Result<(), String>` connects only to IPv4 loopback and requires HTTP 200 plus `{data:{status:"ok",apiVersion:<string>}}`; it accepts bounded Content-Length or chunked framing and returns when the response body is complete without waiting for keep-alive close.
- Tauri application state owns `Mutex<Option<std::process::Child>>`; a dedicated stdout reader reports the selected address, while the child handle is polled for early exit. Shutdown takes this exact handle, kills it, and waits for exit.
- Development command: `bun run dev --host 127.0.0.1 --port 8082 --strictPort`, working directory from `CARGO_MANIFEST_DIR/..`.
- Production command: bundled `node` external binary with `server/index.mjs`, working directory `resource_dir/saber-server/.output`, environment `HOST=127.0.0.1`, `PORT=0`.

## Task 1: Runtime preparation and deterministic package inputs

**Files:** `scripts/prepare-tauri-runtime.ts`, `package.json`, `.gitignore`

- [x] Add a preparation script that fetches `node-v24.21.0-win-x64.zip` and `SHASUMS256.txt` from the official Node distribution directory, reads the ZIP checksum line, calculates SHA-256 with `node:crypto`, and fails unless it matches exactly; extract `node.exe` from the verified archive.
- [x] Copy only verified `node.exe` to `src-tauri/binaries/node-x86_64-pc-windows-msvc.exe` and reject a staged file whose bytes differ from the extracted official executable.
- [x] Require the existing `bun run build` output at `.output/server/index.mjs` and `.output/public`; replace only the generated ignored `src-tauri/resources/saber-server/.output` directory and recursively copy `.output` there. The Node license is copied alongside these resources.
- [x] Add `.gitignore` entries for `src-tauri/binaries/*.exe` and `src-tauri/resources/saber-server/`.
- [x] Add `tauri:prepare-runtime`, `tauri:dev`, and `tauri:build` scripts. The full build command runs build, preparation, then Tauri packaging.
- [x] Run `bun run build` then `bun run tauri:prepare-runtime`; staged Node reported `v24.21.0` and server/public assets were present. The negative test that intentionally corrupts the staged executable was not run.

## Task 2: Tested URL parsing and health handshake

**Files:** `src-tauri/src/runtime.rs`, `src-tauri/src/main.rs`, `src-tauri/Cargo.toml`

- [x] Add unit tests for Nitro and Vite startup lines and rejection of `localhost`, IPv6, non-loopback IP, zero/out-of-range port, missing slash, wrong dev port, and unrelated output.
- [x] Implement `parse_listening_url` to accept only the owned-child production loopback line or Vite’s exact development loopback port.
- [x] Add health tests for content-length and chunked healthy responses, wrong status, malformed JSON, missing API version, refused connection, and read timeout. The chunked fixture deliberately holds its connection open after the final chunk.
- [x] Implement a bounded HTTP/1.1 GET to `/api/v1/health` with a `Host: 127.0.0.1:<port>` header and response body limit of 8 KiB; no token or third-party HTTP dependency is used.
- [x] Run `cargo test` from `src-tauri`; all 5 Rust tests pass.

## Task 3: Tauri-owned child lifecycle and dynamic window creation

**Files:** `src-tauri/src/main.rs`, `src-tauri/src/runtime.rs`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`

- [x] Spawn with `std::process::Command`: `bun` for development or `<resource_dir>/node.exe` for production. Pipe stdout and stderr, forward stdout lines on a dedicated thread, and drain stderr to a sink.
- [x] Read forwarded stdout lines for at most 120 seconds, poll `Child::try_wait`, reject invalid listening lines, and poll health for at most 20 seconds. Startup errors stay generic and stderr/arguments/environment are not logged.
- [x] In dev mode, spawn `bun run dev --host 127.0.0.1 --port 8082 --strictPort` from the `CARGO_MANIFEST_DIR` parent without checking or adopting the listener first.
- [x] In packaged mode, launch the external `<resource_dir>/node.exe` in the packaged `.output` folder with `HOST=127.0.0.1`, `PORT=0`, and only `server/index.mjs` as an argument.
- [x] Remove the configured fixed-URL main window and create a dynamic `WebviewWindow` only after health succeeds; retain window sizing and styling.
- [x] Show a safe native error dialog on startup/window creation failure and stop the owned child.
- [x] Preserve `TerminalSessions::close_all()` and kill/wait only the retained application-server child on exit; remove hard-coded checkout path, port adoption, and fixed-port probing.
- [x] Update capability remote URL allowance to `http://127.0.0.1:*` while retaining local window and terminal permissions.
- [x] Run `rustfmt --check src/main.rs src/runtime.rs` and `cargo test`. The pre-existing unrelated `build.rs` and `terminal.rs` formatting differences were left as-is.

## Task 4: Tauri bundling and clean build checks

**Files:** `src-tauri/tauri.conf.json`, `package.json`, `docs/superpowers/specs/2026-09-23-owned-server-runtime.md`

- [x] Configure `bundle.active=true`, MSI and NSIS targets, external binary `binaries/node`, and resource mapping to `saber-server/.output`.
- [x] Preparation refuses missing or mismatched runtime/server inputs; `tauri:build` runs web build, runtime preparation, then Tauri packaging in order.
- [x] Run `bun run test`, `bun run build`, `bun run test:terminal`, `cargo test`, `rustfmt --check src/main.rs src/runtime.rs`, and `bun run tauri:build`.
- [x] Extract the MSI and confirm it contains the Node executable, server entry and public assets. Windows resource paths are local application resources; no repo checkout or provider CLI is staged by the preparation script.
- [x] Record command results and open limitations in the feature spec.

## Task 5: Desktop runtime verification

**Files:** no application files unless evidence requires a correction; spec evidence updated in Task 4.

- [x] Run the packaged application while the existing `127.0.0.1:8082` Vite listener remains active. Production starts on an independent ephemeral port and the existing listener survives.
- [ ] Verify a harmless terminal marker from inside the packaged Tauri window. Rust PTY unit and `bun run test:terminal` smoke tests pass, but the packaged interactive terminal marker was not run.
- [x] Close the application gracefully and confirm its spawned Node PID and port exit; relaunch it and confirm a new port and persisted API token/tasks.
- [ ] Run Tauri development startup with port 8082 occupied and confirm the visible failure dialog. The exact Vite command was run separately: it exited with code 1 and left the existing PID unchanged.
- [x] Record Windows evidence and explicitly leave clean-account/VM installation and packaged PTY acceptance pending.

## Requirement coverage self-review

- OSR-01: Tasks 1 and 4 checksum-pinned executable, complete server resource tree, and MSI/NSIS package extraction.
- OSR-02: Tasks 2 and 3 parse the child’s own output and require a bounded healthy API response before WebView creation; multiple production launches verified distinct ports.
- OSR-03: Production app started while 8082 was occupied; Vite strict-port failure left the existing listener unchanged. Tauri dev error dialog itself remains unverified.
- OSR-04: Task 3 retains the precise child; app close/restart verification confirms the child/port stopped and a new port was selected.
- OSR-05: Full unit/build/terminal checks pass and the packaged task board rendered; packaged interactive terminal marker remains unverified.
- OSR-06: Production binds to IPv4 loopback, health contains only status/version, unauthenticated task reads return 401, and authenticated reads return persisted tasks.

## Plan self-review

- File ownership is mapped before tasks; generated Tauri schemas are intentionally not edited.
- Tauri resolves the Windows resource directory to the executable directory; the release layout must keep `node.exe` beside the app and `saber-server/.output` beneath that directory.
- Installer creation does not equal clean-account installation. The completion record must separate build evidence from install/runtime evidence.
