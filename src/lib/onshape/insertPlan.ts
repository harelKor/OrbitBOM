// The pure part of Insert (insert.ts): grouping and Onshape's feature body, kept apart so tests
// don't need the database.

export type InsertPart = { did: string; eid: string; partId: string; versionId: string };
export type InsertGroup = { did: string; eid: string; versionId: string; partIds: string[] };

// One group per source Part Studio and version: each becomes one Derived feature (Harel, 2026-11-21).
export function groupParts(parts: InsertPart[]): InsertGroup[] {
  const groups = new Map<string, InsertGroup>();
  for (const p of parts) {
    const k = `${p.did}:${p.eid}:${p.versionId}`;
    const g = groups.get(k) ?? { did: p.did, eid: p.eid, versionId: p.versionId, partIds: [] };
    if (!g.partIds.includes(p.partId)) g.partIds.push(p.partId);
    groups.set(k, g);
  }
  return [...groups.values()];
}

// A Derived feature holding the chosen parts of one Part Studio at one version (the reference's
// namespace names the version and the element's microversion at it).
export function derivedFeature(name: string, g: InsertGroup & { microversion: string }) {
  return {
    btType: "BTFeatureDefinitionCall-1406",
    feature: {
      btType: "BTMFeature-134",
      featureType: "importDerived",
      name,
      parameters: [
        {
          btType: "BTMParameterReferencePartStudio-3302",
          parameterId: "partStudio",
          namespace: `d${g.did}::v${g.versionId}::e${g.eid}::m${g.microversion}`,
          partQuery: { btType: "BTMParameterQueryList-148", queries: [{ btType: "BTMIndividualQuery-138", deterministicIds: g.partIds }] },
        },
      ],
    },
  };
}

// The Derived feature's name: the version shows in Onshape's feature list ("OP 400 Final · V12").
export const featureName = (source: string, model: "basepart" | "final" | null, version: string) => `OP ${source}${model ? ` ${model === "basepart" ? "Basepart" : "Final"}` : ""} · ${version}`;
