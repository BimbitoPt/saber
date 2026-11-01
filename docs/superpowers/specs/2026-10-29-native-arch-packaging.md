# Native Arch packaging (AppImage + pacman)

## Status and authorization

Approved next slice, 2026-10-29. User asked to close the remaining `SESSIONS.md` gap: "AppImage/pacman packaging for Arch". Work continues M7 `LDR-04` (bundle build and artifact inspection) onto the native Omarchy host where `.deb`/AppImage bundling previously failed on `linuxdeploy`.

## Problem and user workflow

`bun run tauri:linux:build` bundles `.deb` and AppImage. On this Arch host the earlier session never produced the AppImage because `linuxdeploy`/`appimagetool` (Tauri's AppImage tooling AppImages themselves) cannot run without `fuse2` userspace, which is not installed and needs `sudo`. The AppImage previously worked only by building it in Ubuntu 26.04 WSL, and the Arch host had no pacman package at all — the distribution channel referenced in the M7 gap list.

The workflow is: run the documented Linux build command on Arch, get both artifacts natively, launch the AppImage, and additionally build an installable pacman package from the same `.deb` payload.

## Scope and exclusions

Bounded deliverable: a reproducible AppImage build on native Arch without extra system packages; a `packaging/arch/PKGBUILD` producing an installable `saber` package; a launch receipt for the native app cycle (boot, server port, desktop close, no residue).

Deferred: signing, AUR submission, updater channels, Wayland/X11 runtime toggles, and the `LDR-05` task-terminal A-to-B-to-A manual acceptance (tracked separately in the M7 spec).

## Requirements and acceptance criteria

- APR-01: `bun run tauri:linux:build` produces `Saber_<version>_amd64.AppImage` on native Arch with no non-package-manager states. The build script sets `APPIMAGE_EXTRACT_AND_RUN=1` (so the tooling AppImages run by extraction instead of mounting, removing the `fuse2` runtime dependency from the build path) and `NO_STRIP=true` (so linuxdeploy's bundled binutils, which cannot parse modern `.relr.dyn` sections in current Arch libraries, does not strip deployed libraries). Both settings are recorded in `package.json`, not typed ad hoc per run.
- APR-02: The produced AppImage launches and boots the real app: a window appears, the sidecar server becomes reachable on its own port (fallback port behavior is acceptable), and after closing the desktop window the app and sidecar exit with no Saber process residue and free port.
- APR-03: `makepkg` builds `saber-<version>_<pkgrel>-x86_64.pkg.tar.zst` from the produced `.deb` payload with the Arch dependency list (GTK3 and WebKitGTK 4.1 families), and the package tree matches the `.deb` payload: `usr/bin/` app and node sidecar executables, server resources, desktop entry, and icons in the expected system paths. `packaging/arch/README.md` documents the two-command install path.
- APR-04: The `.deb` continues to be produced by the same command. Windows MSIs/NSIS targets and `scripts/verify-terminal`/`prepare-tauri-runtime` behavior stay untouched.
- APR-05: The Tauri-downloaded `linuxdeploy-plugin-gtk.sh` gets an in-repo, idempotent patch (`scripts/patch-linuxdeploy-gtk.ts`) that skips nonexistent source directories inside AppDir-staging and creates the loaders-cache directory before `gdk-pixbuf-query-loaders` writes it. This is required because gdk-pixbuf 2.44 (current Arch) has no on-disk `2.10.0` loader directory — loaders are built into the shared library — so the stock plugin aborts with `realpath: /usr/lib/gdk-pixbuf-2.0/2.10.0: No such file or directory`. If the upstream script drifts such that the patch context is missing, the patch script fails loudly instead of silently re-applying.

## Data and lifecycle

The AppImage and `.deb` stay in `src-tauri/target/release/bundle/` and are not committed. The PKGBUILD consumes the `.deb` from that directory (copied in with the documented command), uses `SKIP` checksums deliberately because the source is a locally built artifact, and carries `pkgver` synced to `tauri.conf.json`'s version with a pkgrel of 1. No user data is touched by any packaging step. Launch receipts go to spec completion evidence, not CI gates.

## Verification plan

- APR-01: run `bun run tauri:linux:build`, confirm the AppImage path exists, and confirm the command's recorded env: `APPIMAGE_EXTRACT_AND_RUN=1 bun x tauri build --bundles deb,appimage` equivalent.
- APR-05: run `bun run patch:linuxdeploy-gtk` after a prime build pass and confirm it reports "already patched" without changing bytes; run `bun run test` to prove no regression to the checked suite.
- APR-02: launch the AppImage with `--appimage-extract-and-run` fallback allowed the same way the build path runs, note the window (unavailable headless: state that check must be done by the user; still verify the sidecar server's health on the auto-picked port by journaling process/port), close it, and require no residue: no `mstudio-ade` or `saber-server` processes, original port 8082 untouched.
- APR-03: in `packaging/arch/`, run `makepkg -f` and inspect the package contents with `bsdtar`; `pacman -U` install is a user step (`sudo` interactive), recorded in the README.
- APR-04: assert the build emits both bundle folders and no windows-specific bundle folder changes were needed; `bunx tsc --noEmit` still passes after script edits.

## Completion evidence

Verified on native Arch (Omarchy 7.2.8 kernel), 2026-10-29.

- APR-01: `bun run tauri:linux:build` ran end-to-end (web build, sidecar prep, plugin patch, bundling) and produced `src-tauri/target/release/bundle/appimage/Saber_0.1.0_amd64.AppImage` (149,641,720 bytes) and `src-tauri/target/release/bundle/deb/Saber_0.1.0_amd64.deb`. Two environment fixes were needed and are recorded in `package.json`: `APPIMAGE_EXTRACT_AND_RUN=1` (no `fuse2` on this host) and `NO_STRIP=true` (linuxdeploy's bundled `strip` cannot parse `.relr.dyn` sections in current Arch libraries). An env-prefix-in-a-chain bug was caught during receipt re-runs: `VAR=1 cmd1 && cmd2` applies only to `cmd1`, so the script `export`s both variables for the entire chain.
- APR-02: Launched `./Saber_0.1.0_amd64.AppImage --appimage-extract-and-run`. The real app process (`mstudio-ade`) spawned the bundled node sidecar from the extracted image, which served `server/index.mjs`; the packaged health endpoint answered `{"data":{"status":"ok","apiVersion":"1.0.0"}}` on its ephemeral port (32947, parent/child verified by process tree). The desktop window appeared; the user interacted and closed it. After close: no `mstudio-ade` process remains, port 32947 free, launch log clean, `verify:harness` and the full test suite (218 passed, 1 platform-skipped) unaffected. Tooling extraction leftovers under `/tmp/appimage_extracted_*` (one from this launch, one from the earlier failing bundling attempt) were removed.
- APR-03: `makepkg -f` in `packaging/arch/` built `saber-0.1.0-1-x86_64.pkg.tar.zst` from the produced `.deb` payload with `options=(!debug !strip)`; package tree verified with `bsdtar -tvf`: executable `usr/bin/mstudio-ade` and `usr/bin/node`, `usr/lib/Saber/saber-server/.output/` resources, `usr/share/applications/Saber.desktop`, and `usr/share/icons/hicolor/256x256/apps/mstudio-ade.png`. Install needs interactive sudo and is left as the documented user step in `packaging/arch/README.md`.
- APR-04: The chain emits both bundle folders; no Windows bundle target or script changes were required. `bunx tsc --noEmit` clean and `bun run test` 218 passed / 29 files after the script changes.
- APR-05: `bun run patch:linuxdeploy-gtk` patched the cached `linuxdeploy-plugin-gtk.sh` (missing dir skip in `copy_lib_tree`, cache `mkdir -p` before `gdk-pixbuf-query-loaders` output). Idempotency confirmed ("already patched" on rerun), drift guard verified by the textual-context check inside the script.
- interventions: 3 — (1) the env-prefix chain bug, (2) discovering the real failure needed `--verbose` child output (the bundler swallows linuxdeploy stderr), (3) the gdk-pixbuf 2.44 plugin incompatibility patch. `fuse2` remains optional: build and launch both work via extract-and-run, so the Pacman channel is the production-install recommendation and the optional `pacman -S fuse2` line in the README is hygiene for direct AppImage mounts.
