"use client";

import Link from "next/link";
import { useEffect } from "react";
import { OrbitFrame } from "@/components/shell/OrbitFrame";

// The app's own frame failed (its layout's reads, the sign-in check): the menus can't show, so
// this page has its own way back. Errors inside a page show (app)/error.tsx, with the menus.
export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <OrbitFrame title="OrbitParts didn't load" text="Something went wrong on the way. Your saved work is safe; try again in a moment.">
      <button type="button" onClick={() => retry()} className="btn-primary min-h-11 px-6 active:scale-[0.98]">
        Try again
      </button>
      <Link href="/" className="btn min-h-11 px-6 active:scale-[0.98]">
        Home
      </Link>
    </OrbitFrame>
  );
}
