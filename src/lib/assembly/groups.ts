// Sub-assemblies for the Assembly page come from the part number, not from Onshape (Harel,
// 2026-11-10): in 1690-26-421-01 the third segment is the system (4xx), sub-assembly 1 (x2x) and
// sub-assembly 2 (xx1). Parts group by system + the first two digits ("42"). A tens digit of 0
// ("401") is a part straight in the system; sub-assembly 2 is ignored; a part with no code (most
// COTS hardware) is in no sub-assembly.
import { extractPartCodes } from "@/lib/drawing/drawingMatch";

// "42" for 1690-26-421-01, null for 401-03, a code-less name, or a code without a third segment.
export function subCodeOf(...names: (string | null | undefined)[]): string | null {
  for (const name of names) {
    if (!name) continue;
    for (const code of extractPartCodes(name)) {
      const seg = code.split("-")[2];
      if (!seg || !/^\d{3}$/.test(seg)) continue;
      return seg[1] === "0" ? null : seg.slice(0, 2);
    }
  }
  return null;
}

// What a sub-assembly is called until CAD names it.
export const defaultSubName = (code: string) => `Sub-assembly ${code}0`;

// A stable colour per code (the same sub-assembly is always the same colour, Harel 2026-11-10):
// hues spread by the golden angle, so neighbours (42, 43) look clearly different.
export function subColor(code: string): string {
  const n = Number(code) || [...code].reduce((a, c) => a * 31 + c.charCodeAt(0), 0);
  const hue = (n * 137.508) % 360;
  return hslHex(hue, 0.68, 0.56);
}

function hslHex(h: number, s: number, l: number) {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("")}`;
}

// The place a step list belongs to: a system's own column, or one sub-assembly in it.
export type Place = { systemId: string; sub: string | null };
export const placeKey = (p: Place) => (p.sub ? `${p.systemId}:${p.sub}` : p.systemId);
export function parsePlace(at: string | null | undefined): Place | null {
  const m = at?.match(/^([0-9a-f-]{36})(?::(\d{2}))?$/i);
  return m ? { systemId: m[1].toLowerCase(), sub: m[2] ?? null } : null;
}
