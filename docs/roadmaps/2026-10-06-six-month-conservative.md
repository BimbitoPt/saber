# Saber — Conservative 6-Month Roadmap

6 October 2026 → March 2027 · Solo operator + AI leverage · Saber gets ~70% of product capacity (Onyx ~30%)

## Where Saber stands (evidence, not vibes)

- M1–M6 complete and verified **on Windows only** (`docs/roadmaps/2026-09-22-terminal-first-saber.md`, verification receipts in `docs/superpowers/specs/`).
- M7 (Linux desktop runtime) **incomplete**: `.deb` extracted-not-installed, packaged UI acceptance missing, LDR-05 failed. Windows packaged PTY + clean-account install also outstanding.
- Authenticated **Claude smoke never ran** (no account) — the Claude adapter is unverified.
- Project-aware agent context (the Onyx consumer side) is a **draft spec, no code** (`2026-09-28-project-aware-agent-context.md`).
- Last burst 18–28 Sept 2026, quiet since. No cross-platform claims may be made from one host.

## Conservative rules for these 6 months

1. **Close receipts before opening features.** No new workstream starts while a claimed milestone lacks its receipt.
2. **Dates are no-earlier-than.** Each phase ships when its exit criteria pass, never to hit a calendar date.
3. **Half-capacity planning.** ~50% of each month is reserved for studio client work, unknowns, and verification reruns. Estimates below already include that buffer — do not compress them.
4. **Windows-first, honesty elsewhere.** Anything unverified on an OS is documented as such; no Linux/macOS claims without receipts.
5. **The defer list stands.** Splits, SSH, replay, swarms, cloud, auto-merge stay deferred (per terminal-first roadmap).

## Phase A — Receipt closure (Oct → mid-Nov 2026)

Goal: every claimed milestone earns its receipt. Nothing new.

- A1. M6 interaction gaps: long-text scroll, pointer navigation, Enter selection, focus restoration — verify in native Tauri, record receipt or file failures.
- A2. Windows packaged PTY marker/cleanup + clean-account/VM install — verify, rebuild MSI/NSIS after the Rust reader fix (required by M7 notes).
- A3. Authenticated Claude smoke test (blocked until a Claude account exists — if still blocked end-Oct, record the block and move on; do not fake it).
- A4. Review the project-aware agent context draft spec; approve or revise. **This unblocks Onyx M5.** No implementation yet.

Exit criteria: A1–A2 receipts recorded; A3 passed or formally blocked; A4 spec approved. If A3 stays blocked, it does not hold Phase B.

## Phase B — M7 to done-or-scoped (mid-Nov → Dec 2026)

- B1. Packaged Linux UI acceptance: installed (not extracted) `.deb`, native task-terminal marker/cwd, A-B-A recovery, graceful shutdown — on Ubuntu 26.04 WSL2 first, one bare-metal distro second if cheap.
- B2. Decision point: if B1 fails twice, **scope M7 to "WSL2-supported, native-Linux experimental"** in writing and stop spending. Sunk-cost Linux work is the biggest risk to this roadmap.
- B3. Onyx consumer slice: implement the approved context spec — Saber calls Onyx `GET /context/query` at session spawn, records `contextSha`. Demo receipt, Windows only.

Exit criteria: M7 receipt or written scope cut; Onyx context injection demoed end-to-end.

## Phase C — Alpha hardening (Jan → Feb 2027)

- C1. One external alpha user (not the author) installs and runs daily for 2 weeks. Fix only what blocks them; log the rest.
- C2. Update + docs pass: install docs, provider setup guide, troubleshooting from real alpha friction.
- C3. Perf re-baseline on the author's machine; no optimization without measurements (M3 rule).

Exit criteria: alpha user completes 2 weeks with zero data-loss bugs; docs reflect reality. Non-goal: onboarding polish beyond what the alpha demands.

## Phase D — Beta readiness decision (Mar 2027)

- D1. Go/no-go on a small paid beta (5–10 users): installer reliability, support load estimate, pricing hypothesis. Default answer is **no-go with reasons** — overdelivery means a beta that works, not a beta that exists.
- D2. If go: pricing page, license key mechanism, beta agreement. If no-go: written list of what would change the answer.
- D3. macOS spike (time-boxed, 1 week): assess Tauri build viability. Verdict only, no commitment.

## Explicit non-goals (6 months)

Cloud execution, team workspaces, SSH/remote shells, splits, replay, swarms, auto-merge, visual redesign, Linux distro matrix, macOS support promises.

## Checkpoint cadence

End of each month: 30-minute review — which exit criteria passed, what slipped, what gets cut. Slips extend dates; dates never compress scope. This file is updated at each checkpoint, never rewritten to look better.
