import type { Metadata, Viewport } from "next";
import { Geist_Mono, Jost } from "next/font/google";
import { APPEARANCE_SCRIPT, SHADE_SCRIPT } from "@/components/shell/boot-scripts";
import "./globals.css";

// Jost is a Futura-style geometric face, close to the type on 1690orbit.com.
const jost = Jost({
  variable: "--font-jost",
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["400", "500", "600", "700", "800", "900"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "OrbitParts",
  applicationName: "OrbitParts",
  icons: { icon: [{ url: "/orbit-icon.png", type: "image/png" }, { url: "/favicon.ico" }], apple: "/apple-icon.png" },
  description: "Team 1690 bill of materials, inventory and Onshape integration",
  // Opened from the home screen, phones run the app without the browser's address bar.
  appleWebApp: { capable: true, title: "OrbitParts", statusBarStyle: "default" },
  other: { "mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0000cc",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${jost.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: SHADE_SCRIPT + APPEARANCE_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
