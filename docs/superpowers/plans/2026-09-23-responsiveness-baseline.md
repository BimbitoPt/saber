# Responsiveness baseline implementation plan

**Status:** Complete on Windows, 2026-09-23. Evidence is recorded in `docs/superpowers/specs/2026-09-23-responsiveness-baseline-verification.md` and its raw JSON sample receipt.

**Goal:** Measure task restoration, streamed rendering, and memory under a documented synthetic multitasking workload before considering optimizations.

**Guardrails:** Do not change runtime behavior in response to an unverified guess. Isolate disposable tasks and outputs from user data and project checkouts. State mocked boundaries and Windows-only evidence.

## Task 1: Isolated benchmark fixture — RBL-01, RBL-04

Create disposable benchmark task data and record the current revision and host/runtime metadata. Ensure setup and cleanup are scoped to the benchmark directory.

Verification: run the fixture twice and confirm no project files or normal task records are modified.

## Task 2: Selection latency capture — RBL-01

Capture monotonic timestamps around task selection and the visible restoration of its saved local context and terminal surface. Warm up first, collect at least 200 samples across ten tasks, and report p50/p95/p99 plus the 200 ms p95 target.

Verification: verify selected task IDs match each sample and test the failure path when restoration never completes.

## Task 3: Synthetic output workload — RBL-02, RBL-03

Dispatch three independently identified streams at a 20 events-per-second target each, with ±5% browser scheduling tolerance reported per stream, for at least ten minutes. Observe each owning xterm DOM without switching task focus, capture dispatch-to-render latency and sequence integrity, and record periodic process-memory samples. Keep active task restoration timing in Task 2.

Verification: account for every stable stream sequence in the xterm DOM, retain all latency samples, and confirm the report has enough intervals to evaluate later memory trend.

## Task 4: Receipt and decision gate — RBL-04, RBL-05

Write a dated report containing environment, exact command, workload, distributions, memory trend, dropped-event counts, platform scope, and findings. If measurements miss a budget or show output loss, draft a separate bounded remediation spec tied to the evidence.

Verification: all five RBL requirements are addressed in the receipt. Focused metric tests passed (5/5); full Vitest passed serially (12 files, 57 tests); application and benchmark TypeScript checks passed; `bun run build` passed. No runtime behavior changes were made because the accepted baseline met its budgets.
