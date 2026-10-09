# Onyx consumer slice (Phase B3)

## Status and authorization

**Status:** Draft pending user review, 2026-10-09. A4 (PAC spec review) completed the same day, unblocking this slice. No code has been written; implementation requires review of this written spec and a separate implementation plan.

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

## Open questions for the reviewer

1. Onyx base URL and auth: where does the server live, and what auth (if any) does `GET /context/query` require?
2. Exact response schema: is `contextSha` a top-level field, and what query parameters does the endpoint expect (canonical project root, something else)?
3. Offline behavior: confirm the proposed proceed-with-notice fallback, or should Onyx failure block launch instead?
4. Onyx M5 alignment: is there an external Onyx milestone/spec to version-lock against?

## Completion evidence

None yet — implementation is intentionally not started pending review.
