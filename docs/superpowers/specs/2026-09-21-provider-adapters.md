# Codex and Claude Code provider adapters

Status: Approved through the user instruction to add the next provider slice.

## Scope

Extend the existing task/run workflow with provider selection, native executable discovery, bounded authentication probes, provider-specific continuation, and normalized output. Keep the stack, SQLite records, checkout exclusion, restart reconciliation, and review status semantics.

## Acceptance criteria

- PA-01: Select OpenCode, Codex, or Claude Code for a new run. Persist the selected provider; old OpenCode records remain readable.
- PA-02: Each adapter uses argv spawning with ignored stdin and no shell. Discover native executables from known locations and PATH. Report missing installation and signed-out authentication with setup instructions. Never return credentials or account identifiers from probes. Timeouts are unknown readiness, not signed out.
- PA-03: Preserve raw provider events alongside normalized messages, tool activity, diagnostics, native session identity, and terminal failures. Failed result events cannot become ready for review merely because the process exits zero.
- PA-04: Follow-ups resume only the latest native session of the selected provider within the same task. A provider change starts a fresh run with the saved spec and checkpoint; it never transfers hidden native state.
- PA-05: Display provider labels in run history, current selection, and model guidance. Keep checkout locks and interrupted ownership across providers.
- PA-06: Respect provider authentication and permissions; never add approval/sandbox bypass flags. Codex runs use workspace-write sandbox and noninteractive approval refusal; Claude uses configured permissions and exposes denied-tool results.

## CLI evidence and verification

Inspected installed codex exec --help, codex exec resume --help, codex login status, claude --help, and claude auth status. Codex is signed in; Claude reports loggedIn false. Codex JSON mode and native resume are also documented at https://learn.chatgpt.com/docs/non-interactive-mode. Claude installed help establishes print, verbose, stream-json, model, and resume flags.

Validate argv, parsers, error transitions, and provider-isolated continuation with Vitest. Run TypeScript and build checks, restart dev on 8082, inspect provider choices and readiness in the browser. Use only a read-only temporary task for a live Codex smoke run; Claude authenticated live execution is contingent on user sign-in, never fabricated. Reuse existing OpenCode smoke evidence and regression tests.

## Exclusions

No login UI, credential storage, permission dialog proxy, provider session migration, worktrees, or model catalog. Unknown provider events remain available in raw output. Provider-specific event formats may evolve; retain raw data for diagnosis.
