import type { NextConfig } from "next";

// Every page is behind sign-in and shows live data, so the app renders on each request and
// does not use Cache Components.
const nextConfig: NextConfig = {
  // Our own server (deploy/): GitHub Actions builds a self-contained server.js bundle and the
  // small VM only runs it (Harel, 2026-11-07). The only next/image pictures are the two logos,
  // so they're served as-is: no sharp binary to match the server's CPU, no resizing work there.
  output: "standalone",
  // Each build names itself by its commit (set on GitHub Actions), so a page from before a deploy
  // reloads on its next navigation instead of calling server actions the new build renamed
  // (Harel, 2026-11-07: part windows stopped opening after deploys). Unset locally.
  deploymentId: process.env.GITHUB_SHA || undefined,
  images: { unoptimized: true },
  experimental: {
    // Keep pages the browser already loaded for 30 seconds, so going back to a system, robot or
    // To Fab you just saw is instant instead of a new server render. Saving anything (server
    // actions revalidate) and switching View/Edit (router.refresh) clear it, so your own changes
    // always show; someone else's change can take up to 30 s to appear on a page you revisit.
    // Pages prefetched in full on hover (Link unstable_dynamicOnHover) are kept the same 30 s.
    staleTimes: { dynamic: 30, static: 30 },
  },
  // The panel inside Onshape (cad.onshape.com or the team's Enterprise domain) frames only the
  // panel's own pages (/onshape/*); the rest of the site can't be framed by another site, so it
  // can't be clicked through from inside a frame. The later rule wins for /onshape.
  // The site is HTTPS only (Caddy), so browsers are told to never try plain HTTP. The camera stays
  // allowed on our own pages (Inventory's Scan); microphone, location and payment are never used.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
        ],
      },
      {
        source: "/onshape/:path*",
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
