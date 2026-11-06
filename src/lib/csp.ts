/**
 * Content-Security-Policy for the Saber document, served by the Saber app
 * server itself (dev: Vite on the fixed port, packaged: Nitro on the ephemeral
 * port). Tauri does not inject CSP into external URLs, so the app server owns
 * the policy.
 *
 * - 'unsafe-inline' scripts: TanStack Start streams hydration instructions as
 *   inline scripts (and Vite dev adds its reload client).
 * - 'unsafe-inline' styles: React inline style attributes.
 * - ipc: / http://ipc.localhost: Tauri IPC fetch fallbacks.
 * - Everything else falls back to default-src 'self': all API calls, screenshots
 *   and assets are same-origin.
 */
export const WEBVIEW_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' ipc: http://ipc.localhost",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-src 'none'",
].join("; ");
