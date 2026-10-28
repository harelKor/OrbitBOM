import type { MetadataRoute } from "next";

// Added to a phone's home screen, the app opens full screen (no address bar or status bar), or on
// its own without the address bar where full screen isn't offered.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OrbitParts",
    short_name: "OrbitParts",
    description: "Team 1690 bill of materials, inventory and Onshape integration",
    start_url: "/",
    scope: "/",
    display: "fullscreen",
    display_override: ["fullscreen", "standalone"],
    background_color: "#f2f2f2",
    theme_color: "#0000cc",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
