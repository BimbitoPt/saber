# Provider adapters implementation plan

Goal: run all three providers through persistent Saber tasks.

Architecture: shared provider IDs and normalized event types; native executable/status helpers; adapters define argv; the run service owns common lifecycle and parses provider events; UI exposes readiness and selection.

Constraints: Bun only, port 8082 strict, preserve existing changes, no generated file edits, ignored stdin, no new code comments.

- [x] Add provider IDs, native executable/status discovery, Codex and Claude argv adapters, and event parsing. Test argv boundaries, missing tools, all event shapes and terminal errors (PA-01/02/03/06).
- [x] Route selected provider through API, run storage and run service. Filter continuation by provider, preserve raw data and failure states; regression-test cross-provider history and checkout exclusion (PA-01/03/04).
- [x] Add provider choice, readiness refresh and setup messages to task detail, render normalized output and provider-labelled history (PA-02/05).
- [x] Run tests, typecheck and build; restart dev and verify browser/provider lifecycle. Record real Codex smoke results and Claude authentication limitation. Update repository guidance (PA-01 through PA-06).


Evidence: docs/superpowers/specs/2026-09-22-provider-adapters-verification.md. Authenticated Claude smoke is skipped by explicit user request (no Claude Code account).

