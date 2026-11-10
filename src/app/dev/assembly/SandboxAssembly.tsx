"use client";

import { useEffect, useState } from "react";
import { Assembly } from "@/app/(app)/robots/[robotId]/assembly/Assembly";
import type { ViewerModel } from "@/components/dashboard/ModelCanvas";
import type { AssemblyData, AssemblyPart, AssemblyStep } from "@/lib/data/assembly";

const ROBOT = "00000000-0000-4000-8000-000000000000";
const sysId = (g: number) => `00000000-0000-4000-8000-00000000000${g + 1}`;

// Made-up parts, sub-assemblies and steps over the sandbox robot: each system's parts get part
// numbers by name, so some fall in two sub-assemblies and some sit straight in the system.
function fake(model: ViewerModel, names: Record<string, string>): AssemblyData {
  const systems = (model.groups ?? []).map((g, i) => ({ id: sysId(i), name: g.name }));
  const seen = new Map<string, AssemblyPart>();
  for (const p of model.placements) {
    const g = p.g ?? 0;
    const name = names[p.k] ?? "Part";
    const subDigit = /standoff|gusset/i.test(name) ? 2 : /tube|rail/i.test(name) ? 1 : 0;
    const old = seen.get(p.k);
    if (old) old.qty++;
    else seen.set(p.k, { key: p.k, id: p.k, systemId: sysId(g), name, number: `1690-26-${g + 1}${subDigit}1-0${(seen.size % 9) + 1}`, qty: 1, sub: subDigit ? `${g + 1}${subDigit}` : null, cots: false, thumbUrl: null });
  }
  // COTS hardware with no 3D placement, as hand-added COTS cards are.
  systems.forEach((s, g) =>
    ["#10-32 x 0.5 in SHCS", "#10-32 Nylock nut", "1/2 in hex bearing"].forEach((name, i) =>
      seen.set(`id:cots-${g}-${i}`, { key: `id:cots-${g}-${i}`, id: `cots-${g}-${i}`, systemId: s.id, name, number: null, qty: 16, sub: null, cots: true, thumbUrl: null }),
    ),
  );
  const parts = [...seen.values()];
  const step = (o: Partial<AssemblyStep>): AssemblyStep => ({
    id: crypto.randomUUID(),
    systemId: sysId(0),
    subCode: null,
    position: 0,
    kind: "step",
    subRef: null,
    title: "",
    body: "",
    critical: false,
    partKeys: [],
    stepRefs: [],
    camera: null,
    imageKey: null,
    imageUrl: null,
    tick: null,
    ...o,
  });
  const of = (g: number, sub: string | null) => parts.filter((p) => p.systemId === sysId(g) && p.sub === sub).map((p) => p.key);
  const steps: AssemblyStep[] = [];
  systems.forEach((s, g) => {
    const loose = of(g, null);
    steps.push(step({ systemId: s.id, position: 0, title: "Lay out the base parts", body: "Put the loose parts on the bench in this orientation.", partKeys: loose, tick: g === 0 ? { by: "Noa", at: new Date().toISOString() } : null }));
    steps.push(step({ systemId: s.id, position: 1, kind: "sub", subRef: `${g + 1}1`, title: "" }));
    steps.push(step({ systemId: s.id, position: 2, kind: "sub", subRef: `${g + 1}2`, title: "", critical: g === 1 }));
    const a = of(g, `${g + 1}1`);
    const first = step({ systemId: s.id, subCode: `${g + 1}1`, position: 0, title: "First tubes", body: "Square them up before tightening.", partKeys: a.slice(0, 1), tick: { by: "Ido", at: new Date().toISOString() } });
    steps.push(first);
    steps.push(step({ systemId: s.id, subCode: `${g + 1}1`, position: 1, title: "The rest of the tubes", body: "Torque to 4 N·m, blue Loctite.", critical: true, partKeys: a.slice(1) }));
    steps.push(step({ systemId: s.id, subCode: `${g + 1}1`, position: 2, title: "Check square", body: "Measure both diagonals; they must match within 1 mm.", partKeys: [], stepRefs: [first.id] }));
  });
  return { systems, parts, subNames: { [`${sysId(0)}:11`]: "Frame box" }, steps };
}

export function SandboxAssembly() {
  const [data, setData] = useState<AssemblyData | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/dev/viewer")
      .then((r) => r.json())
      .then((d: { model: ViewerModel; names: Record<string, string> }) => !cancelled && setData(fake(d.model, d.names)));
    return () => {
      cancelled = true;
    };
  }, []);
  if (!data) return <p className="p-6 text-sm text-muted">Loading the sandbox…</p>;
  return <Assembly robotId={ROBOT} robotName="Sandbox bot" data={data} builtAt="sandbox" canEdit canTick modelUrl="/api/dev/viewer" />;
}
