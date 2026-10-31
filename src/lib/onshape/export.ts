import "server-only";
import { OnshapeError, type OnshapeClient } from "@/lib/onshape/client";

// CAD export in a machine's format (plan §4): STL is one synchronous call; STEP, Parasolid and
// a sheet metal part's flat pattern go through an Onshape translation (start, poll, download).

export const EXPORT_FORMATS = {
  STL: { ext: "stl", type: "model/stl" },
  STEP: { ext: "step", type: "model/step" },
  PARASOLID: { ext: "x_t", type: "application/octet-stream" },
  // A plate laid flat, made in the app from its 3D mesh (src/lib/drawing/plateDxf.ts), never here.
  DXF: { ext: "dxf", type: "image/vnd.dxf" },
  // The flat pattern of a sheet metal part.
  DXF_FLAT: { ext: "dxf", type: "image/vnd.dxf" },
  STEP_FLAT: { ext: "step", type: "model/step" },
} as const;
export type ExportFormat = keyof typeof EXPORT_FORMATS;
export const isExportFormat = (f: string): f is ExportFormat => f in EXPORT_FORMATS;

type Translation = {
  id: string;
  requestState: "ACTIVE" | "DONE" | "FAILED";
  documentId: string;
  resultExternalDataIds?: string[];
  failureReason?: string;
};

export async function exportPart(
  client: OnshapeClient,
  studio: string, // d/<did>/<wvm>/<wid>/e/<eid>
  partId: string,
  format: ExportFormat,
  deadline: number,
): Promise<ArrayBuffer> {
  if (format === "DXF") throw new OnshapeError("A plate's DXF is made from its mesh, not exported.");
  if (format === "STL") {
    const res = await client.raw(`parts/${studio}/partid/${encodeURIComponent(partId)}/stl?mode=binary&units=millimeter`);
    return res.arrayBuffer();
  }
  // A flat export translates the part's flat pattern body (`partId` is that body's id).
  const formatName = format.replace(/_FLAT$/, "");
  return translate(client, `partstudios/${studio}/translations`, { formatName, partIds: partId }, deadline, "this part");
}

// A whole assembly as one STEP file (a batch's Onshape layout).
export function exportAssemblyStep(client: OnshapeClient, assembly: string /* d/<did>/w/<wid>/e/<eid> */, deadline: number) {
  return translate(client, `assemblies/${assembly}/translations`, { formatName: "STEP", flattenAssemblies: false }, deadline, "this assembly");
}

// Start an Onshape translation, poll it and download the result.
async function translate(client: OnshapeClient, path: string, params: Record<string, unknown>, deadline: number, what: string): Promise<ArrayBuffer> {
  let t = await client.json<Translation>(path, {
    method: "POST",
    body: JSON.stringify({ ...params, storeInDocument: false }),
  });
  // Every poll counts against the app's yearly API allowance, so wait longer between them.
  for (let wait = 1500; t.requestState === "ACTIVE"; wait = Math.min(wait * 1.6, 8000)) {
    if (Date.now() > deadline) throw new OnshapeError("Onshape is still preparing this file. Try again in a minute.");
    await new Promise((r) => setTimeout(r, wait));
    t = await client.json<Translation>(`translations/${t.id}`);
  }
  const dataId = t.resultExternalDataIds?.[0];
  if (t.requestState !== "DONE" || !dataId) {
    throw new OnshapeError(`Onshape couldn't export ${what}${t.failureReason ? `: ${t.failureReason}` : "."}`);
  }
  const res = await client.raw(`documents/d/${t.documentId}/externaldata/${dataId}`);
  return res.arrayBuffer();
}
