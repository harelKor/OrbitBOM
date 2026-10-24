// A Part Studio reference that never changes: a workspace Part Studio is pinned to the
// document microversion given for its document (`docMvs`), so a version's 3D preview shows
// the part as it was then. Versions and microversions are frozen already.
export function frozenStudio(
  p: { sourceDid: string | null; sourceWid: string | null; sourceWvm: string | null; sourceEid: string | null },
  docMvs: Record<string, string | null | undefined>,
): string | null {
  const wvm = p.sourceWvm?.[0]?.toLowerCase();
  if (!p.sourceDid || !p.sourceWid || !p.sourceEid || !wvm || !"wvm".includes(wvm)) return null;
  const mv = wvm === "w" ? docMvs[p.sourceDid] : null;
  return mv ? `d/${p.sourceDid}/m/${mv}/e/${p.sourceEid}` : `d/${p.sourceDid}/${wvm}/${p.sourceWid}/e/${p.sourceEid}`;
}
