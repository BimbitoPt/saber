# Terminal working directory without the Windows verbatim prefix

## Status and authorization

**Status:** Implemented and unit-verified 2026-10-08 (`terminal_start_strips_the_windows_verbatim_prefix` plus full `cargo test` 9/9 and `bun run test:terminal`). The manual packaged-terminal `bun install` smoke remains pending for the next packaged run.

**Status (history):** Short fix spec, approved for implementation with this document. The bug was found dogfooding Saber on 2026-10-06: a task terminal opened in a managed worktree starts in a `\\?\`-prefixed directory, under which Bun fails (`BadPathName`, corrupted bin metadata).

## Problem and user workflow

Worktree paths are stored via `realpathSync`, which returns `\\?\`-prefixed paths on Windows. The Tauri terminal spawns the shell with that prefixed directory as its working directory. Bun cannot operate there: installs corrupt (`could not open bin metadata file`) and direct invocations fail (`BadPathName`). Any tool with the same limitation breaks in every worktree terminal.

## Scope and exclusions

Strip the verbatim prefix at PTY spawn only, after the existing canonicalization and directory checks. Stored paths, returned metadata, lock comparisons, and the single-run workdir resolution stay exactly as they are. No changes to workspace creation, task/run storage, or non-Windows behavior.

## Requirements and acceptance criteria

- TCW-01 — Spawned shells start in an unprefixed directory. On Windows, `terminal_start` converts a canonicalized `\\?\C:\…` working directory to `C:\…` (and `\\?\UNC\server\share` to `\\server\share`) before spawning, after verifying the directory exists. Non-prefixed and non-Windows paths pass through unchanged. Verify with a Rust unit test covering prefixed, UNC, plain, and non-Windows forms, plus a manual `bun install` smoke in a packaged worktree terminal.
- TCW-02 — No stored or reported path changes. Terminal metadata, lock workdirs, API responses, and overlap comparisons keep their current forms. Verify with the existing terminal, task-store, and workspace suites passing unchanged.

## Verification plan

`cargo test` (new strip-function unit test plus existing terminal/runtime suites), `bun run test:terminal`, and the manual packaged-terminal `bun install` smoke recorded as the closeout receipt.
