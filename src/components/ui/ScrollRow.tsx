"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

// A sideways-scrolling row that shows there's more: the page fades over whichever edge has
// columns past it, and a round arrow on the right scrolls one screen on (audit, 2026-11-20:
// the Assembly page's last column looked cut off).
export function ScrollRow({ className, children }: { className: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      const left = el.scrollLeft > 4;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
      setMore((m) => (m.left === left && m.right === right ? m : { left, right }));
    };
    check();
    el.addEventListener("scroll", check, { passive: true });
    const seen = new ResizeObserver(check);
    seen.observe(el);
    for (const c of el.children) seen.observe(c);
    return () => {
      el.removeEventListener("scroll", check);
      seen.disconnect();
    };
  }, [children]);
  return (
    <div className="relative">
      <div ref={ref} className={className}>
        {children}
      </div>
      {more.left && <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-ink to-transparent" />}
      {more.right && (
        <>
          <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-ink to-transparent" />
          <button
            type="button"
            aria-label="Scroll right"
            onClick={() => ref.current?.scrollBy({ left: ref.current.clientWidth * 0.8, behavior: "smooth" })}
            className="press absolute top-1/2 right-1 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-line-strong bg-surface/90 text-fg shadow-md backdrop-blur-md hover:border-accent active:scale-[0.98]"
          >
            <Icon name="chevron" className="h-4 w-4" />
          </button>
        </>
      )}
    </div>
  );
}
