"use client";

import Link from "next/link";
import { useEffect } from "react";
import { OrbitFrame } from "@/components/shell/OrbitFrame";
import "./globals.css";

// The root layout itself failed: Next renders this in place of the whole document, so it brings its
// own <html>, styles and theme (it follows the device's light or dark).
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col font-sans antialiased">
        <title>OrbitParts</title>
        <OrbitFrame title="OrbitParts didn't load" text="Something went wrong on the way. Your saved work is safe; try again in a moment.">
          <button type="button" onClick={() => retry()} className="btn-primary min-h-11 px-6 active:scale-[0.98]">
            Try again
          </button>
          <Link href="/" className="btn min-h-11 px-6 active:scale-[0.98]">
            Home
          </Link>
        </OrbitFrame>
      </body>
    </html>
  );
}
