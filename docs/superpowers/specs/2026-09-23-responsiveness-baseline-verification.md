# Responsiveness baseline verification

## Outcome

Verified on Windows, 2026-09-23. This receipt corresponds to `docs/superpowers/specs/2026-09-23-responsiveness-baseline.md`, at revision `ffb4b2fda2e6baaf8e78a20599946421453a3187`. Raw selection/output samples, per-stream sequence IDs, and all memory intervals are in `2026-09-23-responsiveness-baseline-verification.json`.

## Environment and command

- OS: Microsoft Windows 11 Home 10.0.26200 AMD64
- CPU: Intel Core i7-10750H @ 2.60 GHz
- Physical memory: 16,954,851,328 bytes
- Display scale: Chromium device scale factor forced to 1 for this headless run
- Browser: Chromium 153.0.8010.12; Playwright 1.63.0
- Runtime: Node 24.15.0; Vite 8.3.0 development server
- App mode: real Saber frontend and xterm.js UI; Tauri IPC, OS PTY creation, and process output source mocked
- Exact command: `bun run bench:responsiveness`
- Fixture: ten persisted synthetic tasks, each with its own disposable project directory and isolated task database. Temporary data was removed after the run.

## Requirement evidence

| Requirement | Result | Evidence |
| --- | --- | --- |
| RBL-01 | Pass | 400 A/B selections after warming ten task terminals. p50 101 ms, p95 179.5 ms, p99 230.6 ms, max 430.9 ms. The p95 is within the 200 ms target. |
| RBL-02 | Pass | Three synthetic streams scheduled at a 20 Hz target for 600 seconds. Chromium delivered 11,417 events per stream (19.03 Hz each, within the specified 5% timer tolerance). Across 34,251 xterm DOM renders, p50 24.3 ms, p95 43.6 ms, p99 83.6 ms, max 716 ms. All stream sequences were present, ordered, and unique. |
| RBL-03 | Pass | 20 Chromium working-set samples at 30-second intervals. Overall warmup moved from 458,035,200 to 545,456,128 bytes; the later half moved from 539,672,576 to 545,456,128 bytes (+1.07%), within the 10% plateau threshold. |
| RBL-04 | Pass | Host, runtime, browser, workload, sample counts, revision, command, and mocked boundaries are recorded above and in the raw JSON. |
| RBL-05 | Pass | Both p95 targets passed and no xterm-render sequence gaps were found. No runtime change or follow-up optimization is justified by this baseline. |

## Interpretation and limits

Task restoration and stream rendering are separate measurements. The stream observer records each task-owned xterm DOM as it renders, including while that terminal surface is hidden; RBL-01 measures how quickly the selected task and its terminal become visible. This matches Saber’s single-active-terminal UI and avoids charging output latency for an artificial series of user task switches.

A separate exploratory run rotated the foreground terminal continuously while all streams emitted. Its combined dispatch-to-current-viewport p95 was 642.5 ms and some older markers were no longer in the viewport at the instant sampled. That probe mixed selection time with output rendering; the fixed-focus acceptance run observed every event in the owning xterm DOM. The exploratory result is not evidence of lost terminal output and is not used as the RBL-02 budget result.

This is a Windows headless browser measurement. Provider generation, network time, native Tauri/WebView memory, and native PTY scheduling were not measured. Linux and macOS remain untested. The browser’s 10-minute working-set plateau is not a claim about the shipped desktop process.

## Verification

The metric helper tests cover percentile calculation, budget checks, missing/duplicate/out-of-order IDs, and late-window memory plateau classification. The benchmark passed smoke mode before the full run. Full repository Vitest passed with `bun run test -- --no-file-parallelism --maxWorkers=1` (12 files, 57 tests); the isolated pagination test passed 8/8. The application TypeScript check and a separate benchmark-script TypeScript check passed. `bun run build` passed. Running the suite concurrently with build/typecheck once caused its existing 2,105-event pagination test to hit Vitest's 5-second timeout; the full serial rerun passed without source changes.
