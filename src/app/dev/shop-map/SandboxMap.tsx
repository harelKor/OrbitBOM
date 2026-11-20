"use client";

import { useMemo, useState } from "react";
import { ShopMap } from "@/components/map/ShopMap";
import { placeStats } from "@/components/map/stats";
import type { Place } from "@/lib/inventory/places";
import { MapSettings } from "@/components/settings/MapSettings";
import { LocationPicker, PlaceTag } from "@/components/inventory/LocationPicker";

// A drawer cabinet and a shelving unit drawn as SVG, standing in for the team's pictures.
function cabinet(): string {
  const drawers: string[] = [];
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 5; r++) {
      const x = 170 + c * 175;
      const y = 150 + r * 92;
      drawers.push(`<rect x="${x}" y="${y}" width="160" height="80" rx="8" fill="${["#F59E0B", "#38BDF8", "#A78BFA", "#34D399"][c]}" stroke="#1E293B" stroke-width="5"/><rect x="${x + 55}" y="${y + 32}" width="50" height="12" rx="6" fill="#1E293B"/>`);
    }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="750" viewBox="0 0 1200 750"><rect width="1200" height="750" fill="#FDE7C7"/><rect y="640" width="1200" height="110" fill="#C08457"/><rect x="140" y="120" width="740" height="510" rx="14" fill="#475569" stroke="#1E293B" stroke-width="8"/>${drawers.join("")}<rect x="920" y="300" width="200" height="340" rx="10" fill="#64748B" stroke="#1E293B" stroke-width="6"/><circle cx="1020" cy="250" r="40" fill="#FBBF24" stroke="#1E293B" stroke-width="6"/></svg>`;
}
function shelves(): string {
  const boxes: string[] = [];
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 6; c++) boxes.push(`<rect x="${110 + c * 170}" y="${120 + r * 140}" width="${120 + ((c * 7 + r) % 3) * 15}" height="90" rx="6" fill="${["#F472B6", "#60A5FA", "#A3E635", "#FB923C"][(r + c) % 4]}" stroke="#0F172A" stroke-width="5"/>`);
  const boards = [0, 1, 2, 3].map((r) => `<rect x="80" y="${212 + r * 140}" width="1040" height="18" fill="#92400E" stroke="#0F172A" stroke-width="5"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="750" viewBox="0 0 1200 750"><rect width="1200" height="750" fill="#DBEAFE"/><rect y="680" width="1200" height="70" fill="#94A3B8"/>${boxes.join("")}${boards}<rect x="70" y="90" width="20" height="600" fill="#0F172A"/><rect x="1110" y="90" width="20" height="600" fill="#0F172A"/></svg>`;
}
// A 360° room (3:1, its left edge meets its right): four walls in turn, a drawer cabinet on one.
function room(): string {
  const walls = ["#FDE7C7", "#DBEAFE", "#DCFCE7", "#FCE7F3"].map((c, i) => `<rect x="${i * 600}" y="0" width="600" height="800" fill="${c}"/><rect x="${i * 600}" y="0" width="6" height="800" fill="#1E293B"/><text x="${i * 600 + 300}" y="200" font-size="90" font-family="sans-serif" text-anchor="middle" fill="#1E293B">${["N", "E", "S", "W"][i]}</text>`).join("");
  const drawers = Array.from({ length: 6 }, (_, i) => `<rect x="${700 + (i % 3) * 140}" y="${380 + Math.floor(i / 3) * 110}" width="120" height="90" rx="8" fill="#38BDF8" stroke="#1E293B" stroke-width="5"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="800" viewBox="0 0 2400 800">${walls}<rect y="640" width="2400" height="160" fill="#94A3B8"/><rect y="0" width="2400" height="70" fill="#E2E8F0"/>${drawers}</svg>`;
}
const url = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

const zone = (id: string, outline: [number, number][], color: string, extra: Partial<Place> = {}): Place => ({ id, name: `Zone ${id}`, outline, color, facing: 0, ...extra });
const spot = (id: string, parentId: string, x: number, y: number, kind: Place["kind"] = "drawer", size?: [number, number]): Place => ({ id, name: `${parentId} · ${kind} ${id}`, parentId, spotX: x, spotY: y, spotW: size?.[0], spotH: size?.[1], kind });

export function SandboxMap() {
  const places = useMemo<Place[]>(() => {
    const cab = url(cabinet());
    const shelf = url(shelves());
    const ps: Place[] = [
      zone("A", [[270, 290], [400, 290], [400, 325], [270, 325]], "#38BDF8", { imageUrl: cab, imageW: 1200, imageH: 750, facing: 180 }),
      zone("B", [[215, 82], [340, 72], [345, 112], [222, 118]], "#F472B6", { imageUrl: shelf, imageW: 1200, imageH: 750 }),
      zone("C", [[210, 175], [255, 195], [245, 230], [205, 212]], "#A3E635"),
      zone("D", [[640, 420], [720, 380], [770, 460], [690, 505]], "#FBBF24", { imageUrl: shelf, imageW: 1200, imageH: 750, facing: 30 }),
      zone("E", [[500, 330], [560, 330], [560, 370], [500, 370]], "#A78BFA", { imageUrl: url(room()), imageW: 2400, imageH: 800 }),
    ];
    for (let i = 0; i < 6; i++) ps.push(spot(`E${i}`, "E", (760 + (i % 3) * 140) / 2400, (425 + Math.floor(i / 3) * 110) / 800, "drawer", [120 / 2400, 90 / 800]));
    for (let c = 0; c < 4; c++) for (let r = 0; r < 5; r++) ps.push(spot(`A${c}${r}`, "A", (250 + c * 175) / 1200, (190 + r * 92) / 750, "drawer", [150 / 1200, 72 / 750]));
    for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c += 2) ps.push(spot(`B${r}${c}`, "B", (175 + c * 170) / 1200, (165 + r * 140) / 750, "shelf"));
    ps.push(spot("D1", "D", 0.3, 0.3, "bin"), spot("D2", "D", 0.7, 0.5, "bin"));
    return ps;
  }, []);
  const cats = ["bearings", "gears", "pulleys", "fasteners", "motors", "sensors", "wheels", "belts", "shafts", "chain", "hubs-adapters", "rivets"].map((c) => ({ id: c, label: c, imageUrl: `/categories/${c}.png` }));
  const items = useMemo(() => {
    const spots = places.filter((p) => p.parentId);
    return Array.from({ length: 140 }, (_, i) => ({ id: `i${i}`, name: `Item ${i}`, category: cats[(i * 7) % cats.length].id, place: i % 9 === 0 ? "C" : spots[(i * 5) % spots.length].id, short: i % 17 === 0 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fixed sample data
  }, [places]);
  const stats = useMemo(() => placeStats(items, places, cats), [items, places]); // eslint-disable-line react-hooks/exhaustive-deps
  const [mode, setMode] = useState<"browse" | "pick">("browse");
  const [find, setFind] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <div className="mx-auto w-full max-w-6xl min-w-0 space-y-3 p-4">
      <h1 className="text-xl font-semibold">Shop map sandbox</h1>
      <div className="flex flex-wrap gap-2 text-sm">
        <button className="btn" onClick={() => setMode(mode === "browse" ? "pick" : "browse")}>Mode: {mode}</button>
        {["A13", "B20", "C", "D2", "A", "E4"].map((id) => (
          <button key={id} className="btn" onClick={() => { setFind(id); setKey((k) => k + 1); }}>Find {id}</button>
        ))}
        <span className="self-center">Picked: {picked ?? "–"}</span>
      </div>
      <ShopMap places={places} stats={stats} mode={mode} find={find} findKey={key} selectedId={picked} onPick={setPicked} onFilter={(id) => setPicked(`filter ${id}`)} onTapEmpty={() => setPicked("tapped the floor")} className="h-[70vh] w-full" />
      <h2 className="pt-6 text-lg font-semibold">Picker</h2>
      <LocationPicker locations={places} value={picked} onChange={setPicked} stats={stats}>
        <PlaceTag place={places.find((p) => p.id === picked)} places={places} />
      </LocationPicker>
      <h2 className="pt-6 text-lg font-semibold">Settings → Map (saving needs a database)</h2>
      <MapSettings places={places} systems={[{ id: "s1", name: "Intake", robot: "2026", drawers: { "Ready for QA": "A13" } }]} />
    </div>
  );
}
