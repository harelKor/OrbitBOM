import type { NextConfig } from "next";

// Every page is behind sign-in and shows live data, so the app renders on each request and
// does not use Cache Components.
const nextConfig: NextConfig = {
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
