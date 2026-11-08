"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// Draws its children only while near the screen. Browsers allow a dozen or so live 3D views at
// once (phones fewer), so CAD Review's boxes start their 3D view when scrolled to and drop it when
// far away (plan/design-review.md).
export function LazyMount({ children, className, placeholder }: { children: ReactNode; className?: string; placeholder?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { rootMargin: "300px 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className={className}>
      {near ? children : placeholder}
    </div>
  );
}
