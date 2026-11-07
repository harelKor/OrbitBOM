import type { MetadataRoute } from "next";

// Added to a phone's home screen, the app opens full screen (no address bar or status bar), or on
// its own without the address bar where full screen isn't offered. Installed on a PC, its blue bars
// take the window's title bar row, with only the window's buttons over them (Harel, 2026-11-07);
// phones don't offer that and skip to full screen.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OrbitParts",
    short_name: "OrbitParts",
    description: "Team 1690 bill of materials, inventory and Onshape integration",
    start_url: "/",
    scope: "/",
    display: "fullscreen",
    display_override: ["window-controls-overlay", "fullscreen", "standalone"],
    background_color: "#f2f2f2",
    theme_color: "#0000cc",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
    // Long-press the installed app's icon (Android) for these (Harel, 2026-11-06). Robot pages go
    // through /go/<page>, which opens them for the robot last used.
    shortcuts: [
      { name: "Shop Fab", url: "/go/fab", icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "3D Printing", url: "/go/printing", icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "Order List", short_name: "Order List", url: "/cots/order-list", icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "Inventory", url: "/inventory", icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }] },
    ],
  };
}
