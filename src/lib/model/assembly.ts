// The robot's 3D model, step 1: where every part sits. An Onshape assembly definition lists
// instances per (sub)assembly and one occurrence per placed instance, with its path through
// the subassemblies and its world transform. This flattens it to one placement per part.

export type Instance = {
  id: string;
  name?: string; // "Side plate <2>"
  type?: string; // "Part" | "Assembly" | ...
  documentId?: string;
  documentMicroversion?: string;
  documentVersion?: string;
  elementId?: string;
  partId?: string;
  configuration?: string;
  suppressed?: boolean;
};

export type SubAssembly = {
  documentId?: string;
  elementId?: string;
  documentMicroversion?: string;
  configuration?: string;
  instances?: Instance[];
  features?: AssemblyFeature[]; // with includeMateFeatures=true (mates.ts)
};

// A mate, mate group or mate relation, as the definition lists them with includeMateFeatures=true
// (read in mates.ts). Occurrence paths are relative to the assembly the feature is in.
export type AssemblyFeature = {
  id?: string;
  featureType?: string; // "mate" | "mateGroup" | "mateRelation" | "mateConnector"
  suppressed?: boolean;
  featureData?: Record<string, unknown>;
};

export type AssemblyDefinition = {
  rootAssembly?: {
    instances?: Instance[];
    occurrences?: { path?: string[]; transform?: number[]; hidden?: boolean; fixed?: boolean }[];
    features?: AssemblyFeature[];
    documentId?: string;
    elementId?: string;
    documentMicroversion?: string;
    configuration?: string;
  };
  subAssemblies?: SubAssembly[];
};

// One Part Studio at one revision: what a tessellation call fetches.
export type StudioRef = {
  did: string;
  eid: string;
  version?: string; // a linked document's version
  microversion?: string;
  configuration?: string;
};

export type Placement = {
  studio: StudioRef;
  partId: string;
  transform: number[]; // 4x4, row-major, metres
  name?: string; // the instance's name without Onshape's " <n>" count
  path: string[]; // the occurrence's instance ids from the root assembly down (mates.ts)
};

const config = (c?: string) => (c && c !== "default" ? c : "");

// Every occurrence that isn't suppressed (itself or an assembly above it): its path, its world
// transform, whether it's hidden, its instance and, for a sub-assembly, that sub-assembly's own
// definition (its instances and features).
export type Occurrence = { path: string[]; transform: number[]; hidden: boolean; fixed: boolean; inst: Instance; sub?: SubAssembly };
export function walkAssembly(def: AssemblyDefinition): Occurrence[] {
  const root = def.rootAssembly?.instances ?? [];
  const subs = def.subAssemblies ?? [];
  const subFor = (inst: Instance) =>
    subs.find(
      (s) =>
        s.documentId === inst.documentId &&
        s.elementId === inst.elementId &&
        config(s.configuration) === config(inst.configuration) &&
        (!s.documentMicroversion || !inst.documentMicroversion || s.documentMicroversion === inst.documentMicroversion),
    ) ??
    subs.find((s) => s.documentId === inst.documentId && s.elementId === inst.elementId && config(s.configuration) === config(inst.configuration));

  const out: Occurrence[] = [];
  for (const occ of def.rootAssembly?.occurrences ?? []) {
    const path = occ.path ?? [];
    if (!path.length || occ.transform?.length !== 16) continue;
    let list = root;
    let leaf: Instance | undefined;
    for (let i = 0; i < path.length; i++) {
      const inst = list.find((x) => x.id === path[i]);
      if (!inst || inst.suppressed) {
        leaf = undefined;
        break;
      }
      if (i === path.length - 1) leaf = inst;
      else list = subFor(inst)?.instances ?? [];
    }
    if (!leaf) continue;
    const sub = leaf.type === "Assembly" ? subFor(leaf) : undefined;
    out.push({ path, transform: occ.transform, hidden: !!occ.hidden, fixed: !!occ.fixed, inst: leaf, ...(sub ? { sub } : {}) });
  }
  return out;
}

export function flattenAssembly(def: AssemblyDefinition): Placement[] {
  const out: Placement[] = [];
  for (const { path, transform, hidden, inst: leaf } of walkAssembly(def)) {
    if (hidden || leaf.type !== "Part" || !leaf.documentId || !leaf.elementId || !leaf.partId) continue;
    out.push({
      studio: {
        did: leaf.documentId,
        eid: leaf.elementId,
        ...(leaf.documentVersion ? { version: leaf.documentVersion } : {}),
        ...(leaf.documentMicroversion ? { microversion: leaf.documentMicroversion } : {}),
        ...(config(leaf.configuration) ? { configuration: leaf.configuration } : {}),
      },
      partId: leaf.partId,
      transform,
      ...(leaf.name ? { name: leaf.name.replace(/\s*<\d+>$/, "") } : {}),
      path,
    });
  }
  return out;
}

// The key a BOM part and a placed part share: Part Studio + partId (the part's identity, ref §6).
export const partKey = (did: string, eid: string, partId: string) => `${did}:${eid}:${partId}`;
