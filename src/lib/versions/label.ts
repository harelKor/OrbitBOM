import type { VersionRef } from "@/db/schema";

// The Onshape version a site version comes from ("V70"; more than one inserted document gives
// "V70, V12"), or null when nothing in it is inserted by version.
export function onshapeName(ref: VersionRef | null | undefined, side: "sources" | "from" = "sources"): string | null {
  return Object.values(ref?.[side] ?? {}).map((s) => s.name).join(", ") || null;
}

// What a version is called on the site: its Onshape version, else its number.
export function versionLabel(v: { seq: number | null; onshapeRef: VersionRef | null }): string {
  return onshapeName(v.onshapeRef) ?? `#${v.seq ?? 0}`;
}
