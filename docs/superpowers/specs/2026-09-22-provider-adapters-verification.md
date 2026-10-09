# Provider adapter verification

Date: 2026-09-22. Implementation complete; authenticated Claude live execution is skipped by explicit user request; the user has no Claude Code account.

## Acceptance evidence

| Requirement | Evidence |
| --- | --- |
| PA-01 | Provider selector and persisted run provider implemented. Browser retained existing OpenCode output and displayed two Codex attempts with provider labels. |
| PA-02 | Tests cover literal argv, native discovery, missing installation, ready/signed-out/timeout probes and sanitized bounded probe results. Shared spawning ignores stdin and disables shell execution. Browser shows Claude sign-in guidance and prevents launching while signed out. |
| PA-03 | Parser tests cover provider messages, tools, unknown events, native identity, terminal errors and Claude permission denials. Lifecycle test preserves failure despite exit zero. Live Codex messages and raw output persisted and restored after browser reload. |
| PA-04 | Automated tests prevent cross-provider continuation. Two live Codex attempts have distinct Saber run IDs and the same native session ID, with the expected initial and follow-up responses. |
| PA-05 | Browser verified provider selection, readiness, provider-labelled history and provider-switch explanation. Existing checkout exclusion and interrupted-run tests pass. |
| PA-06 | Argument tests verify workspace-write and noninteractive approval refusal for Codex, and absence of permission bypass flags. Claude denied-tool events are surfaced by parser tests. |

## Live Codex smoke

Task: `d39f630d-7b7d-4542-bf47-8fcd0839d400` (Codex adapter smoke test).

- Initial run: `fd8c5904-e1fb-4b40-be8a-c3360ec884eb`; response `SABER_CODEX_OK`; exit 0; 17 persisted events.
- Follow-up: `029b5e85-0893-4ba3-88f6-25d5e320cb3b`; response `SABER_CODEX_FOLLOWUP_OK`; exit 0; 16 persisted events.
- Both native session IDs: `01a0c960-cc66-71a2-afe2-5795a2d7f7aa`.
- Both display Ready for review. Browser reload restored the follow-up output and history.
- Temporary project directory remained empty, including hidden entries.
- Installed Codex emitted diagnostics about local skill metadata, unsupported shell snapshots and an unauthenticated optional MCP server. These did not prevent either response; diagnostics remain available in raw output.

## Checks and limitations

`bun run test`: 26 tests across 6 files passed on 2026-09-22. `bun x tsc --noEmit` passed. Production build passed on 2026-09-21; only test coverage and documentation were added afterward. Dev was restarted on port 8082 before browser verification.

Independent adapter review found no blocking issues. Its readiness coverage gaps were addressed with tests for discovery and authentication probe outcomes.

Claude reports signed out. Its argv, event normalization, denial handling, readiness and lifecycle are tested; real authenticated launch/resume is unverified and intentionally skipped by user request. Windows shim-only installations are unsupported. No isolated workspaces or interactive permission bridge are included in this slice.

## Phase A item A3 (2026-10-09)

A3 (authenticated Claude smoke) is formally blocked: no Claude Code account exists in this environment, unchanged since 2026-09-22. No authenticated Claude launch was attempted or fabricated. Adapter contract coverage (argv, event normalization, denial handling, readiness signed-out unavailability) plus the explicit signed-out UI gate stand as the evidence. Per the roadmap this block does not hold Phase B.

