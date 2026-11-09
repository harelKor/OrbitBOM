import { parseOnshapeUrl } from "@/lib/onshape/url";

// Where Onshape opened the panel, from its URL: the assembly (on its workspace or a version) and
// the query the panel's own pages carry along, so the comment page knows the version open.
export function panelPlace(params: Record<string, string | undefined>) {
  const { server, documentId, elementId } = params;
  const host = server && /^https:\/\/[a-z0-9-]+\.onshape\.com\/?$/i.test(server) ? server.replace(/\/$/, "") : "https://cad.onshape.com";
  // {$workspaceOrVersion} is "w" or "v"; the older panel URL sent only {$workspaceId}.
  const wv = params.workspaceOrVersion === "v" ? "v" : "w";
  const wvId = params.workspaceOrVersionId ?? params.workspaceId;
  const ref = parseOnshapeUrl(`${host}/documents/${documentId}/${wv}/${wvId}/e/${elementId}`);
  const query = ref ? new URLSearchParams({ server: ref.baseUrl, documentId: ref.did, workspaceOrVersion: ref.wvm, workspaceOrVersionId: ref.wvmid, elementId: ref.eid ?? "" }).toString() : "";
  return { ref, query };
}
