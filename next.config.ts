import type { NextConfig } from "next";

// Every page is behind sign-in and shows live data, so the app renders on each request and
// does not use Cache Components.
const nextConfig: NextConfig = {
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
