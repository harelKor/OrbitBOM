import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { VersionRef } from "@/db/schema";
import { onshapeClient, OnshapeError } from "@/lib/onshape/client";
import { parseOnshapeUrl } from "@/lib/onshape/url";
import { primaryVersion, versionLabel } from "./label";

const { onshapeCache, systems, systemVersions } = schema;

// Keeps a committed version's name the same here and in Onshape's version tree
// (plan/fab-version-lock.md §1). The Commit window starts with the Onshape version's name; when
// the member typed another one, the Onshape version is renamed (1 call), or, for an assembly
// followed in a workspace with no version behind the change, a version with that name is made in
// the Manufacture document (1 call). Onshape failing (the yearly allowance, no rights) never undoes
// the commit: the reason comes back as a note and the name stays on the site only.
export async function syncOnshapeVersionName(
  systemId: string,
  versionId: string,
  name: string,
  member: { id: string; onshapeConnected: boolean },
): Promise<{ label?: string; note?: string }> {
  const typed = name.trim();
  if (!typed) return {};
  const [row] = await db
    .select({ v: systemVersions, assemblyUrl: systems.assemblyUrl })
    .from(systemVersions)
    .innerJoin(systems, eq(systems.id, systemVersions.systemId))
    .where(eq(systemVersions.id, versionId));
  if (!row || row.v.systemId !== systemId) return {};
  const ref = row.v.onshapeRef;
  const main = primaryVersion(ref);
  if (main?.[1].name === typed) return {};
  const asm = row.assemblyUrl ? parseOnshapeUrl(row.assemblyUrl) : null;
  if (!asm || !ref) return {};
  if (!main && asm.wvm !== "w") return {};
  if (!member.onshapeConnected) return { note: "Connect Onshape on your profile to name the version in Onshape too." };

  const client = onshapeClient(member.id, asm.baseUrl);
  try {
    let next: NonNullable<VersionRef["sources"]>;
    if (main) {
      // Only the main document's version is renamed; the COTS and library ones keep their names.
      const [did, v] = main;
      await client.json(`documents/d/${did}/versions/${v.versionId}`, { method: "POST", body: JSON.stringify({ name: typed }) });
      next = { ...ref.sources, [did]: { ...v, name: typed } };
      const vid = v.versionId;
      await rememberName(vid, typed);
    } else {
      // A workspace: Onshape gets a version of the Manufacture document as it was when checked.
      const made = await client.json<{ id: string; name?: string }>(`documents/d/${asm.did}/versions`, {
        method: "POST",
        body: JSON.stringify({ documentId: asm.did, workspaceId: asm.wvmid, name: typed, ...(ref.mv && ref.did === asm.did ? { microversionId: ref.mv } : {}) }),
      });
      next = { ...ref.sources, [asm.did]: { versionId: made.id, name: made.name ?? typed, parts: 0, main: true } };
      await rememberName(made.id, made.name ?? typed);
    }
    const onshapeRef = { ...ref, sources: next };
    await db.update(systemVersions).set({ onshapeRef }).where(eq(systemVersions.id, versionId));
    return { label: versionLabel({ seq: row.v.seq, onshapeRef }) };
  } catch (err) {
    if (!(err instanceof OnshapeError)) throw err;
    return { note: `Saved here; Onshape wasn't ${main ? "renamed" : "given the version"}: ${err.message}` };
  }
}

// detect.ts reads a version's name once and keeps it; a rename replaces what it kept.
async function rememberName(versionId: string, name: string) {
  const key = `version-name:${versionId}`;
  await db.insert(onshapeCache).values({ key, payload: { name } }).onConflictDoUpdate({ target: onshapeCache.key, set: { payload: { name } } });
}
