fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "terminal_start",
                "terminal_write",
                "terminal_resize",
                "terminal_close",
                "terminal_list",
            ]),
        ),
    ).expect("failed to build Saber Tauri application");
}
