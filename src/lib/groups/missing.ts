// Part groups: members whose part left the BOM, why, and how to recover them (ref §6,
// screenshot 10). A sync keeps a removed part's row (removed_from_cad_at), so a missing member
// still points at its old row; a live row with the same name in the same system means the part
// was re-keyed in Onshape and the member can be re-linked to it.

export type MemberRow = {
  partId: string;
  name: string;
  systemId: string;
  systemName: string;
  removedFromCadAt: Date | null;
};
export type LivePart = { id: string; name: string; systemId: string };

export type MissingMember = MemberRow & {
  reason: "rekeyed" | "removed";
  liveMatches: number; // rows with this name still on the BOM
  recoverTo: string | null; // the live part to re-link to
};

export type MissingReport = {
  total: number;
  missing: MissingMember[];
  allAtOnce: boolean; // every missing member left in the same sync
  recoverable: number;
};

const norm = (s: string) => s.trim().toLowerCase();

export function analyseMissing(members: MemberRow[], live: LivePart[], memberIds: Set<string>): MissingReport {
  const missing: MissingMember[] = [];
  const taken = new Set<string>();
  for (const m of members) {
    if (!m.removedFromCadAt) continue;
    const matches = live.filter((p) => p.systemId === m.systemId && norm(p.name) === norm(m.name));
    // Re-link to a live row that isn't already in the group (or claimed by another missing member).
    const target = matches.find((p) => !memberIds.has(p.id) && !taken.has(p.id)) ?? null;
    if (target) taken.add(target.id);
    missing.push({
      ...m,
      reason: matches.length ? "rekeyed" : "removed",
      liveMatches: matches.length,
      recoverTo: target?.id ?? null,
    });
  }
  const times = new Set(missing.map((m) => m.removedFromCadAt!.getTime()));
  return {
    total: members.length,
    missing,
    allAtOnce: missing.length > 1 && missing.length === members.length && times.size === 1,
    recoverable: missing.filter((m) => m.recoverTo).length,
  };
}
