# Flywheel slice A: calibrated judge + golden-trajectory library

Status: Draft for review. No implementation until approved.
Date: 2026-09-21

## Problem

Saber persists tasks, runs, and events (`src/server/taskStore.ts`: `tasks`, `runs`, `events`), and launches OpenCode with the exact spec revision, criteria, and saved context (`src/server/agentRuns.ts`). But a finished run carries no machine-readable verdict: no per-criterion pass/fail, no evidence link, no failure tag, no reusable golden trajectory. VERIFY-01 (`2026-09-21-saber-product-direction.md`) requires exactly that record — criterion, command or check, outcome, time, revision — and without it every review starts cold, reviewer-agent verdicts can't be trusted or measured, and nothing compounds between runs.

## User workflow

1. A run finishes (`done` = ready for review, never verified — unchanged).
2. The developer reviews the run against its frozen criteria (spec revision captured at launch) and records per-criterion pass/fail with evidence (file:line, test output, screenshot). Optionally tags failures from a fixed set.
3. A reviewer agent can record advisory verdicts in the same shape (`source=reviewer`).
4. The dashboard shows reviewer-vs-human agreement (%, Cohen's kappa) over sampled runs. Below threshold, advisory verdicts stay advisory; above it, they may pre-fill review (human still confirms).
5. Repaired or exemplary passed runs are promoted to a golden-trajectory library, retrievable when building future prompts.
6. Weekly: agreement + verdict stats are reviewed; prompt/harness changes ship only if the judge still tracks human judgment.

## Scope

Harness-level flywheel only — no model weights, no training, no GPU work. SQLite via the runtime's built-in `node:sqlite` (same as current `TaskStore`). New tables only; existing `tasks`/`runs`/`events` shapes unchanged. OpenCode provider only. Single shared checkout rules unchanged (workspace overlap guard stays).

## Exclusions

Model fine-tuning/SFT/GRPO/gist training (slice B or later, needs GPU infra + labeling budget); new provider adapters (Codex/Claude Code); isolated worktrees (MULTI-01); auto-merge/auto-publish; automatic verification without human confirmation; secrets in checkpoints or goldens.

## Requirements

### JUDGE-01: Per-criterion verdict capture

Record one verdict per acceptance criterion per reviewed run: criterion index + frozen criterion text, `pass`|`fail`, evidence reference (file:line, test command + outcome, or screenshot id), source (`human`|`reviewer`), timestamp, and the run's spec revision.

Acceptance: reviewing a `done` run writes verdicts queryable by run; verdicts pin the criterion text and spec revision at review time; verdicts recorded against a non-current spec revision are marked stale immediately (per SDD-01), and a later spec edit marks affected current verdicts stale rather than silently keeping them green. Stale verdicts never confer verified state.

### JUDGE-02: Agreement gate for advisory verdicts

Compute reviewer-vs-human agreement over doubly-reviewed sampled runs: raw % plus Cohen's kappa. Dashboard surfaces both with sample count. Advisory (reviewer-source) verdicts are visually distinct and never confer verified state on their own; they may pre-fill a human review only while agreement stays above a configured threshold (default kappa >= 0.6 on >= 25 samples; threshold and sample floor live in one server config constant).

Acceptance: agreement visible with sample count; below-threshold advisory verdicts cannot mark criteria verified; threshold and sample floor are configurable, not hardcoded.

### GOLD-01: Golden-trajectory library

Promote a passed or repaired run (or single-criterion trajectory) to `goldens`: link to run + criterion, trajectory reference (event range), status `active`|`retired`, timestamp. Goldens are read-only snapshots — later edits never mutate them; retirement is explicit. A retrieval query returns active goldens by tag/criterion text for future prompt building.

Acceptance: promote/retire/list round-trips; goldens survive task edits and server restarts; retired goldens stay for history but are excluded from retrieval.

### HEAL-01: Heal-retry on failed runs

From a failed verdict, launch a follow-up run of the same task carrying a repair hint (failed criterion + evidence + short instruction) alongside the frozen spec context. The follow-up is a new run (immutable run scope preserved); if it passes, its trajectory becomes a promotion candidate for GOLD-01. Failed heals keep their failure tags.

Acceptance: heal-retry creates a new run with repair hint recorded; original run untouched; passed heals promotable in one action; failed heals retain tags.

### LOOP-01: Weekly flywheel review

A review surface shows, since last review: verdict counts by tag, agreement trend, goldens added/retired, and prompt/harness edits the developer notes as made (manual entry, not auto-detected). Recording the review (reviewer identity + timestamp) is required before goldens promoted since the last review count toward retrieval. This is manual (human reads and decides), not scheduled automation.

Acceptance: review shows the four items above from stored data; goldens promoted since the last recorded review are excluded from retrieval until the review is recorded.

### CTX-01: Just-in-time prompt instructions

Serve provider/skill instructions with the relevant context at launch time instead of growing one static prompt: stable prompt core stays small; per-project/per-task instructions attach at run creation and are recorded on the run. No behavior change to the launch itself in this slice beyond recording what was attached.

Acceptance: run record shows which instruction blocks were attached; core prompt size stays flat as instruction count grows.

## Dependencies

- `2026-09-21-saber-product-direction.md` (SDD-01, VERIFY-01, task/run separation).
- `2026-09-21-persistent-tasks.md` (taskStore, run lifecycle, restart reconciliation — reused unchanged).
- `src/server/taskStore.ts`, `src/server/agentRuns.ts`, `src/lib/tasks.ts` types.

## Failure cases

- Reviewing a run from a stale spec revision: verdicts rejected or marked stale, never recorded as current.
- Advisory verdict presented as verified: prevented by source flag + agreement gate (JUDGE-02).
- Golden promotion of a bad run: promotion is explicit human action; retirement is one action; no auto-promotion in this slice.
- Failure-tag sprawl: fixed tag set; new tags require a spec edit, not free text.
- SQLite growth: verdicts/failures/goldens are small rows; event excerpts referenced by range, not copied.
- Restart mid-review: drafts are UI-local recovery + persisted task draft (existing PT-03); verdicts write atomically per criterion.

## Verification

- Isolated temporary SQLite databases for store tests (new tables, stale-invalidation, agreement math edge cases: empty sample, perfect/zero agreement) plus fake child processes for heal-retry lifecycle; existing Vitest suite (`bun run test`) and TypeScript check must pass.
- Restart dev server on port 8082; in a browser verify: review a done run criterion-by-criterion, tag a failure, see agreement update, promote/retire a golden, heal-retry a failed run, and confirm spec edits stale affected verdicts.
- Do not launch coding agents against the user's repository merely to test the UI.
