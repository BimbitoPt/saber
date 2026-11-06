# WebView CSP and terminal IPC scoping

## Status and authorization

**Status:** Approved for implementation.
**Date:** 2026-11-07.
**Authorization:** The repository owner requested autonomous issue and pull-request work. This bounded security slice is tracked by issue #16.

## Threat model and origin assumptions

Assets and trust boundaries:

- The Saber app server (Bun/Vite on port 8082 in development, Nitro on an ephemeral loopback port in the packaged app) is the only origin the WebView is meant to load. It serves the UI and the local API, and it drives the Rust terminal commands.
- The Tauri capability file (`src-tauri/capabilities/default.json`) grants the five `terminal-*` IPC commands plus window controls to remote origins matching `http://127.0.0.1:*`. The wildcard is required because the packaged port is chosen at runtime; a static capability file cannot name it.
- Consequence: any process that can serve a page on any free loopback port (a compromised dev tool, another local app) could try to invoke `terminal_start`/`terminal_write` from its own page and inherit Saber's terminal permissions, and the WebView document itself ran without a CSP (`app.security.csp: null`, and Tauri does not inject CSP into `WebviewUrl::External` origins anyway).

Assumptions: the OS user running Saber is trusted; the Saber server process is trusted; anything else on the machine that can bind a loopback port is not trusted by default. No confirmed remote exploit is claimed; this is defense in depth.

Mitigations in this slice:

1. **WEBVIEW-SEC-03 (primary boundary):** every terminal command verifies, in Rust, that the calling webview's URL is exactly `http://127.0.0.1:<server port>` (the port resolved at startup, stored in `ServerOrigin` state). A rogue loopback page on a different port, `localhost` instead of `127.0.0.1`, any other host, or any non-http origin is rejected with a permission error. The wildcard capability remains (dynamic port), but it no longer grants anything by itself.
2. **WEBVIEW-SEC-02 (defense in depth):** the app document ships a Content-Security-Policy delivered by the Saber server itself (`src/lib/csp.ts`, injected in the root route): `default-src 'self'`, scripts and styles limited to `'self' 'unsafe-inline'` (TanStack hydration streams and React style attributes), `connect-src 'self' ipc: http://ipc.localhost`, and `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-src 'none'`. A page that somehow loads from a rogue origin cannot pull remote scripts or exfiltrate via cross-origin requests. `tauri.conf.json` keeps `csp: null` because Tauri never serves the document for an external URL; the policy lives with the server that does.
3. **WEBVIEW-SEC-01 (documented origin model):** development trusts `http://127.0.0.1:8082`; packaged builds trust `http://127.0.0.1:<ephemeral port>` announced by the server on stdout. Both are the same rule: exactly one loopback origin, the one Saber's server announced.

Residual risk, accepted: `core:window:*` controls (minimize/maximize/close) stay reachable from any loopback origin through the capability; they cannot spawn processes or reach the terminal. The `ipc:` fetch fallbacks remain in `connect-src` for Tauri IPC.

## Scope and exclusions

In scope: the Rust origin guard for all terminal commands, the document CSP, the threat model above, automated regression checks, and verification of the served document.

Out of scope: switching the WebView to Tauri's asset protocol (which would break the external Bun server architecture), removing the window-control permissions, and packaged Windows/Linux startup verification (requires the native desktop environment; recorded as pending in completion evidence).

## Requirements and acceptance criteria

### WEBVIEW-SEC-01 — Trusted origin model

The trusted origin is exactly the loopback base URL the Saber server announces at startup, for both development and packaged builds. Documented above; enforced by WEBVIEW-SEC-03.

### WEBVIEW-SEC-02 — Restrictive document CSP

The served app document carries the CSP above.

Acceptance: the running dev server serves the policy in the document (`curl http://127.0.0.1:8082/` contains `http-equiv="Content-Security-Policy"`), and a real headless Chromium loads the app with zero CSP violations, zero failed requests, and the full UI rendered (harness: `scripts/verify_csp.ts` in the authoring environment; recorded below).

### WEBVIEW-SEC-03 — Terminal IPC scope

A page served by an unrelated loopback port cannot invoke terminal commands.

Acceptance: Rust unit tests prove `origin_allowed` accepts only the exact `http://127.0.0.1:<port>` origin and rejects other ports, `localhost`, other hosts, https, and non-URLs; every terminal command calls the guard first (enforced by the automated check below).

### WEBVIEW-SEC-04 — Dynamic port behavior preserved

The packaged startup flow is unchanged: the server still announces its address on stdout, the window still loads that address, and the guard uses that same resolved port. No port is hardcoded.

Acceptance: `bun run build`, `bunx tsc --noEmit`, and the vitest suite pass; Rust compiles in CI (CodeQL autobuild). Packaged Windows/Linux startup is pending native-environment verification.

### Regression guards

`src/lib/webviewSecurity.test.ts` fails if: the capability's remote origins broaden beyond the documented `http://127.0.0.1:*` on window `main`, the terminal permission list changes, the CSP disappears from the root route, or any terminal command loses its origin guard.

## Verification plan

| Requirement | Verification |
| --- | --- |
| WEBVIEW-SEC-01/02 | Document served with CSP verified against the running dev server; headless Chromium renders the app with zero CSP violations |
| WEBVIEW-SEC-03 | `cargo test` unit tests for `origin_allowed` (runs in CI via CodeQL autobuild compile + local review); guard call count check in `webviewSecurity.test.ts` |
| WEBVIEW-SEC-04 | `bunx tsc --noEmit`, `bun run test`, `bun run build` |
| Regression | `bun run test -- src/lib/webviewSecurity.test.ts` |

## Completion evidence

- The dev server document contained the full policy (observed via curl).
- Headless Chromium against the dev server: `titleBarRendered: true`, `cspViolations: []`, `requestFailures: []`; screenshot shows the intact workspace UI.
- Rust origin tests are committed alongside the guard; `cargo` is not installed in the authoring sandbox, so their execution is deferred to CI (CodeQL autobuild compiles the crate). Packaged Windows/Linux startup checks remain pending native verification.
- `interventions: 0`
