"use client";

import { usePathname, useRouter } from "next/navigation";
import { focusPart } from "@/components/actions/focusPart";
import { Icon } from "./Icon";

// The small arrow beside a part's or item's name in its window: closes the window and takes you
// to where it lives, lit up there (Harel, 2026-11-04). A part goes to its system page, an item to
// its category's page. Already there, the page just scrolls to it.
export function GoToButton({ href, partId, label, onGo }: { href: string; partId?: string; label: string; onGo: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <button
      type="button"
      onClick={() => {
        onGo();
        const path = href.split(/[?#]/)[0];
        if (partId && path === pathname) return focusPart(partId);
        router.push(partId ? `${href}#part-${partId}` : href);
      }}
      aria-label={label}
      title={label}
      className="press inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line-strong text-muted hover:border-accent hover:text-accent active:scale-[0.98] pointer-coarse:h-9 pointer-coarse:w-9"
    >
      <Icon name="arrow" className="h-4 w-4" />
    </button>
  );
}
