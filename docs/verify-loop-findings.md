# V1 loop findings — first dogfood

Date: 2026-09-18 (late-night session, tasks 1-7)

## What worked

- End-to-end loop verified: ADE spawned opencode on mstudio-ade with a file-creation
  task; agent completed, self-verified, session status flipped to `done`; marker file
  correct (content + trailing newline).
- Dev-server registry: Clipflow started on inventory port 8081, health probe flipped
  `starting` -> `up`, stop endpoint cleaned it up.
- Browser pane: headless chromium navigated to 8081 and screenshotted (32 KB PNG).
- Long-poll events: ring buffer + `?after=n` + `wait=1` works; zero missed events.

## Pitfalls hit (do not regress)

- opencode spawn: MUST use `stdio: ["ignore", "pipe", "pipe"]` — an open piped stdin
  blocks `opencode run` forever with zero output.
- h3 swallows SSR throws into 500 JSON `{"unhandled":true,"message":"HTTPError"}` —
  use `src/lib/error-capture.ts` + server.ts normalization to recover real stacks.
- src/router.tsx must export `getRouter()` factory (start-server-core calls
  `entries.routerEntry.getRouter()`); a plain `export const router` breaks every SSR
  request with a 500.
- TanStack Start 1.168 needs: vite 8 + @vitejs/plugin-react ^5 + `nitro/vite` plugin
  (order: tailwind, tanstackStart, viteReact, nitro) + `src/server.ts` custom entry.
- Kill stale listeners by PORT, not by process name (vite runs under node.exe).
- PowerShell JSON bodies via curl need a temp file; inline escaping mangles quotes.
