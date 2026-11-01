import { readFileSync, writeFileSync, chmodSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const pluginPath = join(homedir(), ".cache", "tauri", "linuxdeploy-plugin-gtk.sh");
const missingSourceGuardBefore = `    for elem in "\${src[@]}"; do
        mkdir -p "\${dst::-1}\${elem/$LD_GTK_LIBRARY_PATH//usr/lib}"
        pushd "$LD_GTK_LIBRARY_PATH"
        cp "$(realpath --relative-to="$LD_GTK_LIBRARY_PATH" "$elem")" --archive --parents --target-directory="$dst/usr/lib" $verbose
        popd
    done`;
const missingSourceGuardAfter = `    for elem in "\${src[@]}"; do
        if [ ! -d "$elem" ]; then
            echo "SKIPPED (missing): $elem"
            continue
        fi
        mkdir -p "\${dst::-1}\${elem/$LD_GTK_LIBRARY_PATH//usr/lib}"
        pushd "$LD_GTK_LIBRARY_PATH"
        cp "$(realpath --relative-to="$LD_GTK_LIBRARY_PATH" "$elem")" --archive --parents --target-directory="$dst/usr/lib" $verbose
        popd
    done`;
const pixbufCacheMkdirBefore = `if [ -x "$gdk_pixbuf_query" ]; then
    echo "Updating pixbuf cache in $APPDIR/\${gdk_pixbuf_cache_file/$LD_GTK_LIBRARY_PATH//usr/lib}"
    "$gdk_pixbuf_query" > "$APPDIR/\${gdk_pixbuf_cache_file/$LD_GTK_LIBRARY_PATH//usr/lib}"
else`;
const pixbufCacheMkdirAfter = `if [ -x "$gdk_pixbuf_query" ]; then
    echo "Updating pixbuf cache in $APPDIR/\${gdk_pixbuf_cache_file/$LD_GTK_LIBRARY_PATH//usr/lib}"
    mkdir -p "$(dirname "$APPDIR/\${gdk_pixbuf_cache_file/$LD_GTK_LIBRARY_PATH//usr/lib}")"
    "$gdk_pixbuf_query" > "$APPDIR/\${gdk_pixbuf_cache_file/$LD_GTK_LIBRARY_PATH//usr/lib}"
else`;

let source: string;
try {
  source = readFileSync(pluginPath, "utf8");
} catch (error) {
  throw new Error(`linuxdeploy-plugin-gtk.sh is not cached at ${pluginPath}; run bun x tauri build --bundles appimage once to prime the Tauri cache`);
}
if (source.includes("SKIPPED (missing)")) {
  console.log("linuxdeploy-plugin-gtk.sh: already patched");
} else {
  const patched = source
    .replace(missingSourceGuardBefore, missingSourceGuardAfter)
    .replace(pixbufCacheMkdirBefore, pixbufCacheMkdirAfter);
  if (patched === source || !patched.includes("SKIPPED (missing)") || patched.split("mkdir -p \"$(dirname \"$APPDIR/").length !== 2) {
    throw new Error("linuxdeploy-plugin-gtk.sh drifted from the expected upstream layout; review docs/superpowers/specs/2026-10-29-native-arch-packaging.md APR-05 before patching");
  }
  const mode = statSync(pluginPath).mode & 0o777;
  writeFileSync(pluginPath, patched, { mode });
  chmodSync(pluginPath, mode | 0o755);
  console.log("linuxdeploy-plugin-gtk.sh: patched for gdk-pixbuf 2.44 (missing dirs skipped, cache dir created)");
}
