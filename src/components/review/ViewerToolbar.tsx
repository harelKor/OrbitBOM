"use client";

import { useEffect, useState } from "react";
import type { HiddenParts, SceneTools, ViewName } from "@/components/dashboard/ModelCanvas";
import { MAX_PLANES, type Axis, type CutPlane, type SectionParts, type SectionView } from "@/components/viewer/section";

// The other views moved to the view cube, top right (S1, plan/cad-3d-viewer.md); Fit stays here,
// a big target on phones.
const VIEWS: { v: ViewName | "fit"; label: string }[] = [{ v: "fit", label: "Fit" }];
const tool = "press inline-flex h-8 items-center justify-center rounded-md px-2 text-xs font-semibold text-fg-2 hover:bg-raised hover:text-fg active:scale-[0.98] pointer-coarse:h-9 pointer-coarse:min-w-9";
const on = "bg-accent/15 text-accent-hover";
const box = "rounded-md border border-line bg-surface/95 shadow-sm backdrop-blur";


// CAD's tools on the 3D view: standard views and fit, and the section (up to 3 planes). (Picking points, edges
// and faces to measure is always on: ReviewScreen shows the results.) Wide screens
// show them at the bottom left; phones fold them into a Tools button on the left, under Versions
// (Harel, 2026-11-09). Parts hidden with Y or Hide are listed below, folded behind a "Hidden" button.
export function ViewerToolbar({
  tools,
  children,
  hidden,
}: {
  tools: SceneTools | null;
  children?: React.ReactNode; // the colour toggle, above the tools
  hidden?: HiddenParts | null;
}) {
  const [section, setSection] = useState<SectionView | null>(null);
  const [open, setOpen] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  // The section lives in the viewer (its 3D handle and S3's "Section here" change it too); this
  // shows it and edits it.
  useEffect(() => tools?.onSection(setSection), [tools]);
  const toggleSection = () => (section ? tools?.section(null) : tools?.sectionPlane("x"));
  const folded = open ? "" : "max-lg:hidden";
  return (
    <div className="absolute left-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-col items-start gap-2 max-lg:top-16 max-lg:max-h-[calc(100%-9rem)] max-lg:overflow-y-auto lg:bottom-3" onClick={(e) => e.stopPropagation()}>
      <button className={`${box} ${tool} h-10 px-3 text-sm lg:hidden ${open ? on : ""}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        Tools {open ? "▴" : "▾"}
      </button>
      <div className={`flex flex-col items-start gap-2 ${folded}`}>{children}</div>
      {section && tools && <SectionPanel section={section} tools={tools} className={`${box} ${folded}`} />}
      {tools && (
        <div className={`flex flex-wrap items-center gap-0.5 p-1 ${box} ${folded}`}>
          {VIEWS.map(({ v, label }) => (
            <button key={v} className={tool} onClick={() => tools.view(v)}>
              {label}
            </button>
          ))}
          <span className="mx-0.5 h-5 w-px bg-line" />
          <button className={`${tool} ${section ? on : ""}`} aria-pressed={!!section} onClick={toggleSection}>
            Section
          </button>
        </div>
      )}
      {hidden && (
        <div className={`flex w-48 flex-col overflow-hidden text-xs ${box}`}>
          <div className="flex items-center gap-2 px-1 py-0.5">
            <button className={`${tool} flex-1 justify-start tabular-nums`} aria-expanded={showHidden} onClick={() => setShowHidden(!showHidden)}>
              Hidden · {hidden.items.length} {showHidden ? "▴" : "▾"}
            </button>
            <button className={`${tool} text-accent-hover`} onClick={() => hidden.show(null)}>
              Show all
            </button>
          </div>
          {showHidden && (
            <ul className="max-h-48 overflow-y-auto border-t border-line p-1">
              {hidden.items.map((g) => (
                <li key={g.id}>
                  <button onClick={() => hidden.show(g.id)} title="Show it again" className="press block w-full truncate rounded px-2 py-1.5 text-left text-fg-2 hover:bg-raised hover:text-fg pointer-coarse:min-h-9">
                    {g.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// The section's rows, one per plane (up to 3, each cuts), like Onshape's section view: the plane
// across X / Y / Z through the model centre or on the newest picked flat face, its offset in mm (a
// number and a slider: the main way on phones), Flip, the tilt from the 3D rings, and which parts
// are cut. The row with the accent bar carries the 3D handle; a touch on a row moves it there.
const PARTS: { v: SectionParts; label: string; title: string }[] = [
  { v: "all", label: "All", title: "Cut every part" },
  { v: "only", label: "Picked", title: "Cut only the parts picked now" },
  { v: "except", label: "Others", title: "Cut every part but the ones picked now" },
];

function SectionPanel({ section, tools, className }: { section: SectionView; tools: SceneTools; className: string }) {
  const set = (planes: CutPlane[]) => tools.section({ planes, parts: section.parts, keys: section.keys });
  const edit = (i: number, change: Partial<CutPlane>) => set(section.planes.map((p, k) => (k === i ? { ...p, ...change } : p)));
  return (
    <div className={`flex w-[min(22rem,calc(100vw-1.5rem))] flex-col gap-1 p-1 text-xs ${className}`}>
      {section.planes.map((p, i) => {
        const [lo, hi] = section.ranges[i] ?? [-100, 100];
        const tilted = p.tilt[0] !== 0 || p.tilt[1] !== 0;
        return (
          <div
            key={i}
            onPointerDown={() => i !== section.active && tools.sectionActive(i)}
            className={`flex flex-col gap-1 rounded border-l-2 py-0.5 pl-1 ${i === section.active ? "border-accent" : "border-transparent"}`}
          >
            <div className="flex flex-wrap items-center gap-0.5">
              {(["x", "y", "z"] as Axis[]).map((a) => (
                <button key={a} className={`${tool} ${p.from === a ? on : ""} uppercase`} aria-pressed={p.from === a} onClick={() => tools.sectionPlane(a, i)} title={`Across ${a.toUpperCase()}, through the model centre`}>
                  {a}
                </button>
              ))}
              <button
                className={`${tool} ${p.from === "face" ? on : ""} disabled:opacity-40`}
                disabled={!section.face}
                onClick={() => tools.sectionPlane("face", i)}
                title={section.face ? "On the picked flat face" : "Pick a flat face first"}
              >
                Face
              </button>
              <OffsetField value={p.offset} onChange={(offset) => edit(i, { offset })} />
              <button className={`${tool} ${p.flip ? on : ""}`} aria-pressed={p.flip} onClick={() => edit(i, { flip: !p.flip })} title="Keep the other side">
                Flip
              </button>
              {section.planes.length > 1 && (
                <button className={`${tool} ml-auto`} onClick={() => set(section.planes.filter((_, k) => k !== i))} aria-label="Remove this plane" title="Remove this plane">
                  ✕
                </button>
              )}
            </div>
            <input
              type="range"
              min={Math.min(lo, p.offset)}
              max={Math.max(hi, p.offset)}
              step={0.5}
              value={p.offset}
              onChange={(e) => edit(i, { offset: Number(e.target.value) })}
              aria-label="Section offset (mm)"
              className="w-full accent-[var(--color-accent)] pointer-coarse:h-8"
            />
            {tilted && (
              <div className="flex items-center gap-1 px-1 text-muted tabular-nums">
                Tilted {p.tilt[0]}° · {p.tilt[1]}°
                <button className={`${tool} ml-auto`} onClick={() => edit(i, { tilt: [0, 0] })}>
                  Level
                </button>
              </div>
            )}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-0.5 border-t border-line pt-1">
        {section.planes.length < MAX_PLANES && (
          <button className={tool} onClick={() => tools.sectionPlane(section.face ? "face" : "z")} title={section.face ? "Add a plane on the picked face" : "Add a plane across Z"}>
            + Plane
          </button>
        )}
        <span className="ml-auto px-1 text-muted">Cut</span>
        {PARTS.map(({ v, label, title }) => (
          <button
            key={v}
            className={`${tool} ${section.parts === v ? on : ""} disabled:opacity-40`}
            aria-pressed={section.parts === v}
            disabled={v !== "all" && !section.picked && section.parts !== v}
            onClick={() => tools.sectionParts(v)}
            title={v !== "all" && !section.picked ? "Pick parts first" : title}
          >
            {label}
            {v !== "all" && section.parts === v ? ` · ${section.keys.length}` : ""}
          </button>
        ))}
      </div>
    </div>
  );
}

// The offset in mm, typed: kept as text while typing ("-", "1.") and sent when it reads as a number.
function OffsetField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  return (
    <label className="flex items-center gap-1 px-1 tabular-nums">
      <input
        type="text"
        inputMode="decimal"
        value={focused ? text : String(value)}
        onFocus={() => {
          setText(String(value));
          setFocused(true);
        }}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value.replace(",", "."));
          if (e.target.value.trim() && Number.isFinite(n)) onChange(n);
        }}
        aria-label="Section offset (mm)"
        className="h-8 w-16 rounded border border-line bg-surface px-1.5 text-right text-xs tabular-nums pointer-coarse:h-9"
      />
      <span className="text-muted">mm</span>
    </label>
  );
}
