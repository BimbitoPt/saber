# Terminal-first workspace verification

Date: 2026-09-23

## Status

M1 and M2 complete on the Windows host. Linux/macOS and authenticated Claude Code behavior are not covered by this receipt.

## Evidence by requirement

| Requirement | Result | Evidence / remaining work |
| --- | --- | --- |
| TFW-01 | Verified on Windows | Launched the Tauri desktop app. The selected task opened in the primary terminal pane while the task list and Board remained reachable. |
| TFW-02 | Verified on Windows | The desktop shell opened PowerShell in `C:\Users\Guilh\Desktop\mstudio-ade`; the prompt showed that exact working directory. The focused Rust PTY test also passed, exercising shell output, requested working directory, and resize. Linux/macOS and missing-shell startup paths remain untested. |
| TFW-03 | Verified on Windows | In the Tauri WebView, typed `Write-Output SABER_INTERACTIVE_OK` and confirmed the command and marker rendered. Pasted `Write-Output SABER_CLIPBOARD_OK` from the system clipboard and confirmed it executed. Maximized the window and confirmed the terminal resized while preserving output. Ran a Python ANSI screen smoke program that cleared/redrew the terminal, waited for `q`, rendered the received key, and returned to the PowerShell prompt. |
| TFW-04 | Verified on Windows | In the Tauri app, opened task A in `C:\Users\Guilh\Desktop\mstudio-ade` and task B in a separate temporary worktree. Ran `SABER_M2_A` and `SABER_M2_B`, switched A -> B -> A -> B, and confirmed each visible terminal retained its own prompt and marker output. The terminal API showed one running session for each task after switching, with no duplicate start. |
| TFW-05 | Verified by backend tests | `bun run test:terminal` passed. Tests cover terminal-terminal overlap rejection, disjoint-directory parallelism, release, agent-run rejection while a terminal owns the path, terminal rejection while a running/interrupted agent run owns the path, and existing agent lifecycle behavior. Durable lock hydration and explicit interrupted recovery tests also passed. |
| TFW-06 | Verified on Windows | Task A displayed the saved checkpoint and next action. Used the checkpoint Copy action, read the system clipboard, and confirmed it contained exactly `Decision: keep the current stack. Next: verify restoration after restart.` The shell output remained unchanged; switching tasks did not send context to either shell. |
| TFW-07 | Verified on Windows | Browser preview inspected at `http://localhost:8082/`; it does not start shells and shows the desktop-runtime message. Tauri build manifest exposes only the four terminal commands, and `src-tauri/capabilities/default.json` grants only those terminal command permissions alongside core permissions. |
| TFW-08 | Verified on Windows | Closed the Tauri app and confirmed its PowerShell children exited. On the next app start, a previously live task appeared as interrupted instead of launching a shell. Confirmed the old process was absent, explicitly chose “Confirm shell stopped and unlock,” then started a new shell manually. Persisted records reported both current task shells as running and the older recovered record as stopped. |

## Checks run

- `bun run test:terminal` — passed on 2026-09-23: 2 Rust PTY tests and 13 focused Vitest tests. The PTY test explicitly emits its PowerShell working directory and releases the shell, PTY, and output-reader handles before removing its Windows temporary directory.
- `bun run test:terminal` — passed on 2026-09-23: 2 Rust PTY tests and 12 focused Vitest tests.
- `node node_modules/typescript/bin/tsc --noEmit --pretty false` — passed after the client-only xterm import adjustment.
- `bun run build` — passed after the client-only xterm import adjustment.
- `bun run tauri dev` — launched the Tauri app on Windows. The first shell attempt exposed missing Tauri capability permissions for the four terminal commands; added the narrow generated allow-permissions to `src-tauri/capabilities/default.json`, rebuilt, relaunched, and verified the shell.
- Desktop shell smoke — verified PowerShell task working directory, typed input/output, system clipboard paste, resize with scrollback retained, ANSI interactive screen/key input, and shell process exit on app close. The app-launched test instance was closed; the browser preview server remains on port 8082.
- Restarted `bun run dev -- --port 8082 --strictPort` and inspected the browser fallback. This also exposed and resolved an SSR failure caused by statically importing xterm's CommonJS entry; xterm and fit addon now load dynamically in the client effect.
- Claude Code authenticated live test remains skipped per the user's instruction; no Claude account is available.

## M2 checks and desktop evidence

- `bun run test -- src/server/taskStore.test.ts src/server/terminalLocks.test.ts src/server/agentRuns.test.ts` — passed, 19 tests.
- `bun run test` — passed, 11 files and 52 tests.
- `bun run test:terminal` — passed on rerun, 2 Rust PTY tests and 13 Vitest tests. An initial concurrent run hit a Windows temporary-directory file lock during PTY cleanup; the isolated rerun passed.
- `node node_modules/typescript/bin/tsc --noEmit --pretty false` — passed.
- `bun run build` — passed for client, SSR, and Nitro output.
- Tauri task-switch smoke — verified A -> B -> A -> B with distinct working directories and marker output. Both current sessions remained running in the terminal-session API; no task-switch start was issued for an already-opened surface.
- Context handoff — copied the saved checkpoint and read it from the system clipboard. No shell input was added by copy or task switching.
- Restart recovery — a live B record absent from the new Tauri process was presented as interrupted. After checking the old shell process was absent, explicitly recovered it and manually started a replacement. No session was silently relaunched.
- Tauri app close — confirmed the task-owned PowerShell children exited. Linux/macOS and Claude Code remain untested.

## Completion

M1 and M2 acceptance criteria TFW-01 through TFW-08 are verified on Windows through the evidence above. Linux/macOS coverage remains untested, and the authenticated Claude Code live test remains skipped at the user's request.
