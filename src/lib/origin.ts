import type { NextRequest } from "next/server";

// The address members reached the site at, for absolute links and OAuth redirects. Behind Caddy
// on our own server `next start` only knows it listens on localhost, so request.nextUrl.origin
// says https://localhost:3000; the proxy's Host / X-Forwarded-* headers carry the real one
// (Caddy overwrites any a visitor sends).
export function publicOrigin(request: NextRequest): string {
  const h = request.headers;
  const host = h.get("x-forwarded-host")?.split(",")[0].trim() || h.get("host");
  if (!host) return request.nextUrl.origin;
  const proto = h.get("x-forwarded-proto")?.split(",")[0].trim() || request.nextUrl.protocol.replace(/:$/, "");
  return `${proto}://${host}`;
}
