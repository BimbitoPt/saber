# LDR-05 Native Terminal Verification Checklist (Windows)

**Product:** Saber v0.1.0 (pt.mstudioweb.saber)  
**Build:** MSI (`Saber_0.1.0_x64_en-US.msi`) and NSIS (`Saber_0.1.0_x64-setup.exe`)  
**Status:** Ready for manual verification as of 2026-10-08  
**Artifacts:**  
- MSI: `src-tauri/target/release/bundle/msi/Saber_0.1.0_x64_en-US.msi`  
- NSIS: `src-tauri/target/release/bundle/nsis/Saber_0.1.0_x64-setup.exe`  

## Prerequisites
1. Clean Windows environment (fresh account or cleared `%LOCALAPPDATA%\Saber` and `%APPDATA%\Saber`)
2. No existing Saber processes running
3. Port 8082 free (or use alternative port via environment variable)

## Verification Steps

### 1. Installation
- [ ] Run the MSI installer (or NSIS installer) with default options
- [ ] Launch Saber from Start Menu or desktop shortcut
- [ ] Verify application opens successfully (shows task board or welcome screen)

### 2. Packaged PTY Marker/CWD Verification
- [ ] Create a test task with:
  - **Project:** `C:\temp\saber-test-workspace` (create this directory)
  - **Title:** "Terminal CWD Test"
  - **Spec:** "Verify terminal starts in correct working directory"
  - **Criteria:** 
    - AC-01: Terminal session starts in the specified project directory
    - AC-02: No `\\?\` verbatim prefix in working directory
- [ ] Save the task
- [ ] Launch the task (should start in "Running" state)
- [ ] Wait for terminal to initialize (~5 seconds)
- [ ] In the terminal pane, run: `cd` (PowerShell) or `pwd` (if using bash via SSH, but note Windows uses PowerShell)
- [ ] Verify output shows: `C:\temp\saber-test-workspace`
- [ ] Verify output does **NOT** show: `\\?\C:\temp\saber-test-workspace`
- [ ] Run a simple command to verify functionality: `echo "SABER_MARKER_TEST_$(Get-Random)"`
- [ ] Verify the echo command executes successfully and shows the marker

### 3. A-B-A Recovery Verification
- [ ] With the terminal running from step 2, note the terminal session ID (visible in developer tools or via task inspection)
- [ ] Simulate an abnormal terminal exit:
  - **Method A:** From Task Manager, end the PowerShell.exe process that is a child of Saber
  - **Method B:** In the terminal, run: `Stop-Process -Id $PID -Force` (self-terminate)
- [ ] Wait 2 seconds, verify task status changes to "Interrupted" in UI
- [ ] Click "I confirm the old process has stopped" in the interrupted run banner
- [ ] Task should return to editable state
- [ ] Relaunch the task (same provider/model)
- [ ] Wait for new terminal to initialize
- [ ] In the new terminal, run: `cd`
- [ ] Verify output shows: `C:\temp\saber-test-workspace` (same directory as before)
- [ ] Verify the terminal is functional: run another echo command with a new marker

### 4. Graceful Owned-Process Shutdown Verification
- [ ] With a running task terminal (from step 3), note:
  - Saber's main process ID (from Task Manager)
  - Any child PowerShell.exe processes (should be one)
  - The bundled server process (node.exe from resources)
- [ ] Close Saber via:
  - **Primary:** Click the X (close) button on the window
  - **Alternative:** File → Exit (if menu exists)
  - **Alternative:** Right-click taskbar icon → Close window
- [ ] Wait 3 seconds after close
- [ ] Verify in Task Manager:
  - [ ] No `mstudio-ade.exe` process remains
  - [ ] No PowerShell.exe child processes remain
  - [ ] No node.exe (from Saber/resources) process remains
  - [ ] Only expected system processes (e.g., document portal fusermount3 equivalent on Windows)
- [ ] Re-launch Saber and verify clean startup (no recovery prompts unless intentionally testing interruption)

### 5. Cleanup
- [ ] Uninstall Saber via Windows Settings → Apps
- [ ] Delete test workspace: `rmdir /s /q C:\temp\saber-test-workspace`
- [ ] Clear any remaining Saber data if needed: 
  - `rmdir /s /q %LOCALAPPDATA%\Saber`
  - `rmdir /s /q %APPDATA%\Saber`

## Acceptance Criteria
All checks in sections 2, 3, and 4 must pass for the verification to be successful.

## Notes
- Terminal uses PowerShell by default on Windows (configured in `src-tauri/src/terminal.rs::default_shell`)
- Working directory is canonicalized then verbatim prefix stripped (see `validate_start` and `strip_verbatim_prefix` functions)
- Task-owned processes are tracked and cleaned up on app exit via `main.rs` event handlers
- Verification assumes default installation paths; adjust paths if custom install location used

## Evidence Collection
For successful verification, capture:
1. Screenshot of terminal showing correct `cd` output (no verbatim prefix)
2. Screenshot of task showing successful A-B-A recovery (interrupted → running)
3. Task Manager view showing clean process shutdown after close
4. Installer version/build timestamp confirming post-fix build

---
**Verification completed by:** ________________________  
**Date:** ________________________  
**Result:** [ ] PASS [ ] FAIL  
**Notes:** 