# Provider diagnostic presentation

Status: Authorized by the user's report of misleading provider errors on 2026-09-22.

## Scope

Correct output presentation without changing provider configuration or run lifecycle. Codex stderr includes warnings and optional integration failures even when the task succeeds. Do not alter the user's global skills or MCP authentication.

## Acceptance criteria

- PD-01: Existing persisted provider_error records appear in a collapsed Provider diagnostics section, with their complete stored text and no added error prefix. Agent responses stay visible in the main stream.
- PD-02: Run failures and normalized terminal failure messages remain visible. A stderr diagnostic alone never changes run status.
- PD-03: Raw output remains inspectable. Existing persisted history receives the presentation fix without migration.

## Implementation and verification

Introduce a diagnostic display kind for legacy stderr records and render these in a separate disclosure. Leave normalized terminal failures and lifecycle logic unchanged. Run tests and typecheck, restart dev on 8082, then inspect the existing Codex follow-up: response visible, diagnostics collapsed, full stored diagnostic text available when expanded.

## Completion evidence

PD-01/03: Legacy provider_error records render as full stored diagnostics in a collapsed disclosure; raw output is unchanged. Browser confirmed `SABER_CODEX_FOLLOWUP_OK` remains visible and “Provider diagnostics (10)” expands to the complete stored output. PD-02: Lifecycle and terminal-failure rendering are unchanged. All 26 tests and TypeScript check passed on 2026-09-22. Dev restarted successfully on port 8082.
