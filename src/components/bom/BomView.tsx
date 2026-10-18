"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getMachine, MACHINES } from "@/config/machines";
import { MATERIALS } from "@/config/materials";
import { STATUSES } from "@/config/statuses";
import { computeStatus } from "@/lib/status";
import { PartCard } from "./PartCard";
import { partTitle, type CardPart } from "./types";

type Chip = "all" | "cots" | "inhouse" | string; // or a machine id

// The system BOM page body (ref §3): search, filter chips, Material and Status selects, cards.
export function BomView({
  parts,
  memberNames,
  showSystem = false,
  toolbar,
}: {
  parts: CardPart[];
  memberNames: string[];
  showSystem?: boolean;
  toolbar?: React.ReactNode;
}) {
  const [q, setQ] = useState("");
  const [chip, setChip] = useState<Chip>("all");
  const [material, setMaterial] = useState("");
  const [status, setStatus] = useState("");
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        search.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return parts.filter((p) => {
      if (chip === "cots" && p.classification !== "cots") return false;
      if (chip === "inhouse" && p.classification !== "inhouse") return false;
      if (!["all", "cots", "inhouse"].includes(chip) && ![p.preProcess, p.process1, p.process2].includes(chip))
        return false;
      if (material && p.material !== material) return false;
      if (status && computeStatus(p) !== status) return false;
      if (!needle) return true;
      const haystack = [
        partTitle(p),
        p.onshapeName,
        p.material,
        p.description,
        ...[p.preProcess, p.process1, p.process2].map((m) => (m ? getMachine(m)?.name : null)),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [parts, q, chip, material, status]);

  const chips: { id: Chip; label: string }[] = [
    { id: "all", label: "All" },
    { id: "cots", label: "COTS" },
    { id: "inhouse", label: "In-house" },
    ...MACHINES.map((m) => ({ id: m.id, label: m.name })),
  ];

  return (
    <div className="space-y-4">
      <div className="panel space-y-3 p-4">
        <div className="relative">
          <input
            ref={search}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search parts by name, part number, material, process…"
            className="input pr-16"
          />
          <kbd className="absolute top-1.5 right-2 rounded border border-slate-700 px-1.5 text-[11px] text-slate-500">
            Ctrl K
          </kbd>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <button
              key={c.id}
              onClick={() => setChip(c.id)}
              className={`rounded-md border px-2.5 py-1 text-xs ${
                chip === c.id
                  ? "border-indigo-500 bg-indigo-600 text-white"
                  : "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select value={material} onChange={(e) => setMaterial(e.target.value)} className="input w-auto">
            <option value="">— All Materials —</option>
            {Object.entries(MATERIALS).map(([group, list]) => (
              <optgroup key={group} label={group}>
                {list.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="input w-auto">
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s.name}>{s.name}</option>
            ))}
          </select>
          {toolbar}
        </div>
      </div>

      <div className="text-sm text-slate-400">
        {shown.length === parts.length ? `${parts.length} parts` : `${shown.length} of ${parts.length} parts`}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {shown.map((p) => (
          <PartCard key={p.id} part={p} memberNames={memberNames} showSystem={showSystem} />
        ))}
      </div>
    </div>
  );
}
