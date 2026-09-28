# Linux Desktop Runtime and Packaging Implementation Plan

> Execute only against `docs/superpowers/specs/2026-09-24-linux-desktop-runtime.md`. A successful build is not completion; each requirement needs its recorded receipt.

**Goal:** Build and verify Saber as a Linux x64 Tauri desktop application in Ubuntu 26.04 WSL while preserving Windows behavior.

**Architecture:** Prepare a checksum-verified Node 24.21.0 Linux external binary and the existing Nitro server resources; resolve both from Tauri's Linux resource paths; merge a Linux-specific bundle config for `.deb` and AppImage; keep development on the user's Linux Bun installation and strict port 8082.

**Tech stack:** Bun, TanStack Start/Nitro, Tauri v2, Rust, Ubuntu 26.04 WSL, WebKitGTK 4.1, Debian/AppImage bundlers.

## Task 0: Keep build inputs and generated outputs reviewable

**Files:** `src-tauri/binaries/node-x86_64-unknown-linux-gnu`, `src-tauri/icons/icon.png`, WSL build cache.

- [x] Keep the Linux sidecar as an ignored, reproducibly prepared build input and the PNG as the Linux application icon source asset.
- [x] Keep reusable Cargo compilation cache outside the repository; do not stage generated output under `src-tauri/gen/**`.
- [x] Confirm there are no unignored target-specific test binaries; generated Tauri schema outputs are identified and excluded from this slice.

## Task 1: Stabilize the Linux Rust test suite

**Files:** `src-tauri/src/runtime.rs` tests.

- [x] Reproduce the loopback health fixture timeout with default test parallelism.
- [x] Adjust fixture synchronization/time budgets without weakening production health-check limits or removing timeout coverage.
- [x] Run default `cargo test` three consecutive times in Ubuntu 26.04 and Windows; after the final test changes, five Ubuntu runs and three Windows runs passed (8/8 each).
- [x] Keep the Linux PTY marker and requested-working-directory assertion.

## Task 2: Add target-aware runtime preparation

**Files:** `scripts/prepare-tauri-runtime.ts`, `package.json`, `.gitignore`.

- [x] Factor runtime preparation so the host target selects the correct official Node archive, target triple, archive format, executable name, and extraction method.
- [x] Keep the pinned v24.21.0 version and validate archive SHA-256 against the official release manifest before extraction.
- [x] Stage Linux Node as `src-tauri/binaries/node-x86_64-unknown-linux-gnu`; retain the existing Windows target name and byte-verification behavior.
- [x] Copy the complete `.output` server tree and Node license to the existing deterministic Tauri resource path.
- [x] Add focused tests for archive selection, target naming, checksum mismatch rejection, and preserved Windows preparation (7 tests passed).

## Task 3: Make the Rust host resolve runtime by platform

**Files:** `src-tauri/src/main.rs`, `src-tauri/src/runtime.rs`, focused tests.

- [x] Keep dev/release startup choice explicit and inject platform paths through small tested helpers.
- [x] In Linux release mode, resolve the bundled Node sidecar using the Linux resource layout confirmed from a built package; start it with only the server entry and loopback/ephemeral-port environment.
- [x] Preserve health readiness, safe errors, exact-child shutdown, and PTY cleanup. The apparent child exit was `SIGHUP` from the shell-based WSL test launcher; detached WSLg launch keeps the packaged Node server alive. The stdout reader now continues draining after startup receiver disposal.
- [x] In Linux debug mode, invoke `bun` from the workspace with strict port 8082 and fail rather than reuse a listener.
- [x] Add tests for resource-path construction and ensure production command selection cannot fall back to global Node or Bun.

## Task 4: Add Linux icon and bundle configuration

**Files:** `src-tauri/tauri.linux.conf.json`, `src-tauri/icons/**`, `package.json`.

- [x] Add the PNG application icon source asset derived from the existing app icon.
- [x] Add the Linux Tauri config merge with Debian and AppImage targets and supported Linux package metadata.
- [x] Add explicit Linux build script `bun run tauri:linux:build`; Tauri merges `tauri.linux.conf.json` and selects Debian/AppImage.
- [x] Verify Windows MSI/NSIS targets and scripts by producing both installers.

## Task 5: Build and inspect Linux artifacts

**Files:** no generated bundle files are committed.

- [x] Build both `.deb` and `.AppImage` under Ubuntu 26.04 WSL.
- [x] Inspect package contents and executable modes for the Linux Node sidecar, server entry, public assets, and icon/desktop metadata.
- [ ] Install the `.deb` in Ubuntu 26.04 WSL and launch Saber through WSLg; launch the AppImage from its output location. The extracted `.deb` and AppImage started. The `.deb` could not be installed because `sudo -n` requires interactive authentication.
- [ ] Record exact host metadata and any limitations. Do not claim older-distro compatibility.

## Task 6: Run Linux app and terminal acceptance

**Files:** update the feature spec completion evidence and terminal roadmap.

- [x] Keep a dummy listener on 8082 while launching packaged Saber; it selected a separate IPv4 loopback port and left the dummy listener untouched.
- [x] Verify packaged desktop health remains available and health returns only status/API version while unauthenticated task reads return 401. A detached packaged launch stayed healthy for over 100 seconds; a separate listener on 8082 was left untouched.
- [ ] In the packaged task terminal, run a unique harmless marker; verify the task's effective directory and marker output. Automated Linux PTY marker/cwd tests pass; the packaged UI interaction remains pending because native app controls are unavailable.
- [ ] Switch A-to-B-to-A and verify the task-owned terminal resumes without starting a duplicate shell or unlocking another task.
- [ ] Close the app through its UI; verify only Saber-owned shell/server processes stop and the port is released. Native UI close and graceful cleanup remain unverified.

## Task 7: Run cross-platform regression and close the slice

**Files:** `docs/superpowers/specs/2026-09-24-linux-desktop-runtime.md`, `docs/roadmaps/2026-09-22-terminal-first-saber.md`.

- [x] Run Linux `cargo test` three times with default parallelism, Linux web tests/build, and Linux bundle checks.
- [ ] Rerun Windows `bun run test`, `bun run test:terminal`, `bunx tsc --noEmit`, `bun run build`, and `bun run tauri:build` after the final Rust stdout-reader change. These all passed before that change; the Rust suite has since passed three times.
- [x] Confirm the Windows Node staging, MSI/NSIS targets, and native terminal checks still pass.
- [x] Map each LDR requirement to command output or manual observation; retain unverified acceptance as pending in the spec.
- [x] Update the roadmap and AGENTS current-slice pointer to reflect M7 implementation evidence while keeping the slice incomplete.

## Self-review and stop conditions

- Do not make the Linux sidecar a provider executable or add a shell-spawn API.
- Do not commit `src-tauri/gen/**`, `.output`, `dist`, target directories, package artifacts, or temporary binaries.
- If Tauri's actual Debian/AppImage resource location differs from assumptions, inspect the package and adapt the Rust helper; do not rely on build-directory paths.
- If AppImage dependencies or WSLg prevent an honest launch receipt, retain the successful Linux Cargo/API evidence and report the native limitation instead of claiming Linux support.
- A single Ubuntu 26.04 WSL run proves only that environment; broad Linux support needs a later oldest-supported-distribution build matrix.
