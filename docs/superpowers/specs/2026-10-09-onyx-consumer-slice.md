# Onyx consumer slice (Phase B3)

## Status and authorization

**Status:** Approved for implementation by the user on 2026-10-09 ("lets go to phase B"). Review answers below are locked. Implementation plan: `docs/superpowers/plans/2026-10-09-onyx-consumer-slice.md`.

## Problem and user workflow

Saber keeps project knowledge locally (profiles, roles, run snapshots), while Onyx is the shared context service. Today a Saber run carries only the local profile snapshot; nothing ties it to the canonical shared context. After this slice, launching a run queries Onyx `GET /context/query` for the task's project, stores the returned `contextSha` immutably on the run, and proceeds — so a later reader can verify which shared context revision a run was launched against.

## Scope and exclusions

**In scope:**

- One Onyx read at run-spawn time: `GET /context/query` keyed by the run's canonical project root, recording `contextSha` on the run record.
- Immutable `contextSha` (and provenance: Onyx vs local-only fallback) on `RunRecord`; restart persistence through the existing JSON-blob store with no migration.
- Config-over-code Onyx addressing: base URL and any auth from environment/config, never stored in the database or run records.

**Excluded:**

- Writes to Onyx, Onyx-side profile sync, credential storage or login flows.
- Using Onyx content as run input (only the `contextSha` reference is recorded, not the payload).
- Blocking launches on Onyx availability (proposed: explicit local-only notice instead; confirm in review).
- Multi-OS claims: demo receipt is Windows only, matching the roadmap.

## Requirements and acceptance criteria

- ONX-01: Context reference at spawn. Launching any provider run queries Onyx `GET /context/query` with the run's canonical project root before the provider process starts, and stores the returned `contextSha` on the run. If Onyx is unreachable or errors, the run still launches with the local profile snapshot and an explicit immutable `contextNotice` naming the omission (PAC-04 honesty precedent); it never launches silently unreferenced and never blocks on Onyx. Verify with a fixture Onyx server (assert `contextSha` captured) and an offline fixture (assert launch proceeds with the notice and no `contextSha`).
- ONX-02: Immutable reference. Later Onyx or profile changes never mutate a prior run's `contextSha`; A-B-A and restart restore the recorded value byte-identically. Verify with two runs across a simulated Onyx revision change plus restart persistence.
- ONX-03: Secret and address hygiene. No Onyx credentials, tokens, or base URLs are persisted in tasks, runs, profiles, or teams; addressing comes from environment or local Saber config only. Verify by inspecting stored run JSON and the database for credential material against fixture secrets.
- ONX-04: Windows demo receipt. End-to-end spawn against a real or fixture Onyx endpoint on Windows, showing `contextSha` on the run, the offline fallback notice path, and restart/A-B-A integrity.

## Data and lifecycle

Additive optional fields on `RunRecord` (e.g. `contextSha`, `contextProvenance`): set once at `createRun` time, never updated. Restart reconciliation and team state derivation are unchanged; Onyx failures surface as the existing explicit-notice path, not new run states. Onyx addressing (base URL, auth) lives in environment/config, outside `tasks.sqlite`.

## Verification plan

| Requirement | Automated verification | Manual/system verification |
| --- | --- | --- |
| ONX-01 | Fixture Onyx server tests: success captures `contextSha`; refused/timed-out server launches with explicit notice and no `contextSha`. | Windows spawn against fixture endpoint; inspect stored run inputs. |
| ONX-02 | Two-run revision-change test; restart-persistence test asserting recorded values. | A-B-A in the UI with the run history visible. |
| ONX-03 | Stored-JSON/DB grep tests against fixture secrets; config-vs-DB separation test. | None beyond inspecting the demo database. |
| ONX-04 | `bun run test`, `tsc`, production build. | Windows-only demo checklist with evidence per ONX-01–ONX-03. |

## Review answers (locked 2026-10-09)

1. Onyx base URL and auth: `http://127.0.0.1:8083` with an `x-tenant-id` header (default `default`); no login. Configured via `ONYX_BASE_URL` / `ONYX_TENANT_ID` environment, never persisted. Verified live during review (200 with cited hits).
2. Response schema: `{ tenantId, query, answer, hits[{ sourcePath, note, heading, excerpt, mtime, score }], freshness }`. Onyx item 1.3 (snake_case hardening) is not done, so Saber normalizes both casings defensively and requires only heading/excerpt/score-side fields it cites.
3. Offline behavior: proceed-with-notice (both roadmaps: Onyx never blocks Saber). Recorded as `onyxProvenance: "unavailable"` plus an explicit immutable `onyxNotice`.
4. Onyx M5 alignment: Onyx Phase 3 (Feb 2027) waits on this slice; no Onyx-side changes needed (`contextSha` is computed Saber-side, so Onyx builds no speculative API surface).
5. `contextSha` provenance: SHA-256 hex over canonical JSON of `{ tenantId, query, normalized hits }`, computed Saber-side with the existing `hashContent`.

## Completion evidence (2026-10-09)

Implemented per `docs/superpowers/plans/2026-10-09-onyx-consumer-slice.md`. `AgentRuns.start` / `SpecialistTeams.launchTeam` are async; the three `server.ts` call sites await.

- ONX-01: `onyxContext.test.ts` 10/10 (live shape, snake_case variant with identical sha, malformed-drop, empty-hits ok, non-200/unreachable/timeout/invalid-JSON notices, tenant header + abort signal, excerpt cap, disabled flag, section format). Default launch path proven against a fixture HTTP server (exactly 1 request); team launch proves one query shared by all members. Live `GET /context/query` returned 200 with cited hits throughout.
- ONX-02: file-store reopen test restores the three fields byte-identically; no migration (additive JSON blob fields).
- ONX-03: stored run JSON asserted free of base URL and credential material; addressing is env-only (`ONYX_BASE_URL`, `ONYX_TENANT_ID`, `ONYX_DISABLED`).
- ONX-04: full Vitest 25 files / 155 passed + 1 skipped (live-Onyx test, run separately green 17/17 with `SABER_LIVE_ONYX=1`); `test:terminal` 2 Rust + 22 Vitest; `bunx tsc --noEmit` clean; `bun run build` green; `cargo test` 9/9; `git diff --check` clean. Production-server demo (isolated `SABER_DATA_DIR`, live Onyx on :8083, real opencode spawn then stop) DEMO GREEN 10/10: sha `f524b90d…` recorded with provenance `onyx` and cited prompt section; Onyx-down fallback recorded `unavailable` with cause notice and no sha/section; server restart preserved sha + section.

Remaining gaps and accepted limitations: pre-launch preview stays local-only (Onyx resolves at launch, auditable on the run); Onyx item 1.3 snake_case hardening still pending Onyx-side (Saber normalizes both casings); the Onyx server lifecycle is user-managed — Saber never spawns it; the demo relaunched Onyx after the fallback kill. No Tauri runtime changes: MSI/NSIS not rebuilt.
