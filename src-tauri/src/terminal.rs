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

/// Liveness of the process behind a session, as reported by the OS.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Liveness {
    Alive,
    Exited,
    /// The child could not be polled. A transient error is not evidence of
    /// death, so only an exited process may ever be dropped.
    Unknown,
}

fn liveness(child: &mut (dyn Child + Send)) -> Liveness {
    match child.try_wait() {
        Ok(Some(_)) => Liveness::Exited,
        Ok(None) => Liveness::Alive,
        Err(_) => Liveness::Unknown,
    }
}

/// The handle the session map needs to report liveness and terminate a pty.
/// Testing implements this for a fake child so the reaping and close rules are
/// covered without a real pty (whose `MasterPty` half has no fake).
trait ManagedProcess {
    fn process(&mut self) -> &mut (dyn Child + Send);
}

impl ManagedProcess for Session {
    fn process(&mut self) -> &mut (dyn Child + Send) {
        &mut *self.child
    }
}

/// What closing a session must do with its map entry.
enum CloseOutcome {
    /// The process is gone; the entry must be dropped. An error describes a
    /// failed reap that the caller should still surface.
    Gone(Option<String>),
    /// The process may still be running; the entry stays so it can be closed again.
    StillAlive(String),
}

fn close_session(child: &mut (dyn Child + Send)) -> CloseOutcome {
    match liveness(child) {
        Liveness::Exited => CloseOutcome::Gone(None),
        Liveness::Alive | Liveness::Unknown => match child.kill() {
            // A successful kill is proof enough that the process is gone, so a
            // failing reap reports the error but must not keep the entry.
            Ok(()) => match child.wait() {
                Ok(_) => CloseOutcome::Gone(None),
                Err(error) => {
                    CloseOutcome::Gone(Some(format!("Cannot reap terminal process: {error}")))
                }
            },
            Err(error) => {
                let message = format!("Cannot stop terminal process: {error}");
                // Only a process that is confirmed alive keeps its entry: an
                // exited one must not survive a failed kill. An unreadable state
                // also keeps the entry, because Saber cannot prove the shell is
                // gone and a dropped entry would orphan it.
                if liveness(child) == Liveness::Exited {
                    CloseOutcome::Gone(None)
                } else {
                    CloseOutcome::StillAlive(message)
                }
            }
        },
    }
}

fn reap_exited<S: ManagedProcess>(sessions: &mut HashMap<String, S>) {
    sessions.retain(|_, session| liveness(session.process()) != Liveness::Exited);
}

fn close_entry<S: ManagedProcess>(
    sessions: &mut HashMap<String, S>,
    session_id: &str,
) -> Result<(), String> {
    let Some(session) = sessions.get_mut(session_id) else {
        return Ok(());
    };
    match close_session(session.process()) {
        CloseOutcome::Gone(error) => {
            sessions.remove(session_id);
            match error {
                Some(message) => Err(message),
                None => Ok(()),
            }
        }
        CloseOutcome::StillAlive(message) => Err(message),
    }
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
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "Terminal state is unavailable".to_string())?;
        // Liveness is the authority: an exited shell must not be reported as a
        // running terminal, or the record is reconciled back to `running` and
        // locks the workspace behind a dead pty.
        reap_exited(&mut sessions);
        Ok(sessions.keys().cloned().collect())
    }

    fn close(&self, session_id: &str) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "Terminal state is unavailable".to_string())?;
        close_entry(&mut sessions, session_id)
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
    Ok(strip_verbatim_prefix(cwd))
}

fn strip_verbatim_prefix(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let text = path.to_string_lossy();
        if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{rest}"));
        }
        if let Some(rest) = text.strip_prefix(r"\\?\") {
            return PathBuf::from(rest);
        }
        path
    }
    #[cfg(not(windows))]
    {
        path
    }
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
    use portable_pty::{ChildKiller, ExitStatus};
    use std::io::Read;
    use std::path::Path;
    use std::sync::Arc;
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
    fn terminal_start_strips_the_windows_verbatim_prefix() {
        assert_eq!(
            super::strip_verbatim_prefix(PathBuf::from(r"\\?\C:\work\repo")),
            PathBuf::from(if cfg!(windows) { r"C:\work\repo" } else { r"\\?\C:\work\repo" }),
        );
        assert_eq!(
            super::strip_verbatim_prefix(PathBuf::from(r"\\?\UNC\host\share")),
            PathBuf::from(if cfg!(windows) { r"\\host\share" } else { r"\\?\UNC\host\share" }),
        );
        assert_eq!(
            super::strip_verbatim_prefix(PathBuf::from(if cfg!(windows) { r"C:\work\repo" } else { "/tmp/repo" })),
            PathBuf::from(if cfg!(windows) { r"C:\work\repo" } else { "/tmp/repo" }),
        );
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

    /// A child whose poll, kill and reap results the tests control.
    #[derive(Debug)]
    struct FakeChild {
        state: Arc<Mutex<FakeChildState>>,
    }

    #[derive(Debug, Default)]
    struct FakeChildState {
        exited: bool,
        try_wait_errors: bool,
        kill_errors: bool,
        wait_errors: bool,
        /// The process dies between two polls, so a failed kill can be followed
        /// by a report that the process is gone.
        exit_on_next_poll: bool,
    }

    impl FakeChild {
        fn new(state: FakeChildState) -> Self {
            Self {
                state: Arc::new(Mutex::new(state)),
            }
        }

        fn alive() -> Self {
            Self::new(FakeChildState::default())
        }

        fn gone() -> Self {
            Self::new(FakeChildState {
                exited: true,
                ..FakeChildState::default()
            })
        }

        fn lock(&self) -> std::sync::MutexGuard<'_, FakeChildState> {
            self.state.lock().expect("fake child state is available")
        }
    }

    fn fake_error(message: &str) -> std::io::Error {
        std::io::Error::other(message.to_string())
    }

    impl Child for FakeChild {
        fn try_wait(&mut self) -> std::io::Result<Option<ExitStatus>> {
            let mut state = self.lock();
            if state.exit_on_next_poll {
                state.exit_on_next_poll = false;
                state.exited = true;
            }
            if state.try_wait_errors {
                return Err(fake_error("poll failed"));
            }
            Ok(state.exited.then(|| ExitStatus::with_exit_code(0)))
        }

        fn wait(&mut self) -> std::io::Result<ExitStatus> {
            let mut state = self.lock();
            if state.wait_errors {
                return Err(fake_error("reap failed"));
            }
            state.exited = true;
            Ok(ExitStatus::with_exit_code(0))
        }

        fn process_id(&self) -> Option<u32> {
            None
        }

        #[cfg(windows)]
        fn as_raw_handle(&self) -> Option<std::os::windows::io::RawHandle> {
            None
        }
    }

    impl ChildKiller for FakeChild {
        fn kill(&mut self) -> std::io::Result<()> {
            let mut state = self.lock();
            if state.kill_errors {
                return Err(fake_error("kill failed"));
            }
            state.exited = true;
            Ok(())
        }

        fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
            Box::new(FakeKiller {
                state: Arc::clone(&self.state),
            })
        }
    }

    #[derive(Debug)]
    struct FakeKiller {
        state: Arc<Mutex<FakeChildState>>,
    }

    impl ChildKiller for FakeKiller {
        fn kill(&mut self) -> std::io::Result<()> {
            self.state
                .lock()
                .expect("fake child state is available")
                .exited = true;
            Ok(())
        }

        fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
            Box::new(FakeKiller {
                state: Arc::clone(&self.state),
            })
        }
    }

    #[derive(Debug)]
    struct FakeSession {
        child: FakeChild,
    }

    impl ManagedProcess for FakeSession {
        fn process(&mut self) -> &mut (dyn Child + Send) {
            &mut self.child
        }
    }

    const SESSION: &str = "terminal-session-under-test";

    fn sessions_with(child: FakeChild) -> HashMap<String, FakeSession> {
        HashMap::from([(SESSION.to_string(), FakeSession { child })])
    }

    fn session_ids(sessions: &HashMap<String, FakeSession>) -> Vec<String> {
        let mut ids: Vec<String> = sessions.keys().cloned().collect();
        ids.sort();
        ids
    }

    #[test]
    fn terminal_session_list_reaps_an_exited_process() {
        let mut sessions = sessions_with(FakeChild::gone());
        reap_exited(&mut sessions);
        assert!(sessions.is_empty(), "an exited shell must not be listed");
    }

    #[test]
    fn terminal_session_list_keeps_a_live_or_unreadable_process() {
        let mut sessions = sessions_with(FakeChild::alive());
        sessions.insert(
            "terminal-session-unreadable".to_string(),
            FakeSession {
                child: FakeChild::new(FakeChildState {
                    try_wait_errors: true,
                    ..FakeChildState::default()
                }),
            },
        );
        reap_exited(&mut sessions);
        assert_eq!(
            session_ids(&sessions),
            vec![SESSION.to_string(), "terminal-session-unreadable".to_string()]
        );
    }

    #[test]
    fn terminal_session_close_drops_an_already_exited_process() {
        let mut sessions = sessions_with(FakeChild::gone());
        assert!(close_entry(&mut sessions, SESSION).is_ok());
        assert!(sessions.is_empty());
        assert!(
            close_entry(&mut sessions, SESSION).is_ok(),
            "closing a session that is not in the map is a no-op"
        );
    }

    #[test]
    fn terminal_session_close_terminates_a_running_process_and_drops_it() {
        let mut sessions = sessions_with(FakeChild::alive());
        assert!(close_entry(&mut sessions, SESSION).is_ok());
        assert!(sessions.is_empty());
    }

    #[test]
    fn terminal_session_close_drops_the_entry_when_reaping_fails_after_a_kill() {
        let mut sessions = sessions_with(FakeChild::new(FakeChildState {
            wait_errors: true,
            ..FakeChildState::default()
        }));
        let error = close_entry(&mut sessions, SESSION).unwrap_err();
        assert!(error.contains("reap"), "unexpected error: {error}");
        assert!(
            sessions.is_empty(),
            "a process that was killed must not survive a failed reap"
        );
    }

    #[test]
    fn terminal_session_close_drops_the_entry_when_a_failed_kill_finds_the_process_gone() {
        let mut sessions = sessions_with(FakeChild::new(FakeChildState {
            kill_errors: true,
            exit_on_next_poll: true,
            ..FakeChildState::default()
        }));
        assert!(close_entry(&mut sessions, SESSION).is_ok());
        assert!(
            sessions.is_empty(),
            "a process that exited on its own must not survive a failed kill"
        );
    }

    #[test]
    fn terminal_session_close_keeps_a_process_that_is_still_alive() {
        let mut sessions = sessions_with(FakeChild::new(FakeChildState {
            kill_errors: true,
            ..FakeChildState::default()
        }));
        let error = close_entry(&mut sessions, SESSION).unwrap_err();
        assert!(error.contains("stop"), "unexpected error: {error}");
        assert_eq!(sessions.len(), 1, "a confirmed live process keeps its entry");
    }

    #[test]
    fn terminal_session_close_keeps_a_process_whose_liveness_cannot_be_read() {
        let mut sessions = sessions_with(FakeChild::new(FakeChildState {
            try_wait_errors: true,
            kill_errors: true,
            ..FakeChildState::default()
        }));
        let error = close_entry(&mut sessions, SESSION).unwrap_err();
        assert!(error.contains("stop"), "unexpected error: {error}");
        assert_eq!(
            sessions.len(),
            1,
            "an unreadable liveness state must not drop the entry"
        );
    }
}
