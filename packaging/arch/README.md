pacman package for Saber on Arch

The package reuses Tauri's `.deb` payload (usr tree: app binary, node sidecar,
server resources, desktop entry, icons). `pkgver`, PKGBUILD `pkgver`, and
src-tauri/tauri.conf.json version must match; bump pkgrel when repackaging the
same version. Checksums are SKIP because the source is a locally built artifact,
not a published release.

Build:

    bun run tauri:linux:build
    cp ../../src-tauri/target/release/bundle/deb/Saber_0.1.0_amd64.deb .
    makepkg -f

Install (interactive sudo, one of the two artifacts):

    sudo pacman -U saber-0.1.0-1-x86_64.pkg.tar.zst
    sudo pacman -S fuse2   # optional: lets the AppImage mount directly instead of extract-and-run

Two build-time pitfalls (APR-01/APR-05 of 2026-10-29-native-arch-packaging.md):

- `tauri:linux:build` exports `NO_STRIP=true` and `APPIMAGE_EXTRACT_AND_RUN=1` for the whole command chain; a bare `VAR=x cmd1 && cmd2` prefix would only apply to cmd1.
- gdk-pixbuf 2.44 (current Arch) has no on-disk `2.10.0` loader directory — loaders are built into the library — so the linuxdeploy GTK plugin needs `bun run patch:linuxdeploy-gtk` once the Tauri cache is primed. Upstream script drift fails loudly by design.

Verify against the pacman conventions:

    bsdtar -tf saber-0.1.0-1-x86_64.pkg.tar.zst | head -20
