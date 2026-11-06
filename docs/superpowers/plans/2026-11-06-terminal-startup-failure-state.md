# Plan: terminal startup failure state

## Goal

Resolve issue #13 without changing terminal lifecycle semantics.

## Steps

1. **TERM-INIT-01 / TERM-INIT-02:** In the terminal initialization catch path, set the readiness state to complete alongside the existing startup error.
2. **TERM-INIT-03:** Add a jsdom regression test that rejects native session discovery and asserts the loading message disappears while the error and non-running state render.
3. Run the focused test, full Vitest suite, typecheck, and production build in CI or a local checkout. Record any unavailable platform-specific checks separately.

## Safety

- Do not retry or create a terminal automatically after discovery failure.
- Do not modify Tauri process ownership or server APIs.
- Preserve cancellation behavior when the component unmounts.
