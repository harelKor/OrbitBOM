"use client";

import { CheckBadge } from "./CheckBadge";
import { Icon } from "./Icon";

// One row of a page's List view (made for phones): a square picture, the name, a muted detail
// line, and small pills. A tap opens the thing's window; while the page is selecting,
// a tap selects the row instead. With an `href` (the product's page) the name is a link that opens
// it in a new tab, like a card's name; the rest of the row still opens the window.
export function ListRow({
  picture,
  dimPicture = false,
  placeholder,
  title,
  href,
  detail,
  pills,
  actions,
  onOpen,
  selected,
  onToggleSelect,
  style,
  className = "",
  ...rest
}: {
  picture: string | null;
  dimPicture?: boolean; // a stand-in picture (the category's), shown fainter
  placeholder?: React.ReactNode;
  title: React.ReactNode;
  href?: string | null;
  detail?: React.ReactNode;
  pills?: React.ReactNode;
  actions?: React.ReactNode; // small buttons at the row's right end; they stop the click themselves
  onOpen: () => void;
  selected?: boolean;
  onToggleSelect?: () => void;
  style?: React.CSSProperties;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "title" | "onClick">) {
  const act = onToggleSelect ?? onOpen;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={act}
      onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && act()}
      aria-pressed={onToggleSelect ? !!selected : undefined}
      style={style}
      className={`flex min-w-0 cursor-pointer items-center gap-3.5 rounded-2xl border border-line bg-surface/90 py-3 pr-3 pl-3.5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] transition-all duration-150 hover:border-sky-400/40 active:not-[:has(:is(button,a,input,select,textarea,[role=dialog]):active)]:scale-[0.99] active:not-[:has(:is(button,a,input,select,textarea,[role=dialog]):active)]:bg-raised ${
        selected ? "ring-2 ring-sky-400" : ""
      } ${className}`}
      {...rest}
    >
      <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white">
        {picture ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links, not optimisable
          <img src={picture} alt="" loading="lazy" className={`h-full w-full object-contain p-1 ${dimPicture ? "opacity-60" : ""}`} />
        ) : (
          (placeholder ?? <Icon name="box" className="h-6 w-6 text-slate-400" />)
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        {href && !onToggleSelect ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            className="self-start max-w-full truncate text-base font-bold text-sky-500 underline-offset-2 hover:underline dark:text-sky-400"
          >
            {title}
          </a>
        ) : (
          <span className="truncate text-base font-bold text-fg">{title}</span>
        )}
        {detail && <span className="truncate text-xs text-muted">{detail}</span>}
        {pills && <span className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">{pills}</span>}
      </span>
      {actions && !onToggleSelect && <span className="flex shrink-0 items-center gap-1">{actions}</span>}
      {onToggleSelect && <CheckBadge checked={!!selected} />}
    </div>
  );
}

// A small pill inside a list row.
export function ListPill({ children, color, title }: { children: React.ReactNode; color?: string; title?: string }) {
  return (
    <span title={title} className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full border border-line-strong bg-ink/60 px-2.5 py-0.5 text-[11px] font-medium text-fg-2">
      {color && <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />}
      {children}
    </span>
  );
}
