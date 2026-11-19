// "Open in Onshape" for one part at a fixed state (Harel, 2026-11-19): from the BOM, the version
// the BOM is linked to; from the CAD page, the version being viewed. Built from what's stored,
// never from an Onshape call. Onshape's URLs can't pick a part, so it opens the part's Part Studio
// tab at that state, or, when that state isn't known for the Part Studio's document, the system's
// assembly at it.

// The system's assembly (Final, or Basepart on the CAD page's Basepart model).
export type AsmLink = { base: string; did: string; eid: string | null };
export type StateRef = { wvm: "v" | "m"; wvmid: string };

export type PartAt = {
  asm: AsmLink;
  at: StateRef | null; // the assembly document's state
  docs?: Record<string, { versionId: string }>; // other documents' versions, as a BOM version keeps them
};

// A part's Part Studio from its 3D model key "<did>:<eid>:<partId>" (copy suffixes after it).
export function sourceOfKey(key: string): { did: string; eid: string } | null {
  const [did, eid] = key.split(":");
  return did && eid ? { did, eid } : null;
}

export function partOnshapeUrl(src: { did: string; eid: string } | null, { asm, at, docs }: PartAt): string | null {
  const page = (did: string, wvm: string, id: string, eid: string) => `${asm.base}/documents/${did}/${wvm}/${id}/e/${eid}`;
  if (src) {
    const v = docs?.[src.did]?.versionId;
    if (v) return page(src.did, "v", v, src.eid);
    if (at && src.did === asm.did) return page(src.did, at.wvm, at.wvmid, src.eid);
  }
  return at && asm.eid ? page(asm.did, at.wvm, at.wvmid, asm.eid) : null;
}

// The 3D menu's item (a page's own item, ContextMenu's MenuItem): the part in a new tab.
export const openInOnshape = (url: string) => ({ label: "Open in Onshape", run: () => void window.open(url, "_blank", "noopener,noreferrer") });
