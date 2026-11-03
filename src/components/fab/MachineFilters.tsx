"use client";

import { useState } from "react";
import { materialColor } from "@/config/materialColors";
import { useMaterialColors, useMaterials } from "@/components/shell/MaterialColors";
import { pushQuery } from "@/components/ui/CategoryBoxes";
import { Chevron } from "@/components/ui/Chevron";
import { Icon } from "@/components/ui/Icon";
import { ShallowLink } from "@/components/ui/FastLink";
import { NO_MATERIAL_KEY } from "./fabModel";

// To Fab's machine boxes (and the phone's Machines panel) and material filter boxes.
export function MachineBox({ href, name, count, active, className = "flex", onClick }: { href: string; name: string; count: number; active: boolean; className?: string; onClick?: () => void }) {
  return (
    <ShallowLink
      href={href}
      data-selected={active}
      onClick={onClick}
      className={`card-interactive min-w-0 flex-col px-3 py-1.5 sm:min-w-32 sm:px-4 sm:py-2.5 ${className}`}
    >
      <span className="display text-xl text-accent tabular-nums sm:text-2xl">{count}</span>
      <span className="truncate text-xs font-medium text-fg-2">{name}</span>
    </ShallowLink>
  );
}

// Phones only: the machine boxes fold behind a Machines toggle (closed by default) left of
// Materials. Closed, the machine picked sits beside it with ✕ back to All machines; open, the
// boxes take their own row under the toolbar and close again once one is picked.
export function MobileMachines({ total, machines, active, activeId, href }: {
  total: number;
  machines: { id: string; name: string; count: number }[];
  active: string | null;
  activeId: string | null;
  href: (id: string | null) => string;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`press inline-flex min-h-9 items-center gap-1 self-center rounded-full border pr-3 pl-1.5 text-xs font-semibold transition-colors duration-150 hover:border-sky-400/40 active:scale-[0.98] sm:hidden ${active ? "border-accent text-accent" : "border-line-strong text-fg-2"}`}
      >
        <Chevron open={open} small className="hover:bg-transparent" />
        Machines
        {active && <span className="ml-0.5 rounded-full bg-accent px-1.5 font-mono text-[10px] text-white tabular-nums">1</span>}
      </button>
      {!open && active && (
        <ShallowLink
          href={href(null)}
          title={`Show all machines, not just ${active}`}
          className="press inline-flex min-h-9 items-center gap-1.5 self-center rounded-full border border-accent bg-accent px-3 text-xs font-semibold text-white active:scale-[0.98] sm:hidden"
        >
          {active}
          <Icon name="close" className="h-3 w-3" />
        </ShallowLink>
      )}
      {open && (
        <div className="order-last grid basis-full grid-cols-3 gap-2 sm:hidden">
          <MachineBox href={href(null)} name="All machines" count={total} active={!activeId} onClick={close} />
          {machines.map((m) => (
            <MachineBox key={m.id} href={href(m.id)} name={m.name} count={m.count} active={activeId === m.id} onClick={close} />
          ))}
        </div>
      )}
    </>
  );
}

// The material filter, in the machine boxes' row: a Filters toggle, closed by default like the
// Inventory's. Closed, the material in use (?mat=) sits next to it with ✕ to clear it, so the
// queue never filters without showing why; open, it shows one box per material.
export function MaterialFilters({ counts, active }: { counts: Map<string, number>; active: string | null }) {
  const [open, setOpen] = useState(false);
  const colors = useMaterialColors();
  if (counts.size < 2 && !active) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`press inline-flex min-h-9 items-center gap-1 self-center rounded-full border pr-3 pl-1.5 text-xs font-semibold transition-colors duration-150 hover:border-sky-400/40 active:scale-[0.98] ${active ? "border-accent text-accent" : "border-line-strong text-fg-2"}`}
      >
        <Chevron open={open} small className="hover:bg-transparent" />
        <span className="sm:hidden">Materials</span>
        <span className="hidden sm:inline">Filters</span>
        {active && <span className="ml-0.5 rounded-full bg-accent px-1.5 font-mono text-[10px] text-white tabular-nums">1</span>}
      </button>
      {!open && active && (
        <button
          type="button"
          onClick={() => pushQuery({ mat: null })}
          title={`Remove the ${materialLabel(active)} filter`}
          className="press inline-flex min-h-9 items-center gap-1.5 self-center rounded-full border border-accent bg-accent px-3 text-xs font-semibold text-white active:scale-[0.98]"
        >
          <span className="h-3 w-3 rounded-sm border border-white/30" style={{ backgroundColor: materialColor(active === NO_MATERIAL_KEY ? null : active, colors) }} />
          {materialLabel(active)}
          <Icon name="close" className="h-3 w-3" />
        </button>
      )}
      {open && <MaterialBoxes counts={counts} active={active} />}
    </>
  );
}

export function materialLabel(m: string) {
  return m === NO_MATERIAL_KEY ? "No material" : m.replace(/-T6$/, "");
}

// One filter box per material with parts in the queue (on the machine picked); ?mat= keeps the
// pick and a second click clears it.
export function MaterialBoxes({ counts, active }: { counts: Map<string, number>; active: string | null }) {
  const colors = useMaterialColors();
  const materials = useMaterials();
  const all = materials.flatMap((g) => g.items.map((i) => i.name));
  const order = (m: string) => (m === NO_MATERIAL_KEY ? Infinity : all.indexOf(m) === -1 ? all.length : all.indexOf(m));
  const keys = [...counts.keys()].sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  return keys.map((m) => {
    const selected = active === m;
    const none = m === NO_MATERIAL_KEY;
    return (
      <button
        key={m}
        type="button"
        onClick={() => pushQuery({ mat: selected ? null : m })}
        data-selected={selected}
        aria-pressed={selected}
        className="card-interactive group flex h-12 shrink-0 items-center gap-2.5 self-center overflow-hidden pr-3 text-left active:scale-[0.98]"
      >
        <span className="relative flex h-full w-12 shrink-0 items-center justify-center bg-gradient-to-br from-sky-500/25 via-raised to-amber-400/20">
          <span
            className="h-6 w-6 rounded-md border border-white/20 shadow-sm transition-transform duration-150 group-hover:scale-[1.03]"
            style={{ backgroundColor: materialColor(none ? null : m, colors) }}
          />
        </span>
        <span className="min-w-0">
          <span className="block text-xs leading-tight font-bold whitespace-nowrap text-fg">{materialLabel(m)}</span>
          <span className="block font-mono text-[11px] text-subtle tabular-nums">{counts.get(m)}</span>
        </span>
      </button>
    );
  });
}
