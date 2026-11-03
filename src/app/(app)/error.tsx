"use client";

import { useEffect } from "react";

// A page that failed to load (a database hiccup, a dropped connection on the shop Wi-Fi) shows
// this inside the app's frame, with the menus still there, instead of Next's bare error page.
export default function PageError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="display text-2xl text-accent">This page didn&apos;t load</h1>
      <p className="mt-2 text-sm text-muted">Something went wrong on the way. Your saved work is safe; try again, or open another page from the menu.</p>
      <button type="button" onClick={() => retry()} className="btn mt-6 min-h-11 px-6 font-semibold active:scale-[0.98]">
        Try again
      </button>
    </div>
  );
}
