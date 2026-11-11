import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { VersionRef } from "@/db/schema";
import { logCalls, onshapeClient, OnshapeError, type OnshapeClient } from "@/lib/onshape/client";
import { parseOnshapeUrl } from "@/lib/onshape/url";
import { addKeptVersion, nextVersionName, readDocVersions } from "./docVersions";
import { primaryVersion, versionLabel } from "./label";

const { onshapeCache, systems, systemVersions } = schema;

export const BOM_RELEASE = "BOM release";

// Update BOM's Onshape version (Harel, 2026-11-11): each commit makes a version of the assembly's
// document at the exact state the check read, named "V<next> BOM release", so Onshape's version
// tree shows where the BOM was released. When the assembly is in a Manufacture document that
// inserts the CAD document by version, the CAD document gets one too, at that inserted version's
// state ("both, if possible": Harel). The note typed in the Commit window is the versions'
// description. A system that follows Onshape versions is already on one, so nothing is made.
// Onshape failing (the yearly allowance, no rights) never undoes the commit: the reason comes
// back as a note. 2 calls (the version list for the next number, the version), 3 more for a CAD
// document behind a Manufacture one.
export async function releaseBomVersion(
  systemId: string,
  versionId: string,
  note: string,
  member: { id: string; onshapeConnected: boolean },
): Promise<{ label?: string; note?: string }> {
  const [row] = await db
    .select({ v: systemVersions, assemblyUrl: systems.assemblyUrl })
    .from(systemVersions)
    .innerJoin(systems, eq(systems.id, systemVersions.systemId))
    .where(eq(systemVersions.id, versionId));
  if (!row || row.v.systemId !== systemId) return {};
  const ref = row.v.onshapeRef;
  const asm = row.assemblyUrl ? parseOnshapeUrl(row.assemblyUrl) : null;
  if (!asm || !ref || ref.vid || asm.wvm !== "w") return {};
  if (!member.onshapeConnected) return { note: "Connect Onshape on your profile so Update BOM makes its Onshape version." };

  const client = onshapeClient(member.id, asm.baseUrl);
  const description = note.trim().slice(0, 120);
  try {
    const main = primaryVersion(ref);
    const cad = main && main[0] !== asm.did ? main : null;
    const sources: NonNullable<VersionRef["sources"]> = { ...ref.sources };
    // The assembly's own document, at the microversion the check read.
    const made = await makeVersion(client, asm.did, asm.wvmid, ref.did === asm.did ? ref.mv : null, description);
    sources[asm.did] = { versionId: made.id, name: made.name, parts: 0, main: !cad };
    let vid = made.id;
    let cadNote: string | undefined;
    if (cad) {
      // The CAD document: a version at the state the Manufacture document inserts.
      const [did, inserted] = cad;
      try {
        const [info, doc] = await Promise.all([
          client.json<{ microversion?: string }>(`documents/d/${did}/versions/${inserted.versionId}`),
          client.json<{ defaultWorkspace?: { id: string } }>(`documents/${did}`),
        ]);
        if (!info.microversion || !doc.defaultWorkspace?.id) throw new OnshapeError("Onshape didn't say where that version is.");
        const cadMade = await makeVersion(client, did, doc.defaultWorkspace.id, info.microversion, description);
        sources[did] = { ...inserted, versionId: cadMade.id, name: cadMade.name };
        vid = cadMade.id;
      } catch (err) {
        if (!(err instanceof OnshapeError)) throw err;
        cadNote = `The CAD document got no BOM release version: ${err.message}`;
      }
    }
    const onshapeRef: VersionRef = { ...ref, sources, vid };
    await db.update(systemVersions).set({ onshapeRef }).where(eq(systemVersions.id, versionId));
    return { label: versionLabel({ seq: row.v.seq, onshapeRef }), note: cadNote };
  } catch (err) {
    if (!(err instanceof OnshapeError)) throw err;
    return { note: `Committed here; Onshape got no BOM release version: ${err.message}` };
  } finally {
    logCalls("bom-release", client);
  }
}

// A new "V<next> BOM release" version of a document's workspace, at `microversion` when given
// (else the workspace as it is now), added to the kept version list.
async function makeVersion(client: OnshapeClient, did: string, wid: string, microversion: string | null | undefined, description: string) {
  const list = await readDocVersions(client, did);
  const name = `${nextVersionName(list)} ${BOM_RELEASE}`;
  const made = await client.json<{ id: string; name?: string; createdAt?: string; description?: string; creator?: { name?: string } }>(`documents/d/${did}/versions`, {
    method: "POST",
    body: JSON.stringify({ documentId: did, workspaceId: wid, name, ...(description ? { description } : {}), ...(microversion ? { microversionId: microversion } : {}) }),
  });
  await addKeptVersion(did, { ...made, name: made.name ?? name });
  await rememberName(made.id, made.name ?? name);
  return { id: made.id, name: made.name ?? name };
}

// detect.ts reads a version's name once and keeps it.
async function rememberName(versionId: string, name: string) {
  const key = `version-name:${versionId}`;
  await db.insert(onshapeCache).values({ key, payload: { name } }).onConflictDoUpdate({ target: onshapeCache.key, set: { payload: { name } } });
}
