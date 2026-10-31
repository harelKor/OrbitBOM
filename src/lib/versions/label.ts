import type { VersionRef } from "@/db/schema";

type DocVersion = NonNullable<VersionRef["sources"]>[string];

// The one Onshape document a site version is named after: the document most of the BOM's parts
// come from (detect.ts marks it `main`), never the COTS and library documents inserted beside it,
// so the name is "V82" instead of every inserted document's version joined together. When the main
// document is followed in a workspace, no Onshape version names it. Versions read before the mark
// take the system's own document, else the first one.
export function primaryVersion(ref: VersionRef | null | undefined, side: "sources" | "from" = "sources"): [string, DocVersion] | null {
  const docs = Object.entries(ref?.[side] ?? {});
  const main = docs.find(([, v]) => v.main);
  if (main || docs.some(([, v]) => v.parts !== undefined)) return main ?? null;
  return docs.find(([did]) => did === ref!.did) ?? docs[0] ?? null;
}

// The Onshape version a site version comes from ("V70"), or null when nothing in it is inserted
// by version.
export function onshapeName(ref: VersionRef | null | undefined, side: "sources" | "from" = "sources"): string | null {
  return primaryVersion(ref, side)?.[1].name || null;
}

// What a version is called on the site: its Onshape version, else its number.
export function versionLabel(v: { seq: number | null; onshapeRef: VersionRef | null }): string {
  return onshapeName(v.onshapeRef) ?? `#${v.seq ?? 0}`;
}
