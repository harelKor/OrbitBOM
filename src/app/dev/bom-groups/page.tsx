"use client";

import { useState } from "react";
import { GroupCards } from "@/components/bom/GroupCards";
import type { CardPart } from "@/components/bom/types";
import { findGroup, groupParts, type GroupItem } from "@/lib/parts/bomGroups";

// The system page's group cards on made-up parts, since local dev has no R2 pictures.
// Development only (the page 404s in production builds through the check below).
const pic = (n: string) => `/categories/${n}.png`;
const ITEMS: GroupItem[] = [
  { id: "al3", name: "Aluminum 3mm", category: "aluminum-plates", raw: true, specs: { thickness: "3" } },
  { id: "al4", name: "Aluminum 4mm", category: "aluminum-plates", raw: true, specs: { thickness: "4" } },
  { id: "al6", name: "Aluminum 6mm", category: "aluminum-plates", raw: true, specs: { thickness: "6" } },
  { id: "pc2", name: "Polycarbonate 2mm", category: "polycarbonate", raw: true, specs: { thickness: "2" } },
  { id: "hex", name: '1/2" Hex', category: "shafts", raw: true, specs: {} },
  { id: "box", name: "Box 1x2", category: "square-tubes", raw: true, specs: {} },
];
let n = 0;
const part = (over: Partial<CardPart>, thumb: string | null): CardPart =>
  ({ id: `p${n++}`, classification: "inhouse", material: null, quantity: 2, process1: null, addedProcesses: [], displayName: null, onshapeName: null, inventoryItemId: null, thumbUrl: thumb ? pic(thumb) : null, ...over }) as CardPart;
const PARTS: CardPart[] = [
  ...["M5x10 SHCS", "M5x20 BHCS", "M4x8 BHCS", "#10-32 x 1/2\" BHCS", "M5 nylock nut", "M3x6 SHCS", "M4 washer", "Pop rivet", "M4x12 FHCS"].map((d, i) =>
    part({ classification: "cots", displayName: d, quantity: 8 }, ["fasteners", "rivets", "fasteners", null][i % 4]),
  ),
  part({ classification: "cots", displayName: "Bearing 8mm" }, "bearings"),
  part({ classification: "cots", displayName: "Bearing 1/2 hex flanged" }, "bearings"),
  part({ classification: "cots", displayName: "HTD belt 5mm" }, "belts"),
  part({ classification: "cots", displayName: "Kraken X60" }, "motors"),
  part({ process1: "3d-bambu" }, "filament"),
  part({ process1: "3d-bambu" }, null),
  part({ material: '1/2" Hex', inventoryItemId: "hex" }, "shafts"),
  part({ material: "Box 1x2", inventoryItemId: "box" }, "square-tubes"),
  ...["al3", "al4", "al4", "al6", "pc2"].map((id) => part({ inventoryItemId: id }, id === "pc2" ? "polycarbonate" : "aluminum-plates")),
  part({ classification: "undefined" }, null),
];

export default function DevBomGroups() {
  const [picked, setPicked] = useState<string | null>(null);
  if (process.env.NODE_ENV === "production") return null;
  const groups = groupParts(PARTS, ITEMS);
  const shown = picked ? (findGroup(groups, picked)?.parts ?? []) : PARTS;
  return (
    <main className="min-h-screen space-y-4 bg-ink p-4 md:p-6">
      <GroupCards groups={groups} picked={picked} onPick={setPicked} />
      <ul className="text-sm text-fg-2">
        {shown.map((p) => (
          <li key={p.id}>{p.displayName ?? p.material ?? p.inventoryItemId ?? p.process1 ?? "—"}</li>
        ))}
      </ul>
    </main>
  );
}
