import type { Metadata } from "next";
import { Geist_Mono, Jost } from "next/font/google";
import "./globals.css";

// Jost is a Futura-style geometric face, close to the type on 1690orbit.com.
const jost = Jost({
  variable: "--font-jost",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "OrbitBOM",
  description: "Team 1690 bill of materials, inventory and Onshape integration",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${jost.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
