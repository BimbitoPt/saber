# Responsiveness baseline for Saber workspaces

## Status and authorization

Approved next slice, 2026-09-23. Derived from the approved product direction's PERF-01 and the user's request to make context switching and multitasking faster. This slice measures the current behavior; it does not change runtime behavior based on unproven assumptions.

## Problem and user workflow

Saber now preserves task-owned terminal sessions and saved context across task switches, but there is no repeatable evidence that selection, terminal restoration, and streamed output stay responsive under a realistic multitasking load. The developer needs measured baselines before Saber can target actual bottlenecks.

The workflow is to run a documented benchmark with ten saved tasks and three active output streams, review latency and memory results against the existing budgets, and use those results to decide whether a separately specified optimization is needed.

## Scope and exclusions

Build a repeatable, local benchmark harness for task-selection-to-restored-content latency and synthetic streamed-output rendering. Record test environment, sample counts, percentile results, failures, and memory observations in a versioned receipt. Exercise the real task selection and output presentation paths where the test environment permits; clearly label any mocked process or provider boundary.

Do not change user-facing behavior, provider concurrency policy, terminal scrollback semantics, memory caps, event persistence, or output buffering in this slice. Do not claim provider generation or network latency. Linux/macOS and authenticated Claude Code coverage remain outside the current Windows host run.

## Requirements and acceptance criteria

- RBL-01: Task restoration latency is measured with ten persisted tasks. Record at least 200 A/B task selections after warmup and report p50, p95, and p99 for the time from selection input to the selected task's local context and terminal surface being restored and visible. Compare p95 to the approved PERF-01 budget of 200 ms. The harness fails clearly if it cannot establish the selected task's restored state.
- RBL-02: Stream rendering latency is measured with three simulated streams at a 20 events-per-second target each, allowing ±5% browser scheduling tolerance and recording each achieved rate. Assign stable per-stream sequence numbers and monotonic send timestamps; observe each owning task's xterm DOM as output renders, including while that task's surface is hidden. Report p50, p95, and p99 from harness dispatch to xterm rendering, compare p95 to the approved PERF-01 budget of 500 ms, and report dropped, duplicated, or out-of-order sequence IDs separately. Keep task selection-to-visible restoration separate under RBL-01 because inactive task surfaces are hidden by design while their xterm buffers continue to receive output.
- RBL-03: The sustained run lasts at least ten minutes and records process memory at warmup completion and at regular intervals thereafter. Report overall warmup growth and classify the later half of the interval as plateau or growth using a documented 10% relative-change threshold. Do not claim a plateau from a short run or a single before/after sample.
- RBL-04: Every receipt records the commit identifier, OS, CPU, memory, display scale, app mode/build, runtime/browser versions, workload parameters, sample counts, and exact command used. Measurements identify synthetic components and exclude provider/network time.
- RBL-05: A result that misses a budget or reveals dropped output creates a concrete finding for a follow-up spec; it does not silently widen this slice into runtime changes. A passing result reports the baseline and remaining platform gaps.

## Data and lifecycle

The harness uses disposable test tasks and synthetic output only. It must not write test markers, benchmark data, or generated artifacts into a user's project checkout. Benchmark artifacts live under a dedicated temporary directory or the versioned verification receipt. Task records used by the run are isolated from normal user data. Event sequence IDs are unique within each simulated stream and are never treated as task or run IDs.

## Verification plan

- RBL-01: run the benchmark against ten disposable tasks, switch repeatedly, and inspect the produced per-sample and percentile report; verify the 200 ms threshold is evaluated from measured samples.
- RBL-02: start three independent synthetic streams at 20 events per second, validate sequence integrity, and inspect the measured event-to-visible-output distribution and 500 ms threshold.
- RBL-03: complete a ten-minute run and inspect interval samples for process memory; confirm the report distinguishes a stable plateau from monotonic growth.
- RBL-04: inspect a generated receipt for all environment and workload fields, then repeat the command to confirm it can be rerun.
- RBL-05: exercise a deliberately failing threshold in harness tests and confirm it produces a finding without modifying app runtime behavior.

## Completion evidence

Verified on Windows, 2026-09-23. See `docs/superpowers/specs/2026-09-23-responsiveness-baseline-verification.md` and the raw JSON receipt. A preliminary foreground-rotation stress probe exceeded 500 ms because it mixed repeated task-selection time into each output sample; the approved workload separates that input from per-terminal render latency. No runtime optimization is justified by this baseline.
