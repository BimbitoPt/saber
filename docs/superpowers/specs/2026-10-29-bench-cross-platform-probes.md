# Cross-platform responsiveness bench probes

## Status and authorization

Approved next slice, 2026-10-29. User asked to focus on improving the Saber harness; the PowerShell-only responsiveness benchmark is an open gap recorded in `SESSIONS.md` (2026-10-27).

## Problem and user workflow

`bun run bench:responsiveness` currently hard-depends on PowerShell for the memory probe, host identification, and server cleanup, so the RBL-* baseline cannot run on Linux (the host where M7 desktop work now happens; see `SESSIONS.md`). The developer needs the same benchmark and report shape on Linux without regressing the Windows run verified on 2026-09-23.

The workflow is: run the benchmark on Linux, get the same JSON report fields (percentiles, sequence integrity, memory trend, budgets), and keep the Windows receipt and invocation unchanged.

## Scope and exclusions

Bounded deliverable: platform-specific probes inside `scripts/bench-responsiveness.ts` split into tested helpers in `scripts/bench-probes.ts`. Benchmark workload, xterm observation logic, budgets, sample counts, and report fields are unchanged.

Deferred: macOS support, moving memory classification thresholds, AppImage/pacman packaging, and any runtime optimization based on results.

## Requirements and acceptance criteria

- BCP-01: On Linux the memory probe detects headless Chromium processes and sums their resident memory without invoking PowerShell. On win32 the existing `Get-Process chrome-headless-shell` probe is preserved verbatim. The sample field name stays `workingSetBytes` so `memoryTrend` semantics hold. Kitchen-sink check: the Linux probe succeeds against a live headless Chromium run.
- BCP-02: On Linux the receipt's `host` block is filled from Node/OS data (`os.release()`, CPU model, total memory, distro name from `/etc/os-release` when readable) instead of `Get-CimInstance`. The host block still claims the same fields: `os`, `cpu`, `memoryBytes`, plus browser/runtime/app-mode labels. On win32 the PowerShell identification is preserved verbatim.
- BCP-03: On Linux the benchmark dev server is spawned detached so that cleanup can kill the whole process group and the benchmark port is not left occupied after an exit, including a run that throws mid-run. On win32 the existing taskkill and port-killer paths are preserved verbatim.
- BCP-04: A full run on a host whose platform differs from the receipt recorded by `2026-09-23-responsiveness-baseline-verification.json` (Windows) must not overwrite that receipt; non-win32 full runs write a distinct receipt path that includes the platform. Smoke runs continue to write nothing.
- BCP-05: The `/proc` parsing and `/etc/os-release` parsing helpers are unit-covered by a vitest test under `scripts/` so the harness fails clearly if stat parsing drifts.
- BCP-06: A loss of streaming page state mid-run (first observed as an opaque `null` after a 10-minute full run) fails the run immediately with an error naming the elapsed streaming time, every main-frame navigation observed with offset and URL, and the last browser errors. The run writes no receipt in that case and exits with a focused diagnostic instead of a `TypeError` on `streamState.rendered`. Detection is bounded by a 5-second in-loop health probe.

## Data and lifecycle

No persisted state changes. The benchmark keeps using a disposable temp directory and isolated task fixtures. The only new artifact is the platform-suffixed Linux receipt produced by a full run.

## Verification plan

- BCP-01: `bun run test` covers parsing helpers; `node scripts/bench-responsiveness.ts -- --smoke` on Linux completes with memory samples greater than zero while a real headless Chromium serves the run.
- BCP-02: The smoke run's log shows a Linux `host` block (distro visible in the receipt's `host.os`) with no PowerShell in the traceback-free path.
- BCP-03: After a forced-error run (`SABER_BENCH_PORT` set to a busy port) on Linux, `ss -tln` still shows port 8198 free after the process exits. (Acceptance: cleanup attempt does not hang; probe and host data fail cleanly with a thrown error rather than a silent PowerShell success.)
- BCP-04: Inspect `scripts/bench-responsiveness.ts` full-run receipt path for the platform suffix and confirm the Windows receipt file remains untouched by the Linux run.
- BCP-05: `bun run test` includes `scripts/bench-probes.test.ts` with fixture strings that mirror kernel stat layout (comm-with-spaces case included).
- BCP-06: Rerun the full bench with no concurrent repo edits during the receipt-producing run (HMR from an edit during the run is a plausible reload trigger); if state is lost again the thrown error names the navigation offset and URL so the source can be fixed instead of resampled.

## Completion evidence

Verified on the Linux host (Omarchy 7.2.8, i7-7700HQ, 16 GB), 2026-10-29.

- BCP-01: Linux memory probe returns live RSS without PowerShell. Smoke run sample ~584 MB; full run produced 20 samples (700–745 MB across the interval).
- BCP-02: Full-run receipt `host` block reads `linux 7.2.8-9-omarchy x64 (Omarchy)`, `Intel(R) Core(TM) i7-7700HQ CPU @ 2.80GHz`, 16.64 GB from Node/OS data plus `/etc/os-release`. No PowerShell in the Linux path; win32 path preserved verbatim.
- BCP-03: Server spawned detached and killed by process group. Cleanup verified on a natural error run (the failed first full run: port free, no temp directory, no chromium residue) and on both successful runs.
- BCP-04: The full run wrote `2026-09-23-responsiveness-baseline-verification.linux.json`; the Windows receipt `2026-09-23-responsiveness-baseline-verification.json` is git-tracked and unmodified.
- BCP-05: `scripts/bench-probes.test.ts` covers comm-with-spaces stat layout, field-24 RSS extraction, prefix-filtered sums, and PRETTY_NAME parsing; suite 218 passed / 1 platform-skipped (29 files). Live `/proc/self/stat` test ran on Linux.
- BCP-06: First full run failed at the stream end with an opaque `TypeError` on `streamState.rendered`; the failing probe was added and the harness now fails fast with elapsed time, navigation log, and browser errors. The second full run, executed with no repo edits during the run, completed cleanly — consistent with an HMR full-reload triggered by a mid-run workspace edit in the first attempt.
- RBL results from the Linux receipt (same budgets, no code changes): selection p50 23 ms / p95 32.5 ms / p99 36 ms against the 200 ms budget; render p50 13.5 ms / p95 20.6 ms / p99 21.9 ms against 500 ms; sequence integrity clean at 20.003 events/s per stream (12002 expected and received per stream); memory classified `plateau`, slope 4.6 MB/min over 20 samples; 36006 rendered output samples.
- Limitations: Tauri IPC, PTY, and provider paths remain mocked as before; the Linux probe matches all `chrome-headless*` comm names, a superset of the Windows process-name filter; the plateau verdict comes from a single 10-minute run and should be re-read against future code changes.
- interventions: 1 — the opaque mid-run failure that produced BCP-06. The platform port itself landed in one pass.
