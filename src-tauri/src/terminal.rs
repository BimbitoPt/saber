use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::env;
use std::io::{Read, Write};
#[cfg(unix)]
use std::path::Path;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send>,
}

#[derive(Default)]
pub struct TerminalSessions {
    sessions: Mutex<HashMap<String, Session>>,
}

impl TerminalSessions {
    fn start(
        &self,
        app: AppHandle,
        session_id: String,
        cwd: PathBuf,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
        let cwd = validate_start(&session_id, cwd, cols, rows)?;

        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "Terminal state is unavailable".to_string())?;
        if sessions.contains_key(&session_id) {
            return Err("A terminal session already exists for this task".to_string());
        }

        let shell = default_shell()?;
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| format!("Cannot create terminal: {error}"))?;
        let mut command = CommandBuilder::new(shell.as_os_str());
        command.cwd(&cwd);
        command.env("TERM", "xterm-256color");
        #[cfg(windows)]
        command.arg("-NoLogo");
        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| format!("Cannot start {}: {error}", shell.display()))?;
        drop(pair.slave);
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| format!("Cannot read terminal output: {error}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| format!("Cannot write to terminal: {error}"))?;
        let master = pair.master;
        let output_event = format!("terminal-output:{session_id}");
        let ended_event = format!("terminal-exited:{session_id}");
        sessions.insert(
            session_id,
            Session {
                master,
                writer,
                child,
            },
        );

        std::thread::spawn(move || {
            let mut reader = reader;
            let mut buffer = [0_u8; 8192];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(size) => {
                        let text = String::from_utf8_lossy(&buffer[..size]).to_string();
                        let _ = app.emit(&output_event, text);
                    }
                }
            }
            let _ = app.emit(&ended_event, ());
        });
        Ok(())
    }

    fn write(&self, session_id: &str, data: String) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "Terminal state is unavailable".to_string())?;
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| "Terminal session is not running".to_string())?;
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|error| format!("Cannot write to terminal: {error}"))?;
        session
            .writer
            .flush()
            .map_err(|error| format!("Cannot flush terminal input: {error}"))
    }

    fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        if cols == 0 || rows == 0 {
            return Ok(());
        }
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| "Terminal state is unavailable".to_string())?;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| "Terminal session is not running".to_string())?;
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| format!("Cannot resize terminal: {error}"))
    }

    fn list(&self) -> Result<Vec<String>, String> {
        self.sessions
            .lock()
            .map(|sessions| sessions.keys().cloned().collect())
            .map_err(|_| "Terminal state is unavailable".to_string())
    }

    fn close(&self, session_id: &str) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "Terminal state is unavailable".to_string())?;
        let Some(session) = sessions.get_mut(session_id) else {
            return Ok(());
        };
        if session
            .child
            .try_wait()
            .map_err(|error| format!("Cannot check terminal process: {error}"))?
            .is_none()
        {
            session
                .child
                .kill()
                .map_err(|error| format!("Cannot stop terminal process: {error}"))?;
        }
        session
            .child
            .wait()
            .map_err(|error| format!("Cannot reap terminal process: {error}"))?;
        sessions.remove(session_id);
        Ok(())
    }

    pub fn close_all(&self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            for session in sessions.values_mut() {
                if session.child.try_wait().ok().flatten().is_none() {
                    let _ = session.child.kill();
                }
                let _ = session.child.wait();
            }
            sessions.clear();
        }
    }
}

#[tauri::command]
pub fn terminal_start(
    app: AppHandle,
    state: State<'_, TerminalSessions>,
    session_id: String,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.start(app, session_id, PathBuf::from(cwd), cols, rows)
}

#[tauri::command]
pub fn terminal_write(
    state: State<'_, TerminalSessions>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    state.write(&session_id, data)
}

#[tauri::command]
pub fn terminal_resize(
    state: State<'_, TerminalSessions>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.resize(&session_id, cols, rows)
}

#[tauri::command]
pub fn terminal_close(
    state: State<'_, TerminalSessions>,
    session_id: String,
) -> Result<(), String> {
    state.close(&session_id)
}

#[tauri::command]
pub fn terminal_list(state: State<'_, TerminalSessions>) -> Result<Vec<String>, String> {
    state.list()
}

fn validate_start(session_id: &str, cwd: PathBuf, cols: u16, rows: u16) -> Result<PathBuf, String> {
    if session_id.trim().is_empty() {
        return Err("A terminal session ID is required".to_string());
    }
    if cols == 0 || rows == 0 {
        return Err("Terminal dimensions must be greater than zero".to_string());
    }
    let cwd = cwd
        .canonicalize()
        .map_err(|error| format!("Cannot open terminal directory: {error}"))?;
    if !cwd.is_dir() {
        return Err("Terminal working directory is not a directory".to_string());
    }
    Ok(cwd)
}

#[cfg(windows)]
fn default_shell() -> Result<PathBuf, String> {
    find_in_path(["pwsh.exe", "powershell.exe"])
        .ok_or_else(|| "PowerShell is unavailable. Install PowerShell 7 or Windows PowerShell, then restart Saber.".to_string())
}

#[cfg(unix)]
fn default_shell() -> Result<PathBuf, String> {
    if let Some(shell) = env::var_os("SHELL")
        .map(PathBuf::from)
        .filter(|path| is_executable_file(path))
    {
        return Ok(shell);
    }
    let fallback = PathBuf::from("/bin/sh");
    if is_executable_file(&fallback) {
        Ok(fallback)
    } else {
        Err(
            "No usable shell was found. Set SHELL to an installed shell and restart Saber."
                .to_string(),
        )
    }
}

#[cfg(windows)]
fn find_in_path<const N: usize>(names: [&str; N]) -> Option<PathBuf> {
    env::split_paths(&env::var_os("PATH")?)
        .flat_map(|directory| names.iter().map(move |name| directory.join(name)))
        .find(|path| path.is_file())
}

#[cfg(unix)]
fn is_executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.is_file()
        && path
            .metadata()
            .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::path::Path;
    use std::time::{Duration, Instant};

    fn shell_command(cwd: &Path) -> (PathBuf, Vec<String>) {
        #[cfg(windows)]
        {
            let shell = default_shell().expect("PowerShell is installed on the test host");
            let _ = cwd;
            (shell, vec!["-NoProfile".to_string(), "-NonInteractive".to_string(), "-Command".to_string(), "Write-Output SABER_TERM_OK; Write-Output ('SABER_CWD=' + (Get-Location).Path); exit 0".to_string()])
        }
        #[cfg(unix)]
        {
            let _ = cwd;
            (
                PathBuf::from("/bin/sh"),
                vec![
                    "-c".to_string(),
                    "printf 'SABER_TERM_OK\\n'; pwd".to_string(),
                ],
            )
        }
    }

    #[test]
    fn terminal_session_round_trips_output_and_uses_the_requested_directory() {
        let directory = env::temp_dir().join(format!("saber-pty-{}", std::process::id()));
        std::fs::create_dir_all(&directory).expect("create temporary directory");
        let directory = directory
            .canonicalize()
            .expect("canonicalize temporary directory");
        let (shell, args) = shell_command(&directory);
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("open pty");
        pair.master
            .resize(PtySize {
                rows: 30,
                cols: 100,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("resize pty");
        let mut command = CommandBuilder::new(shell.as_os_str());
        command.cwd(&directory);
        for arg in args {
            command.arg(arg);
        }
        let mut child = pair.slave.spawn_command(command).expect("start test shell");
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().expect("clone pty reader");
        let mut writer = pair.master.take_writer().expect("take pty writer");
        let mut output = Vec::new();
        let mut chunk = [0_u8; 1024];
        let deadline = Instant::now() + Duration::from_secs(5);
        let (sender, receiver) = std::sync::mpsc::channel::<Vec<u8>>();
        let reader_thread = std::thread::spawn(move || loop {
            match reader.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(size) => {
                    if sender.send(chunk[..size].to_vec()).is_err() {
                        break;
                    }
                }
            }
        });
        let expected_directory = directory.to_string_lossy().to_string();
        let mut received_expected_output = false;
        while Instant::now() < deadline && !received_expected_output {
            if let Ok(bytes) = receiver.recv_timeout(Duration::from_millis(100)) {
                if bytes.windows(4).any(|sequence| sequence == b"\x1b[6n") {
                    writer
                        .write_all(b"\x1b[1;1R")
                        .expect("answer cursor position request");
                }
                output.extend_from_slice(&bytes);
                let text = String::from_utf8_lossy(&output);
                received_expected_output =
                    text.contains("SABER_TERM_OK") && text.contains(&expected_directory);
            }
        }
        let output = String::from_utf8_lossy(&output);
        let exit_deadline = Instant::now() + Duration::from_secs(2);
        let mut exit_status = child.try_wait().expect("check test shell");
        while exit_status.is_none() && Instant::now() < exit_deadline {
            std::thread::sleep(Duration::from_millis(25));
            exit_status = child.try_wait().expect("check test shell");
        }
        if exit_status.is_none() {
            let _ = child.kill();
        }
        let status = exit_status.unwrap_or_else(|| child.wait().expect("wait for test shell"));
        assert!(
            output.contains("SABER_TERM_OK"),
            "unexpected terminal output: {output}"
        );
        assert!(
            output.contains(&expected_directory),
            "shell did not start in requested directory: {output}"
        );
        assert!(
            status.success(),
            "shell exited unsuccessfully with output: {output}"
        );
        drop(writer);
        drop(pair.master);
        reader_thread.join().expect("join PTY reader");
        drop(child);
        std::fs::remove_dir_all(directory).expect("remove temporary directory");
    }

    #[test]
    fn terminal_session_rejects_zero_dimensions_and_missing_working_directories() {
        assert!(
            validate_start("bad-size", env::current_dir().unwrap(), 0, 24)
                .unwrap_err()
                .contains("dimensions")
        );
        assert!(validate_start(
            "missing-dir",
            PathBuf::from("missing-saber-terminal-directory"),
            80,
            24
        )
        .unwrap_err()
        .contains("terminal directory"));
    }
}
