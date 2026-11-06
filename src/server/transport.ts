const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function isLoopback(hostname: string): boolean {
  return loopbackHosts.has(hostname.toLowerCase());
}

export function validateLoopbackTransport(request: Request): boolean {
  const url = new URL(request.url);
  const hostHeader = request.headers.get("host");
  if (!isLoopback(url.hostname) || !hostHeader) return false;
  let hostUrl: URL;
  try { hostUrl = new URL(`${url.protocol}//${hostHeader}`); } catch { return false; }
  if (!isLoopback(hostUrl.hostname) || hostUrl.host.toLowerCase() !== url.host.toLowerCase()) return false;
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (!isLoopback(originUrl.hostname) || originUrl.origin !== url.origin) return false;
    } catch { return false; }
  }
  return true;
}

export function remoteApiAllowed(): boolean {
  return process.env["SABER_ALLOW_REMOTE_API"] === "1";
}
