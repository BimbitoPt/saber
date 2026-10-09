# Onyx consumer slice (Phase B3) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At every run spawn, Saber queries the live Onyx `GET /context/query` endpoint, injects the top cited hits into the submitted prompt as "project context (cited)", and records a Saber-computed `contextSha` immutably on the run. Onyx unreachable means proceed-with-notice, never block (both roadmaps: Onyx never blocks Saber). No Onyx changes are required: `contextSha` is computed Saber-side (SHA-256 over the canonical query+response), Day-1 auth is only the `x-tenant-id` header, and the response shape is normalized defensively because Onyx item 1.3 (snake_case hardening) is not done — live hits use camelCase plus an extra `note` field.

**Architecture:** New pure client module `src/server/onyxContext.ts` (config from env, bounded fetch with injectable `fetchFn`, tolerant hit normalization, canonical sha via existing `hashContent`). `AgentRuns.start` becomes async: locks first (fail fast), then one Onyx query, then the existing `assembleScope`+`createRun` path with the Onyx section as one more budget-counted scope part. Team launch resolves Onyx once and fans the reference out to member starts (no per-member re-query). `RunRecord`/`RunContextCapture` gain optional `onyxContextSha`, `onyxProvenance`, `onyxNotice`; `createRun` passes them through (JSON blob, no migration). Overlap safety is unchanged: parallel starts that interleave on the Onyx await still collide in `createRun`'s store-level workspace check.

**Tech Stack:** Bun, TypeScript, TanStack Start, SQLite through `node:sqlite`, Vitest, global `fetch` (Node 20+/Bun), existing provider adapters and Git worktree service.

## Global Constraints

- Use Bun only for package management and scripts.
- Port 8082 strict-port dev; browser verification uses the production server build; Playwright drivers run under system Node, not Bun.
- Onyx addressing (`ONYX_BASE_URL` default `http://127.0.0.1:8083`, `ONYX_TENANT_ID` default `default`, `ONYX_DISABLED=1` escape hatch) lives in environment only — never persisted in tasks, runs, profiles, or teams.
- Onyx timeout 8000ms, no retries: fail fast to the explicit notice path.
- Query text is deterministic and bounded: task title plus first 500 chars of spec; hit limit 3.
- Preserve provider-independent task IDs, immutable run scope, single-run default, one-worktree-per-task model, and the read-only API contract.
- No automatic merge/commit/verify from Onyx content; Onyx hits are cited context, not instructions.
- Do not edit `src/routeTree.gen.*` or `src-tauri/gen/**` by hand. No Tauri runtime changes: MSI/NSIS not rebuilt.
- A successful process exit is ready for review, not verified.

---

## File map

- `src/server/onyxContext.ts` (new): config, query builder, fetch+normalize+sha, prompt formatter.
- `src/server/onyxContext.test.ts` (new): fixture-fetch unit tests (success, non-200, timeout, malformed, empty hits, both key casings, sha stability, disabled flag).
- `src/lib/tasks.ts`: optional `onyxContextSha`, `onyxProvenance`, `onyxNotice` on `RunRecord` and `RunContextCapture`.
- `src/server/taskStore.ts`: `createRun` passes the three fields through.
- `src/server/agentRuns.ts`: async `start`, `assembleScope` accepts the resolved Onyx reference, Onyx scope part + capture.
- `src/server/specialistTeams.ts`: async `launchTeam`, single Onyx resolution fanned out to member starts.
- `src/server.ts`: `await` the three `start` call sites.
- `src/server/agentRuns.test.ts`, `src/server/gitWorkspaces.test.ts`, `src/server/specialistTeams.test.ts`: migrate to async (`await`, `rejects`), add Onyx launch tests.
- `docs/superpowers/specs/2026-10-09-onyx-consumer-slice.md`: fill answered questions, mark approved, record completion evidence.

## Task 1: Onyx client module with contract tests (ONX-01, ONX-03)

**Files:** `src/server/onyxContext.ts`, `src/server/onyxContext.test.ts`.

- [ ] `resolveOnyxConfig(env = process.env)`: `{ baseUrl, tenantId, disabled }`; trim trailing `/`; `disabled` when `ONYX_DISABLED=1` or base URL empty.
- [ ] `buildOnyxQuery(task)`: `${task.title}\n${task.spec.slice(0, 500)}`, limit 3.
- [ ] `queryOnyxContext(task, overrides?, fetchFn = fetch)`: `GET {baseUrl}/context/query?q=&limit=3` with `x-tenant-id`, `AbortSignal.timeout(8000)`; success → `{ ok: true, sha, hits, query }`; non-200/timeout/network/malformed → `{ ok: false, notice }` naming the cause; disabled → `{ ok: false, notice: "Onyx disabled by configuration" }`.
- [ ] `normalizeOnyxHits(json)`: accept `sourcePath`/`source_path`, `heading`, `excerpt`, `mtime`, `score` (+`note` tolerated, never required); drop malformed entries; cap excerpt at 2000 chars for budget safety.
- [ ] `shaOnyxReference(tenantId, query, hits)`: `hashContent` over canonical JSON of the normalized subset only (never URLs, tokens, or timestamps of the query itself beyond hit mtimes).
- [ ] `formatOnyxSection(sha, hits)`: `"Project context from Onyx (cited, <sha8>):\n[1] <excerpt> (<note> — <heading>)\n…"`.
- [ ] Unit tests with fixture `fetchFn`: success shape, snake_case variant, non-200, timeout (abort), invalid JSON, missing `hits`, empty hits (ok with no section), sha stability across key order/casing, disabled flag. No live server required.
- [ ] Run focused tests plus `bunx tsc --noEmit`.

## Task 2: Immutable capture fields (ONX-02)

**Files:** `src/lib/tasks.ts`, `src/server/taskStore.ts`.

- [ ] Add optional `onyxContextSha?: string`, `onyxProvenance?: "onyx" | "unavailable"`, `onyxNotice?: string` to `RunRecord` and `RunContextCapture`.
- [ ] `createRun` passes the three fields from capture into the stored run (same explicit-field style as the slice-1 fields).
- [ ] No migration: JSON blob additive fields; absence reads as pre-Onyx run.
- [ ] Test: createRun round-trips the fields; reopened store preserves them byte-identically.
- [ ] Run focused tests plus `bunx tsc --noEmit`.

## Task 3: Async spawn with Onyx section (ONX-01, ONX-02)

**Files:** `src/server/agentRuns.ts`, `src/server/specialistTeams.ts`, `src/server.ts`.

- [ ] `start` becomes `async start(...): Promise<string>`; order: task → workdir → existing lock checks → provider/role → `queryOnyxContext` → `assembleScope(..., onyx)` → `createRun` → spawn (unchanged).
- [ ] `assembleScope` accepts optional resolved Onyx reference: ok with hits → extra scope part named `project context from Onyx (cited, <sha8>)` (budget-counted like every part, largest-source naming intact); ok with zero hits → provenance `onyx`, sha recorded, no prompt part; unavailable → provenance `unavailable`, `onyxNotice`, no prompt part. Existing `contextNotice` semantics untouched.
- [ ] `StartOptions` gains optional pre-resolved `onyx` (used by team launch; when absent, `start` queries).
- [ ] `launchTeam` becomes async: resolve Onyx once after validation/reservation, pass the reference into each member `start` (sequential awaits keep partial-failure visibility).
- [ ] `src/server.ts`: `await` the three `start` call sites (handlers are already async).
- [ ] Preview stays sync/local-only: Onyx resolves at launch and is auditable on the run record. Record as accepted limitation in the spec.
- [ ] Run focused suites plus `bunx tsc --noEmit`.

## Task 4: Test migration and launch coverage (ONX-01–ONX-03)

**Files:** `src/server/agentRuns.test.ts`, `src/server/gitWorkspaces.test.ts`, `src/server/specialistTeams.test.ts`.

- [ ] Migrate existing `start`/`launchTeam` calls to `await`; `expect(() => …).toThrow` on launches → `await expect(…).rejects.toThrow`.
- [ ] New tests (fixture `fetchFn` or injected resolver, `ONYX_DISABLED=1` where isolation matters): sha recorded + cited section in `run.task` on success; unavailable (refused/timeout) launches with notice and no sha; disabled flag skips fetch; oversized-budget error still names the largest source when the Onyx part tips it over; team launch queries once and all members share the sha; restart persistence of the three fields; stored run JSON contains no base URL or credential material.
- [ ] Live integration test (guarded by env, skipped when Onyx is down): `queryOnyxContext` against `http://127.0.0.1:8083` returns ok with real hits — proves the contract without spawning a provider.
- [ ] Run the three suites plus `bunx tsc --noEmit`.

## Task 5: Full verification and Windows demo receipt (ONX-04, plus slice gate)

**Files:** spec doc only.

- [ ] Run `bun run test` by itself; expected: all files pass (rerun uncontended on timeout flakes).
- [ ] Run `bun run test:terminal`, `bunx tsc --noEmit`, `bun run build`, `cargo test`, `git diff --check`; expected: all succeed.
- [ ] Demo against the production server build with isolated `SABER_DATA_DIR` and live Onyx: create task, launch one real bounded run, verify `onyxContextSha` on the run, the cited section in the submitted prompt, the offline-fallback notice path (stop Onyx, relaunch), and restart/A-B-A integrity of the recorded fields.
- [ ] Record completion evidence against ONX-01–ONX-04 in the spec; list remaining gaps. A successful build or agent exit is not completion evidence by itself.

## Plan self-review

- ONX-01 maps to Tasks 1, 3, 4; ONX-02 to Tasks 2–4; ONX-03 to Tasks 1, 4; ONX-04 to Task 5.
- No Onyx-side changes: Onyx rule 3 ("Onyx never blocks Saber") and "no speculative API surface" both hold.
- Failure posture matches PAC-04 honesty: explicit notice, never silent omission, never blocked launch.
- Overlap atomicity preserved via the store-level `createRun` workspace check after the Onyx await.
- No TODO/TBD placeholders. Live Onyx at `127.0.0.1:8083` verified reachable with cited hits during planning (PID 20192).
