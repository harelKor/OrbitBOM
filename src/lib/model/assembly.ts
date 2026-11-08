// The robot's 3D model, step 1: where every part sits. An Onshape assembly definition lists
// instances per (sub)assembly and one occurrence per placed instance, with its path through
// the subassemblies and its world transform. This flattens it to one placement per part.

type Instance = {
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

type SubAssembly = {
  documentId?: string;
  elementId?: string;
  documentMicroversion?: string;
  configuration?: string;
  instances?: Instance[];
};

export type AssemblyDefinition = {
  rootAssembly?: {
    instances?: Instance[];
    occurrences?: { path?: string[]; transform?: number[]; hidden?: boolean }[];
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
};

const config = (c?: string) => (c && c !== "default" ? c : "");

export function flattenAssembly(def: AssemblyDefinition): Placement[] {
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

  const out: Placement[] = [];
  for (const occ of def.rootAssembly?.occurrences ?? []) {
    const path = occ.path ?? [];
    if (occ.hidden || !path.length || occ.transform?.length !== 16) continue;
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
    if (!leaf || leaf.type !== "Part" || !leaf.documentId || !leaf.elementId || !leaf.partId) continue;
    out.push({
      studio: {
        did: leaf.documentId,
        eid: leaf.elementId,
        ...(leaf.documentVersion ? { version: leaf.documentVersion } : {}),
        ...(leaf.documentMicroversion ? { microversion: leaf.documentMicroversion } : {}),
        ...(config(leaf.configuration) ? { configuration: leaf.configuration } : {}),
      },
      partId: leaf.partId,
      transform: occ.transform,
      ...(leaf.name ? { name: leaf.name.replace(/\s*<\d+>$/, "") } : {}),
    });
  }
  return out;
}

// The key a BOM part and a placed part share: Part Studio + partId (the part's identity, ref §6).
export const partKey = (did: string, eid: string, partId: string) => `${did}:${eid}:${partId}`;
