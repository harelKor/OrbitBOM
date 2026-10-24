import "server-only";
import { OnshapeError, type OnshapeClient } from "@/lib/onshape/client";

// A part's shape fingerprint: its volume, surface area and principal moments of inertia, from
// Onshape's mass properties. None of these change when a part only moves, is re-generated with
// a new partId (a derived or re-inserted Part Studio) or sits in a newer Onshape version, so
// equal fingerprints mean fab makes the same part. A moved hole changes the inertia.
// Keyed like mvKey: did|eid|partId.

type Body = { volume?: number[]; periphery?: number[]; principalInertia?: number[]; hasMass?: boolean };
type MassProperties = { bodies?: Record<string, Body> };

const round = (n: number) => (Math.abs(n) < 1e-15 ? "0" : n.toPrecision(6));

export function fingerprint(b: Body): string | null {
  const volume = b.volume?.[0];
  const area = b.periphery?.[0];
  if (volume === undefined || area === undefined) return null;
  const inertia = b.hasMass === false ? [] : [...(b.principalInertia ?? [])].sort((x, y) => x - y);
  return [volume, area, ...inertia].map(round).join(",");
}

export const shapeKey = (did: string, eid: string, partId: string) => `${did}|${eid}|${partId}`;

// Fingerprints of the given parts, one mass-properties call per Part Studio, a few at a time.
// `studios` maps a studio path (d/<did>/<wvm>/<id>/e/<eid>) to its part ids. A Part Studio that
// fails is left out: its parts count as unchanged in shape.
export async function shapeFingerprints(client: OnshapeClient, studios: Map<string, string[]>): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const queue = [...studios];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [path, partIds] = next;
      const [, did, , , , eid] = path.split("/");
      const query = [...new Set(partIds)].map((id) => `partId=${encodeURIComponent(id)}`).join("&");
      try {
        const mp = await client.json<MassProperties>(`partstudios/${path}/massproperties?massAsGroup=false&${query}`);
        for (const [partId, body] of Object.entries(mp.bodies ?? {})) {
          const sig = fingerprint(body);
          if (sig) out[shapeKey(did, eid, partId)] = sig;
        }
      } catch (err) {
        if (!(err instanceof OnshapeError)) throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return out;
}
