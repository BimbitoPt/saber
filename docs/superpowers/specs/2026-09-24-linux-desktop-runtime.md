# Linux desktop runtime and packaging

## Status and authorization

**Status:** Implementation in progress. Linux x64 builds and API smoke checks pass in the user's Ubuntu 26.04 WSL environment. The apparent server exit was caused by the shell-based WSL test launcher sending `SIGHUP`; launching the app in a detached WSLg session keeps the packaged server alive. Omarchy was confirmed running the packaged Saber AppImage; the launcher PID exited after the app was closed, and the remaining reported process was the system document-portal `fusermount3` mount helper. Packaged app-close cleanup passed; packaged terminal marker/cwd and A-to-B-to-A restoration remain incomplete, with the user's A-to-B-to-A attempt reporting that task A's marker and original terminal did not appear after returning. This does not claim general Linux distribution support.

## Problem and user workflow

Saber's desktop host and package preparation currently target Windows. The production runtime looks for `node.exe`, development expects `bun`, the checked-in icon set has only an ICO, and the base bundle configuration emits MSI/NSIS installers. Linux Rust and API checks pass in WSL, but Saber cannot yet be launched as a Linux desktop app from the current build workflow.

After this slice, a developer can prepare a verified Linux Node sidecar, build and launch Saber as a Linux Tauri app, and use a task-owned Linux shell from the native terminal. Windows remains the existing supported and verified target.

## Scope and exclusions

**In scope:**

- Linux x86_64 (`x86_64-unknown-linux-gnu`) build and runtime preparation for the pinned Node 24.21.0 release, with SHA-256 checked against the official Node manifest.
- Production server startup from the bundled Linux Node executable and packaged `.output` resources; production launch must not require Bun, a global Node installation, the repository checkout, or a provider CLI.
- Linux development startup through the user's Linux Bun installation on strict loopback port 8082.
- Tauri Linux configuration and build scripts for Debian (`.deb`) and AppImage artifacts, without changing Windows MSI/NSIS targets.
- Linux app icon assets sufficient for Tauri context generation and Linux package metadata.
- Robust default-parallel Rust tests for the local health handshake and Linux PTY behavior.
- End-to-end validation in Ubuntu 26.04 on WSL: build, package, launch, health/auth checks, task shell marker in the requested directory, and owned-process shutdown.

**Excluded:**

- macOS, Linux ARM64, RPM, Snap, Flatpak, AUR, native Linux hardware outside the available WSL machine, and a broad minimum-distro compatibility claim.
- Changes to task/run ownership, API contracts, provider adapters, workspace isolation, or terminal UI behavior.
- Bundling Bun, Node for development, provider CLIs, Docker, databases, or microservices.
- Replacing the Windows runtime or weakening its existing MSI/NSIS acceptance.

## Requirements and acceptance criteria

### LDR-01 — Prepare a verified Linux sidecar

Runtime preparation selects the Linux x64 Node archive for the target, verifies its SHA-256 using Node's official release manifest, validates the extracted `node --version`, and stages it at the Tauri-required `node-x86_64-unknown-linux-gnu` external-binary path. It stages the same complete server asset tree used by Windows. A failed download, manifest lookup, checksum, architecture, or version check fails before packaging.

**Acceptance:** Linux preparation succeeds from a clean build-input state and rejects a deliberately mismatched archive or staged binary. Windows preparation and its staged Node hash remain unchanged and pass.

### LDR-02 — Resolve and own the packaged Linux server

Production startup resolves the Node executable and server resources using Tauri's Linux resource layout. It starts the exact bundled child on IPv4 loopback with an ephemeral port, accepts only that child's parsed listening address, requires the existing health contract before creating the WebView, and kills/waits only for the owned child on failure or shutdown. It does not look for `node.exe`, invoke Bun, adopt an existing port, or expose the API beyond loopback.

**Acceptance:** launch the packaged Linux app while port 8082 is occupied; verify its own distinct loopback port, minimal successful health response, 401 for unauthenticated task reads, and exact child/port cleanup after close.

### LDR-03 — Keep Linux development startup explicit

In Linux debug builds, Saber starts the installed Linux `bun` command from the workspace root on `127.0.0.1:8082` with strict-port behavior. If the port is already occupied, startup fails visibly and leaves the existing listener untouched. Production builds never depend on Bun.

**Acceptance:** launch Linux development with port 8082 free and observe the task UI; repeat with a dummy listener on 8082 and verify a startup failure without connecting to or stopping the dummy process. Inspect production command construction to ensure Bun is not used there.

### LDR-04 — Produce Linux desktop artifacts

The Linux-specific Tauri config merges with the shared config and selects Debian and AppImage targets. It includes a valid Linux icon and package metadata and records the required WebKitGTK/GTK runtime dependencies. Windows bundle target configuration and installer output remain unchanged.

**Acceptance:** produce both `.deb` and `.AppImage` artifacts, inspect their installed resource trees for the Linux sidecar and `.output` server assets, and confirm the binaries are executable. Run the `.deb` on the same Ubuntu 26.04 WSL environment used to build it. Do not claim compatibility with older distributions from this result.

### LDR-05 — Preserve native task-terminal behavior

Linux native terminal sessions continue to use the user's `$SHELL`, start in the task's effective directory, round-trip input/output through the PTY, resize safely, and close with the application. Terminal shell creation remains inside the Tauri runtime and is not exposed through HTTP or WebSocket.

**Acceptance:** run a harmless unique marker command from a task terminal in the packaged app, verify the marker and working directory, switch away and back without launching another shell, then close Saber and verify its owned terminal child and server child exit. Existing Windows native terminal behavior remains unchanged.

### LDR-06 — Make platform tests reliable

The Rust test suite passes using Cargo's default parallel runner in WSL, including health-handshake fixtures and the Linux PTY test. The current one-second health fixture must not intermittently time out because of local scheduler contention.

**Acceptance:** run `cargo test` at least three consecutive times in Ubuntu 26.04 with the default test-thread behavior; all runs pass. Run `bun run test`, `bun run test:terminal`, `bunx tsc --noEmit`, `bun run build`, and the Windows MSI/NSIS build after the runtime changes; all existing Windows receipts remain green.

## Design constraints

- Keep platform-specific packaging configuration in Tauri's supported `tauri.linux.conf.json` merge file. Keep shared task/API configuration in `tauri.conf.json`.
- Use the target triple and platform resource layout rather than extension guessing or a hard-coded Windows resource path.
- Keep Node pinned at v24.21.0 for this slice; platform selection changes the archive and executable format, not the release version.
- Do not commit generated Tauri schemas. Source icon assets may be added only as normal reviewed product assets.
- WSL Ubuntu 26.04 is the first end-to-end test host, not the minimum supported Linux release. A broader compatibility claim requires a later build/test matrix using the oldest intended base distribution; current Tauri documentation warns that glibc compatibility depends on the build base.

## Verification plan

| Requirement | Automated verification | Manual/system verification |
| --- | --- | --- |
| LDR-01 | Checksum/version/target-name preparation tests, including mismatch rejection. | Inspect staged Linux sidecar and compare its checksum to the official manifest. |
| LDR-02 | Rust runtime parsing/health/lifecycle tests. | Launch packaged app with port 8082 occupied; verify health, auth, and process/port shutdown. |
| LDR-03 | Strict-port tests and command construction checks. | Open the Linux task UI and verify visible collision behavior. |
| LDR-04 | Linux Tauri bundle build and artifact inspection. | Install/run the `.deb`; launch AppImage; verify UI startup. |
| LDR-05 | PTY tests for requested cwd, marker output, resize, and close. | Enter marker in packaged task terminal, switch A-B-A, and close the app. |
| LDR-06 | Three default-parallel Cargo runs and full existing web/Windows checks. | None. |

## References

- [Tauri external sidecars](https://v2.tauri.app/develop/sidecar/) — platform target-triple naming.
- [Tauri configuration files](https://v2.tauri.app/develop/configuration-files/) — platform-specific config merge.
- [Tauri Debian packaging](https://v2.tauri.app/distribute/debian/) — package dependencies and build-base limits.
- [Tauri AppImage packaging](https://v2.tauri.app/distribute/appimage/) — portable artifact behavior and glibc limits.

## Verification evidence — 2026-09-24

- `cargo test --manifest-path src-tauri/Cargo.toml` passed three consecutive times with Cargo's default parallel test runner on Windows (8/8 each run). On Ubuntu 26.04 WSL, five consecutive full runs passed (8/8 each run) after making the fixture ignore unrelated loopback port probes and only respond to the health request. The fixture uses a test-only five-second response window, joins fixture threads, and retains timeout/refusal coverage; production timeout limits are unchanged.
- Startup diagnosis: when Saber was started by a shell command and that WSL shell ended, a temporary Node signal probe recorded `SIGHUP` on the child while the Saber process remained alive. Starting the same packaged app with `setsid -f` detached it from the command shell; the uninstrumented extracted `.deb` binary and its bundled Node server stayed alive for over 100 seconds, and a signal-instrumented run stayed alive for over six minutes. The earlier “server crash” was a test-launcher artifact, not a packaged app timer. The Rust stdout reader was also hardened to keep draining after its startup receiver is dropped; two regression tests cover that pipe lifetime.
- Linux runtime preparation verified Node v24.21.0 against the official Node release checksum manifest and staged the Linux x64 binary with executable permissions. The staged binary SHA-256 was `7fde7b8afa198da66257f42ee2001d874c7355631e6d1579a5fb5ef1f246df4c`; archive checksum prefix: `fd8e59d5a511`.
- Target-selection and checksum-verification tests passed (7/7). Linux API tests (87/87), Linux TypeScript, and the Linux production web build passed. The Ubuntu 26.04 release build produced `Saber_0.1.0_amd64.deb` (52,993,126 bytes) and `Saber_0.1.0_amd64.AppImage` (127,261,176 bytes). Package inspection confirmed executable `usr/bin/node` and `usr/bin/mstudio-ade`, the server entry, public assets, and the packaged application icon.
- Environment: Ubuntu 26.04 LTS on WSL2 kernel `6.6.114.1-microsoft-standard-WSL2`, Rust `1.96.0`, Tauri CLI `2.11.4`, target `x86_64-unknown-linux-gnu`, Node `v24.21.0`. WSLg emitted Mesa/EGL graphics initialization warnings; its exact component version was not captured. The extracted `.deb` app and AppImage `AppRun` both launched. With a separate listener occupying `127.0.0.1:8082`, a detached Saber launch selected an ephemeral IPv4 loopback port (`39755` in the long-lived instrumented run); the packaged health endpoint returned only status/API version and unauthenticated `GET /api/v1/tasks` returned 401. The uninstrumented `.deb` launch also remained healthy on a separate port after 100 seconds.
- The native PTY Rust round-trip test and focused terminal Vitest suite passed on Linux (2 Rust + 13 Vitest). Those automated checks do not replace the packaged UI flow. In Omarchy, the user confirmed `pwd` returns `/home/bimbito` and `ls /mnt` lists the shared folder at `/mnt/host`. The packaged AppImage launched and its recorded launcher PID exited after app close; a process scan returned only `fusermount3` for `/run/user/1000/doc`, not a Saber process. During A-to-B-to-A, the user reported task A's marker and original terminal did not appear after returning. This is a **failed LDR-05 manual acceptance**, pending diagnosis and retest.
- Repeat check during follow-up: the detached extracted `.deb` processes were still alive (`mstudio-ade` PID 2619 and bundled Node PID 2629); health returned 200 and an unauthenticated task read returned 401. Windows `bun run test:terminal` passed again (2 Rust + 13 Vitest).
- Omarchy follow-up: the installed Try Omarchy preview (`v0.0.18-preview`) hit a WHPX retry wedge and stale private-control-socket error. Its authenticated updater had staged v0.3.0, which was launched against the existing VM disk with CPU rendering; the guest reached userspace. The Linux Debian package and AppImage were copied to the shared folder. SSH access was turned off again after the personalized guest rejected the temporary key and password login was unavailable. The AppImage was launched through a helper script; marker/task-switch checks remain pending.
- Omarchy AppImage follow-up: `Saber_0.1.0_amd64.AppImage` and a small copy/background-launch helper were placed in `/mnt/host`. The user confirmed the app works. After closing Saber, the recorded launcher PID reported `App process exited`; the process scan showed only `fusermount3` for `/run/user/1000/doc`, a desktop document-portal mount helper, not a Saber process. Owned app/server cleanup is verified for this run. The user then reported that task A's marker and original terminal did not reappear after switching A-to-B-to-A; diagnose and fix before marking LDR-05 complete.
- Windows verification passed after the runtime changes: full Vitest 87/87, terminal suite (2 Rust + 13 Vitest), `bunx tsc --noEmit`, `bun run build`, and `bun run tauri:build`. MSI (`Saber_0.1.0_x64_en-US.msi`, 40,452,096 bytes) and NSIS (`Saber_0.1.0_x64-setup.exe`, 27,329,268 bytes) were produced. A first full Vitest run during the initial Linux GUI release compile timed out two Git workspace cases; the later uncontended full run passed.
- Follow-up fix (2026-09-26): Selecting a different task in Board changed the view to List, whose conditional render unmounted the TerminalSurface and closed its PTY. A stable terminal layer now keeps live surfaces mounted behind List/Board, hides them from interaction, and delays an unopened task's shell until Terminal is selected. Windows full tests passed (90/90), terminal checks passed (2 Rust + 13 Vitest), typecheck and production build passed. Ubuntu 26.04 WSL lifecycle test passed (1/1), typecheck and production web build passed, and refreshed `.deb`/AppImage packages were built using the checksum-verified Linux Node sidecar. Refreshed artifacts were placed in the Omarchy shared folder. The packaged Omarchy A-to-B-to-A retest and post-fix close check are still pending; LDR-05 is not complete. The refreshed `.deb` was built but remains extracted rather than installed in WSL because sudo requires interactive authentication. No general Linux compatibility claim is made.
