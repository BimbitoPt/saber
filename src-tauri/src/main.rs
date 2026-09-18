use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::RunEvent;

static DEV_CHILD: Mutex<Option<Child>> = Mutex::new(None);
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn port_up(port: u16) -> bool {
    TcpStream::connect(("127.0.0.1", port)).is_ok()
}

fn user_profile() -> PathBuf {
    PathBuf::from(std::env::var("USERPROFILE").expect("USERPROFILE not set"))
}

fn app_dir() -> PathBuf {
    user_profile().join("Desktop").join("mstudio-ade")
}

fn bun_exe() -> PathBuf {
    let candidate = user_profile()
        .join("AppData")
        .join("Roaming")
        .join("npm")
        .join("node_modules")
        .join("bun")
        .join("bin")
        .join("bun.exe");
    if candidate.exists() {
        candidate
    } else {
        PathBuf::from("bun")
    }
}

fn spawn_dev_server() {
    eprintln!("[ade] starting bun dev sidecar");
    match Command::new(bun_exe())
        .args(["run", "dev"])
        .current_dir(app_dir())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => *DEV_CHILD.lock().unwrap() = Some(child),
        Err(e) => eprintln!("[ade] failed to spawn dev server: {e}"),
    }
}

fn wait_until_up() -> bool {
    let deadline = Instant::now() + Duration::from_secs(120);
    while Instant::now() < deadline {
        if port_up(8082) {
            eprintln!("[ade] dev server is up");
            return true;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    eprintln!("[ade] dev server did not come up within 120s");
    false
}

fn kill_dev_server() {
    if let Some(child) = DEV_CHILD.lock().unwrap().take() {
        let _ = Command::new("taskkill")
            .args(["/pid", &child.id().to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

fn main() {
    let spawned_locally = !port_up(8082);
    if spawned_locally {
        spawn_dev_server();
        wait_until_up();
    }

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_handle, event| {
        if let RunEvent::Exit = event {
            if spawned_locally {
                kill_dev_server();
            }
        }
    });
}
