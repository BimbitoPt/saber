# Tauri-owned application server runtime

## Status and authorization

**Status:** Implemented and verified on Windows x64; clean-account installation and packaged PTY smoke remain pending.

## Problem and user workflow

The current Tauri host loads `http://localhost:8082`, starts `bun run dev` from a hard-coded repository path, and reuses any process already listening on port 8082. A packaged app therefore depends on a development checkout and can attach its UI to an unrelated local process. The webview can also open before Saber’s own server is ready.

After this slice, launching Saber starts its bundled local application server, waits for its authenticated-API health readiness, and then opens the UI at the exact loopback address owned by that process. Closing Saber stops that server. Development continues to use the strict Vite port 8082, and provider CLIs remain user-managed tools.

## Scope and exclusions

**In scope:**

- Windows x64 production runtime using the latest approved Node 24 LTS patch pinned for each release; Node 24.21.0 is the current release target.
- Package the Node executable as a Tauri external sidecar, plus the built `.output` server assets as app resources. Verify the official Node distribution checksum during sidecar preparation.
- Tauri Rust host owns server startup, readiness parsing, health polling, dynamic WebView URL, failure display, and shutdown.
- Start the production server on `127.0.0.1` with port `0`; accept only an address parsed from the owned process and confirmed by `GET /api/v1/health`.
- Development mode may start Saber’s own Vite server on strict port 8082 from the Cargo manifest workspace. If that port is busy, fail visibly; never reuse an unverified listener.
- Tauri bundles a Windows installer artifact with the server and Node runtime; verify install, launch, API/UI, restart, and shutdown on a clean Windows account or VM.
- Preserve the local API token/data directory, task/run semantics, existing Tauri PTY boundary, and user-installed provider setup.

**Excluded:**

- Linux/macOS runtime implementation or verification in this Windows slice.
- Saber CLI implementation, remote/LAN API, multi-user access, provider installation/authentication, provider CLI bundling, Docker, databases-as-containers, or microservices.
- Replacing the existing task store or changing API contracts.
- Installer auto-update/signing infrastructure, telemetry, or app-store distribution.

## Requirements and acceptance criteria

### OSR-01 — Bundle the supported runtime

The Windows x64 installer includes a pinned Node 24 LTS `node.exe` sidecar extracted from the official Windows x64 ZIP, whose SHA-256 is verified against the official distribution manifest, and the complete built `.output` server/public asset tree at a deterministic resource path. Tauri declares the sidecar as an external binary using its required `x86_64-pc-windows-msvc` target suffix. The production build does not rely on a globally installed Node/Bun executable or the repository checkout. Provider CLIs are not included.

**Acceptance:** build preparation rejects a missing or checksum-mismatched Node binary; `bun run tauri build` creates the configured Windows installer; inspecting installed files confirms Node and server assets ship with Saber, while no repository path or provider executable is bundled.

### OSR-02 — Own startup and readiness

Tauri starts its bundled Node server with `HOST=127.0.0.1`, `PORT=0`, and the bundled server resource as its working directory. It accepts only a startup address with the `127.0.0.1` host and a valid nonzero port parsed from that child’s stdout, then confirms readiness through `GET /api/v1/health` before creating/navigating the main WebView. Timeout, malformed output, early child exit, or failed health returns a visible launch error and never opens a page served by another process.

**Acceptance:** Rust tests cover valid/invalid address parsing and process failure. Integration checks start multiple app-server instances and prove each receives its own port; reserve port 8082 externally and prove production Saber still starts on another port. Delay/disable health and confirm the UI does not navigate until ready.

### OSR-03 — Never adopt an unowned listener

The desktop host never infers Saber ownership from an open TCP port. In development it launches its own `bun run dev` from `CARGO_MANIFEST_DIR` using loopback and strict port 8082; if the port is unavailable or another server answers health, startup fails visibly without connecting to that server. In production, port 0 avoids fixed-port collisions.

**Acceptance:** start a dummy HTTP server on 8082 and attempt development launch; Saber must show a startup failure, send no UI/API request to the dummy service, and never terminate the dummy server. Run production with the dummy service present and confirm the bundled server starts on a different port.

### OSR-04 — Stop only Saber-owned processes

Tauri retains a handle to its exact server child and stops it during normal app exit, startup failure, and WebView-creation failure. It does not run `taskkill` against a port or PID discovered by scanning the machine. Existing Tauri PTY cleanup still runs on app exit. On restart, the app creates a new server and does not silently attach to a prior process.

**Acceptance:** an integration run records the spawned process identity, closes Saber, and proves that process/port exits while the unrelated 8082 dummy service remains alive. Repeat after restart and verify task data/token persist and no second orphan Saber server remains.

### OSR-05 — Preserve development and existing product behavior

Development still serves `http://localhost:8082/` when port 8082 is free. The task workspace, board, provider readiness, local API, and task-owned terminal continue to behave as before. Server startup errors are clear and actionable without exposing command lines, local paths, or token contents.

**Acceptance:** run `bun run dev`, launch the Tauri development window, inspect the task board, open a task terminal and run a harmless marker command, read health and authenticated task resources, then close the app and confirm owned dev process cleanup. Existing API, terminal, and app tests pass.

### OSR-06 — Keep the API local and authenticated

Both development and packaged app servers bind only to IPv4 loopback. The runtime does not print the bearer token or add it to arguments, URL, environment, or logs. The health handshake returns only status/version; authenticated data reads still require the existing private token. The installed WebView uses the exact owned loopback origin.

**Acceptance:** inspect listener address and startup arguments/environment allowlist; verify no `0.0.0.0`, `::`, LAN, or wildcard CORS listener exists; verify health is minimal, task reads without a token return 401, and the authenticated local API works after install.

## Data and lifecycle

Node sidecar version and checksum are recorded by the build preparation script. Server assets are immutable installation resources. App data (SQLite, bearer token, and logs) remains in the existing per-user Saber data directory and survives installer updates. The server binds only to loopback and owns its selected port until shutdown. Tauri owns the server process handle; a port number alone never authorizes attach or termination.

The Node sidecar is not a service manager. Provider processes remain Saber-managed per-run children, and interactive terminals remain Rust/Tauri-owned PTYs. Closing Saber must continue the existing PTY shutdown behavior and terminate the application server it spawned. Whether active provider runs should be stopped or left interrupted is not changed by this runtime slice; existing persisted run recovery remains authoritative.

## Verification plan

| Requirement | Automated verification | Manual verification |
| --- | --- | --- |
| OSR-01 | Preparation verifies the official archive checksum and the staged executable; Windows MSI and NSIS builds pass. | MSI administrative extraction includes the app executable, Node sidecar, server entry, and 8 public assets. Clean-account installation is pending. |
| OSR-02 | Rust tests cover strict address parsing, content-length and chunked health responses, malformed/non-200 health. | Multiple release launches each chose a distinct port and opened only after health succeeded. A keep-alive chunked response was tested while its socket remained open. |
| OSR-03 | Development Vite collision check exits 1 when 8082 is occupied; the original listener PID remains unchanged. | Production Saber launched successfully while the unrelated 8082 development server remained running. Tauri development collision dialog was not manually exercised. |
| OSR-04 | Rust terminal tests pass; app child identity and listener were observed across normal window close/restart. | Updated MSI-extracted app PID 2828 gracefully closed; its exact Node child PID 19712 exited and released port 55873. Packaged PTY close is pending. |
| OSR-05 | Full Vitest suite, production web build, Rust tests, and terminal smoke pass. | Updated MSI-extracted app rendered the task workspace and the context preview (7 tasks; 2 ready for review; 1 verified). The context preview was inspected in a browser against the packaged server; native packaged PTY marker remains pending. |
| OSR-06 | Health contract and authenticated API behavior verified against the packaged runtime. | Updated packaged listener was `127.0.0.1:55873`; health returned status/version and task reads returned 401 without a token. Linux Node server at `127.0.0.1:40295` returned the same health contract and 401. |

`bun run test` passed on Windows (15 files, 82 tests); `bun run test:terminal` passed on Windows (3 files, 13 tests, plus two Rust PTY tests); `cargo test` passed on Windows (5 tests); `rustfmt --check src/main.rs src/runtime.rs` passed; and `bun run tauri:build` passed after the context-preview update and produced MSI and NSIS installers. The build reports existing Rolldown `use client` directive warnings.

## Completion evidence

The Node v24.21.0 Windows x64 archive was verified against the official manifest; SHA-256: `158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541`. The staged executable reported `v24.21.0`. The preparation script rejects an existing staged executable whose bytes differ from the verified archive and stages the complete `.output` tree plus Node license.

`bun run tauri:build` produced `Saber_0.1.0_x64_en-US.msi` (40,448,000 bytes) and `Saber_0.1.0_x64-setup.exe` (27,324,547 bytes in the 2026-09-24 rebuild). MSI administrative extraction confirmed `mstudio-ade.exe`, `node.exe`, `.output/server/index.mjs`, and 8 public asset files. The extracted MSI application launched from its extracted install directory with Node `24.21.0`, selected `127.0.0.1:53931`, and rendered the board. `/api/v1/health` returned `{ data: { status: "ok", apiVersion: "1.0.0" } }`; unauthenticated task reads returned `401`; the saved private token returned 7 tasks. The listener remained on IPv4 loopback while the existing dev server occupied port 8082.

Two simultaneous application launches used distinct ports (`127.0.0.1:50065` and `127.0.0.1:56741`). Gracefully closing each app stopped its own Node child and released the port; starting again used another port (`50417`). A development Vite launch against the occupied 8082 port exited with code 1 and left the existing listener PID unchanged. On 2026-09-24 the updated MSI and NSIS bundles rebuilt successfully. Administrative extraction of the updated MSI confirmed the app binary; the extracted app launched as PID 2828 with its Node child PID 19712 bound to `127.0.0.1:55873`. Health returned status `ok`, API version `1.0.0`, and task reads without a token returned `401`. The packaged task board and M6 context preview rendered against that server. Closing the app window gracefully stopped PID 2828 and Node PID 19712 and released port 55873.

Linux partial verification on 2026-09-24: a WSL Ubuntu 26.04 harness compiled the production Rust host and passed all 5 Rust tests with `--test-threads=1`, including PTY output and requested working directory. The first direct test run identified missing GTK/WebKit development dependencies; after installing the documented packages in the Ubuntu WSL distro, compilation advanced to the project target. Direct Cargo compilation also needed a temporary `icons/icon.png` derived from the checked-in ICO. Running all Rust tests concurrently repeatedly flaked the 1-second loopback health fixture, while serial execution passed (the focused test also passed individually). A target-compatible Node 24.21.0 sidecar was staged after verifying the official checksum. Both the temporary icon and Linux sidecar remain as local build inputs because the environment rejected the cleanup command; they are untracked workspace files and should be removed before committing. Linux Node v22.22.1 also launched the built Saber server on `127.0.0.1:40295`; health passed and task reads without a token returned `401`.

Linux desktop packaging and launch are still unsupported by this Windows-only runtime slice: production startup currently expects the Windows `node.exe` resource, the development path expects `bun`, and the Tauri bundle targets are MSI/NSIS. A direct Linux app launch was therefore not counted. The Linux-target Cargo tests and API server smoke do not establish Linux Tauri UI or packaged PTY support. macOS remains untested.

Still pending: MSI installation into a clean Windows account/VM, a harmless terminal marker command inside the packaged Windows Tauri window, and packaged PTY cleanup. Linux desktop runtime, packaging, and native PTY support need a separate versioned feature slice before implementation. The CLI, provider binaries, and remote access remain out of scope.

## References

- [Tauri external sidecar binaries](https://v2.tauri.app/develop/sidecar/)
- [Tauri bundled resources](https://v2.tauri.app/develop/resources/)
- [Official Node.js 24.21.0 LTS release](https://nodejs.org/en/blog/release/v24.21.0)
