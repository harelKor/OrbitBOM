import type { NextConfig } from "next";

// Every page is behind sign-in and shows live data, so the app renders on each request and
// does not use Cache Components.
const nextConfig: NextConfig = {
  // Our own server (deploy/): GitHub Actions builds a self-contained server.js bundle and the
  // small VM only runs it (Harel, 2026-11-07). The only next/image pictures are the two logos,
  // so they're served as-is: no sharp binary to match the server's CPU, no resizing work there.
  output: "standalone",
  images: { unoptimized: true },
  experimental: {
    // Keep pages the browser already loaded for 30 seconds, so going back to a system, robot or
    // To Fab you just saw is instant instead of a new server render. Saving anything (server
    // actions revalidate) and switching View/Edit (router.refresh) clear it, so your own changes
    // always show; someone else's change can take up to 30 s to appear on a page you revisit.
    // Pages prefetched in full on hover (Link unstable_dynamicOnHover) are kept the same 30 s.
    staleTimes: { dynamic: 30, static: 30 },
  },
  // The panel inside Onshape (cad.onshape.com or the team's Enterprise domain) frames the app.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'self' https://*.onshape.com" }],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
