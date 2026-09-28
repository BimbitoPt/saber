# Task terminal persistence across workspace views

## Status and authorization

**Status:** Implemented; automated checks pass. Packaged Omarchy A-to-B-to-A retest remains pending.

## Problem and user workflow

When a user opens task A's terminal, navigates to Board, selects task B, and later returns to A, Saber currently removes the terminal workspace from the React tree when the view changes to List or Board. TerminalSurface cleanup closes its PTY and releases its task lock. The user's Omarchy run reproduced the loss: task A's marker and original terminal did not appear after returning.

The terminal view is a workspace subview. Leaving it to inspect or select tasks must not end live task shells. Opened task terminals will remain mounted while Saber shows Terminal, List, or Board. The selected task's terminal becomes visible when Terminal is selected; a newly selected task will not start a shell while the user remains in List or Board.

## Scope and exclusions

**In scope:** Keep task-owned terminal surfaces and PTYs alive across Terminal/List/Board view changes; restore the selected task's existing xterm buffer when returning to Terminal; preserve existing Board-to-List task-detail behavior; add an automated React lifecycle regression test; rerun the M7 checks affected by the change.

**Out of scope:** Persisting xterm scrollback across app reloads, changing task selection semantics, changing PTY ownership, changing task/run separation, or adding recovery after Saber exits.

## Requirements and acceptance criteria

### TVP-01 — Keep live task terminals mounted across workspace subviews

After a task terminal has started, moving between Terminal, List, and Board keeps its TerminalSurface component mounted and its existing PTY/session alive. These view changes must not invoke terminal_close, release the terminal lock, or lose xterm scrollback. The terminal layer remains hidden and non-interactive while another subview is visible.

**Acceptance:** Open task A's terminal and run a unique marker. Select Board, select task B, and move through List/Terminal views. The automated lifecycle test observes one A surface mount and zero A surface unmounts before actual workspace disposal; the packaged Omarchy app shows A's marker on return.

### TVP-02 — Do not start a newly selected task's shell behind Board/List

Selecting an unopened task from Board or List updates selection and detail state but does not spawn a PTY until its Terminal view becomes active. Returning to Terminal starts that task's shell once. Existing live terminals remain mounted while it starts.

**Acceptance:** Select unopened task B from Board. Before Terminal is selected, B has no surface/PTY start. After selecting Terminal, B starts exactly once while A's existing surface remains mounted.

### TVP-03 — Preserve terminal cleanup on actual application shutdown

Closing Saber continues to terminate and reap only its owned terminal children and server process. Keeping UI subviews mounted must not weaken application-close cleanup.

**Acceptance:** Existing Rust PTY cleanup tests pass, and the packaged Omarchy close check reports the launcher PID exited with no Saber or bundled Node process remaining.

## Data and lifecycle

- TaskWorkspace owns one mounted TerminalSurface per opened task with a starting, running, or interrupted session while the workspace remains mounted.
- Changing selected task or Terminal/List/Board view changes visibility and active focus only; it does not transfer or release PTY ownership.
- New selected tasks may be marked as requested, but their surface starts only when Terminal view is active.
- Tauri TerminalSessions remains the sole owner of PTY child processes. Application shutdown remains responsible for closing those children.
- Existing task session IDs, effective working directories, and task/run separation remain unchanged.

## Verification plan

| Requirement | Automated verification | Manual/system verification |
| --- | --- | --- |
| TVP-01 | jsdom React lifecycle test mounts A once, switches Terminal → Board → List → Terminal, and asserts A is not unmounted and marker output remains. | Packaged Omarchy task A marker remains visible after selecting B on Board and returning to A's Terminal view. |
| TVP-02 | Same test asserts B is not mounted before Terminal is selected and starts exactly once after selection, without remounting A. | Packaged Omarchy task B starts on entering Terminal and A resumes with its existing marker and working directory. |
| TVP-03 | Existing bun run test:terminal plus Rust terminal child-cleanup coverage. | Close packaged Saber and confirm the launcher and owned terminal/server processes have exited. |

## Completion evidence

- **Observed failure (2026-09-25):** The user selected another task from Board and reported that task A's marker and original terminal did not appear on return. Static tracing found Board selection changes the subview to List; the current render condition removes all TerminalSurface components outside Terminal view, and their cleanup closes the PTYs. This conflicts with TFW-04's requirement to keep each opened task's terminal mounted while Saber is open.
- **M7 cleanup evidence:** The packaged AppImage launched in Omarchy. After app close, the recorded launcher PID exited. The only process returned by the broad scan was fusermount3 for /run/user/1000/doc, a desktop document-portal mount helper, not a Saber process.
- **Automated verification (2026-09-26):** `bun run test -- src/components/TaskWorkspace.test.tsx` passed on Windows and Ubuntu 26.04 WSL (1/1 each). The jsdom regression test verifies task A remains mounted when Board selects B, B is not mounted until Terminal is selected, returning to A retains the same marker and does not start a second surface, and actual TaskWorkspace unmount cleans up every mounted terminal surface.
- **Cross-platform verification (2026-09-26):** Windows `bun run test` passed (17 files, 90 tests), `bun run test:terminal` passed (2 Rust + 13 Vitest), `bunx tsc --noEmit` passed, and `bun run build` passed. Ubuntu 26.04 WSL focused lifecycle test (1/1), `bun x tsc --noEmit`, Linux web production build, checksum-verified Node v24.21.0 sidecar preparation, and Debian/AppImage release packaging passed. Refreshed AppImage and `.deb` were copied to the Omarchy shared folder; SHA-256 AppImage `6c2a5f6c2a745acb59652fbedf5fa7ba14b4366fefec7c1f9c51c4b2230a0249`, DEB `c68f04e7ce540bca4302e43b3b781d856adf2d34cae0c16ebb2c026414b7631a`.
- **Remaining manual acceptance:** Launch the refreshed AppImage in Omarchy and verify A's marker and shell return after selecting B from Board, then verify B starts only after opening Terminal and check close cleanup again. LDR-05 stays open until this is observed.
