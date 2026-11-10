"use client";

import { useState } from "react";
import { placeKey, subColor, type Place } from "@/lib/assembly/groups";
import type { Book } from "@/lib/assembly/view";
import { Progress } from "./Progress";

// The branches (Harel, 2026-11-10): the robot, its systems down a line, and each system's
// sub-assemblies branching off it, like a version tree. Where you are is marked; a tap on any
// row goes there. The open system's sub-assemblies are unfolded, the others fold.
export function Branches({ book, robotName, at, onOpen }: { book: Book; robotName: string; at: Place; onOpen: (p: Place | null) => void }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set([at.systemId]));
  const toggle = (id: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const here = placeKey(at);
  return (
    <section>
      <h2 className="label mb-2">Branches</h2>
      <button onClick={() => onOpen(null)} className="press flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm font-semibold text-fg-2 hover:bg-raised hover:text-fg pointer-coarse:min-h-10">
        <span className="h-3.5 w-3.5 rounded-full border-2 border-line-strong bg-surface" />
        {robotName}
        <span className="text-xs font-normal text-subtle">· whole robot</span>
      </button>
      <ol className="relative ml-[13px] border-l-2 border-line">
        {book.systems.map((s) => {
          const sysPlace = { systemId: s.id, sub: null };
          const isHere = here === placeKey(sysPlace);
          const inside = at.systemId === s.id;
          const listed = orderedSubs(book, s.id);
          const unfolded = open.has(s.id) || inside;
          return (
            <li key={s.id} className="relative pt-1.5 pl-4">
              {/* the branch off the trunk */}
              <span className="absolute top-[19px] left-0 h-0.5 w-3 bg-line" />
              <Row here={isHere} trail={inside && !isHere} onClick={() => onOpen(sysPlace)}>
                <span className="min-w-0 flex-1 truncate font-semibold">{s.name}</span>
                <Progress {...book.progress(sysPlace)} />
              </Row>
              {listed.length > 0 && (
                <>
                  {!inside && (
                    <button onClick={() => toggle(s.id)} className="press ml-1.5 text-[11px] text-subtle hover:text-fg pointer-coarse:min-h-8" aria-expanded={unfolded}>
                      {unfolded ? "▾" : "▸"} {listed.length} sub-assembl{listed.length === 1 ? "y" : "ies"}
                    </button>
                  )}
                  {unfolded && (
                    <ol className="relative mt-0.5 ml-[9px] border-l-2 border-line">
                      {listed.map((x) => {
                        const p = { systemId: s.id, sub: x.code };
                        return (
                          <li key={x.code} className="relative pt-1 pl-4">
                            <span className="absolute top-[17px] left-0 h-0.5 w-3 bg-line" />
                            <Row here={here === placeKey(p)} dot={subColor(x.code)} onClick={() => onOpen(p)}>
                              <span className="min-w-0 flex-1 truncate">{x.name}</span>
                              <Progress {...book.progress(p)} />
                            </Row>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// A system's sub-assemblies in the order its steps place them, then the ones not placed yet.
function orderedSubs(book: Book, systemId: string) {
  const sys = book.systems.find((s) => s.id === systemId);
  if (!sys) return [];
  const order = book.steps({ systemId, sub: null }).flatMap((st) => (st.kind === "sub" && st.subRef ? [st.subRef] : []));
  const rank = (code: string) => (order.includes(code) ? order.indexOf(code) : order.length);
  return [...sys.subs].sort((a, b) => rank(a.code) - rank(b.code) || a.code.localeCompare(b.code));
}

function Row({ here, trail = false, dot, onClick, children }: { here: boolean; trail?: boolean; dot?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-current={here ? "location" : undefined}
      className={`press relative flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm pointer-coarse:min-h-10 ${
        here ? "bg-accent/15 text-fg ring-2 ring-accent" : trail ? "text-fg hover:bg-raised" : "text-fg-2 hover:bg-raised hover:text-fg"
      }`}
    >
      <span
        className={`h-3 w-3 shrink-0 rounded-full border-2 ${here ? "border-accent bg-accent" : trail ? "border-accent bg-surface" : "border-line-strong bg-surface"}`}
        style={dot && !here ? { background: dot, borderColor: dot } : undefined}
      />
      {children}
      {here && <span className="shrink-0 text-[11px] font-bold text-accent">you</span>}
    </button>
  );
}
