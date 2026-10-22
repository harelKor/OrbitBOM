"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

type LinkProps = React.ComponentProps<typeof Link>;

// A link that loads the whole next page (its data too) as soon as the pointer shows intent: on
// hover, touch or keyboard focus. Until then only the loading skeleton is prefetched, so a sidebar
// full of links doesn't render every page. By the time the click lands the page is usually there.
export function FastLink({ onMouseEnter, onTouchStart, onFocus, ...rest }: LinkProps) {
  const [intent, setIntent] = useState(false);
  return (
    <Link
      {...rest}
      prefetch={intent ? true : null}
      onMouseEnter={(e) => {
        setIntent(true);
        onMouseEnter?.(e);
      }}
      onTouchStart={(e) => {
        setIntent(true);
        onTouchStart?.(e);
      }}
      onFocus={(e) => {
        setIntent(true);
        onFocus?.(e);
      }}
    />
  );
}

// A link that only changes the URL's query when it stays on the current page (To Fab's machine
// boxes): the page filters on the client from useSearchParams, so the click is instant and makes
// no server request. From another page it is a FastLink.
export function ShallowLink({ href, onClick, ...rest }: Omit<LinkProps, "href"> & { href: string }) {
  const pathname = usePathname();
  return (
    <FastLink
      href={href}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        if (href.split("?")[0] !== pathname) return;
        e.preventDefault();
        window.history.pushState(null, "", href);
      }}
    />
  );
}
