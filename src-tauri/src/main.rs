use std::io::{self, BufRead, BufReader};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

mod runtime;
mod terminal;

struct ServerProcess(Mutex<Option<Child>>);

impl ServerProcess {
    fn stop(&self) {
        if let Some(mut child) = self.0.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

enum RuntimeEvent {
    Output(String),
    Ended,
}

fn forward_server_output(stdout: impl BufRead, event_sender: mpsc::Sender<RuntimeEvent>) {
    for line in stdout.lines() {
        match line {
            Ok(line) => {
                // Once startup has its listening address, its receiver is dropped. Keep
                // draining stdout so later server logs cannot close the child's pipe.
                let _ = event_sender.send(RuntimeEvent::Output(line));
            }
            Err(_) => break,
        }
    }
    let _ = event_sender.send(RuntimeEvent::Ended);
}

fn terminate(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn start_server(app: &tauri::App) -> Result<(Child, SocketAddr), String> {
    let mut command = if cfg!(debug_assertions) {
        let workspace = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or_else(|| "Saber development workspace could not be found".to_string())?
            .to_path_buf();
        let mut command = Command::new("bun");
        command
            .args([
                "run",
                "dev",
                "--host",
                "127.0.0.1",
                "--port",
                "8082",
                "--strictPort",
            ])
            .current_dir(workspace)
            .env("HOST", "127.0.0.1")
            .env("PORT", "8082");
        command
    } else {
        let resource_dir = app
            .path()
            .resource_dir()
            .map_err(|_| "Saber’s local server resources are missing".to_string())?;
        let output = resource_dir.join("saber-server").join(".output");
        let executable = std::env::current_exe()
            .map_err(|_| "Saber’s bundled local server files are incomplete".to_string())?;
        let executable_dir = executable
            .parent()
            .ok_or_else(|| "Saber’s bundled local server files are incomplete".to_string())?;
        let node_binary = runtime::bundled_node_path(&resource_dir, executable_dir, cfg!(windows));
        if !node_binary.is_file()
            || !output.join("server").join("index.mjs").is_file()
            || !output.join("public").is_dir()
        {
            return Err("Saber’s bundled local server files are incomplete".to_string());
        }
        let mut command = Command::new(node_binary);
        command
            .arg("server/index.mjs")
            .current_dir(&output)
            .env("HOST", "127.0.0.1")
            .env("PORT", "0");
        command
    };

    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|_| "Saber could not start its local application server".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Saber could not read local server startup status".to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Saber could not read local server startup status".to_string())?;
    thread::spawn(move || {
        let _ = io::copy(&mut stderr, &mut io::sink());
    });

    let (event_sender, event_receiver) = mpsc::channel();
    thread::spawn(move || forward_server_output(BufReader::new(stdout), event_sender));

    let startup_deadline = Instant::now() + Duration::from_secs(120);
    let address = loop {
        if Instant::now() >= startup_deadline {
            terminate(&mut child);
            return Err(
                "Saber’s local server did not announce a listening address in time".to_string(),
            );
        }
        match child.try_wait() {
            Ok(Some(_)) => {
                return Err("Saber’s local server stopped before it was ready. Check that development port 8082 is free, then try again.".to_string());
            }
            Err(_) => {
                terminate(&mut child);
                return Err("Saber could not check whether its local server is running".to_string());
            }
            Ok(None) => {}
        }
        match event_receiver.recv_timeout(Duration::from_millis(200)) {
            Ok(RuntimeEvent::Output(output)) => {
                if let Some(address) = runtime::parse_listening_url(&output) {
                    break address;
                }
            }
            Ok(RuntimeEvent::Ended) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                terminate(&mut child);
                return Err("Saber’s local server stopped before it was ready. Check that development port 8082 is free, then try again.".to_string());
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
    };

    let health_deadline = Instant::now() + Duration::from_secs(20);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                return Err(
                    "Saber’s local server stopped before passing its health check".to_string(),
                );
            }
            Err(_) => {
                terminate(&mut child);
                return Err("Saber could not check whether its local server is running".to_string());
            }
            Ok(None) => {}
        }
        match runtime::health_check(address, Duration::from_millis(500)) {
            Ok(()) => return Ok((child, address)),
            Err(_) if Instant::now() < health_deadline => thread::sleep(Duration::from_millis(200)),
            Err(_) => {
                terminate(&mut child);
                return Err(
                    "Saber’s local server failed its health check. Restart Saber and try again."
                        .to_string(),
                );
            }
        }
    }
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(terminal::TerminalSessions::default())
        .invoke_handler(tauri::generate_handler![
            terminal::terminal_start,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_close,
            terminal::terminal_list
        ])
        .setup(|app| {
            let (mut child, address) = match start_server(app) {
                Ok(result) => result,
                Err(message) => {
                    app.dialog()
                        .message(message)
                        .title("Saber could not start")
                        .blocking_show();
                    return Err(io::Error::other("Saber application server startup failed").into());
                }
            };
            let url = format!("http://127.0.0.1:{}/", address.port());
            if let Err(error) = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(url.parse().unwrap()),
            )
            .title("Saber — by Mstudio")
            .inner_size(1380.0, 880.0)
            .min_inner_size(1000.0, 640.0)
            .decorations(false)
            .center()
            .build()
            {
                terminate(&mut child);
                app.dialog()
                    .message("Saber’s local server is ready, but its window could not be created. Restart Saber and try again.")
                    .title("Saber could not open")
                    .blocking_show();
                return Err(error.into());
            }
            app.manage(ServerProcess(Mutex::new(Some(child))));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Saber application");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            handle.state::<terminal::TerminalSessions>().close_all();
            handle.state::<ServerProcess>().stop();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{forward_server_output, RuntimeEvent};
    use std::io::{BufReader, Cursor};
    use std::sync::mpsc;

    #[test]
    fn server_stdout_is_drained_after_the_startup_receiver_is_dropped() {
        let output = b"listening\nsubsequent server log\n";
        let mut cursor = Cursor::new(output.as_slice());
        let (sender, receiver) = mpsc::channel();
        drop(receiver);

        forward_server_output(BufReader::new(&mut cursor), sender);

        assert_eq!(cursor.position(), output.len() as u64);
    }

    #[test]
    fn server_stdout_forwards_the_readiness_line() {
        let (sender, receiver) = mpsc::channel();
        forward_server_output(BufReader::new(Cursor::new(b"listening\n")), sender);

        assert!(matches!(receiver.recv(), Ok(RuntimeEvent::Output(line)) if line == "listening"));
        assert!(matches!(receiver.recv(), Ok(RuntimeEvent::Ended)));
    }
}
