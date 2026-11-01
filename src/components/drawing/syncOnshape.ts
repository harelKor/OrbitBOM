import type { OnshapeDrawingSync } from "@/lib/drawing/onshapeSync";

// Pull Onshape drawing tabs onto the system's parts (all its parts, or `partIds`), calling again
// while the server says some are left. Only ever on a member's click: it spends Onshape calls.
export async function syncOnshapeDrawings(systemId: string, partIds?: string[]): Promise<OnshapeDrawingSync> {
  const total: OnshapeDrawingSync = { linked: [], unchanged: [], left: [], found: 0 };
  let ids = partIds;
  for (let round = 0; round < 10; round++) {
    const res = await fetch(`/api/systems/${systemId}/drawings/onshape`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ids ? { partIds: ids } : {}),
    });
    const body = (await res.json().catch(() => ({}))) as OnshapeDrawingSync & { error?: string };
    if (!res.ok) throw new Error(body.error ?? "Couldn't sync the Onshape drawings.");
    total.linked.push(...body.linked);
    total.unchanged.push(...body.unchanged);
    total.found = Math.max(total.found, body.found);
    total.left = body.left;
    if (!body.left.length || body.left.length >= (ids?.length ?? Infinity)) break;
    ids = body.left;
  }
  return total;
}
