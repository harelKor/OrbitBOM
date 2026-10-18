// Onshape document URLs: https://<host>/documents/<did>/<w|v|m>/<wvmid>/e/<eid>
// The host is cad.onshape.com or an Enterprise domain such as <company>.onshape.com.

export type WVM = "w" | "v" | "m";

export type OnshapeRef = {
  baseUrl: string; // https://<host>
  did: string;
  wvm: WVM;
  wvmid: string;
  eid?: string;
};

const ID = "[0-9a-f]{24}";
const PATH = new RegExp(`^/documents/(${ID})/([wvm])/(${ID})(?:/e/(${ID}))?/?$`, "i");

export function parseOnshapeUrl(input: string): OnshapeRef | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !/(^|\.)onshape\.com$/i.test(url.hostname)) return null;
  const match = PATH.exec(url.pathname);
  if (!match) return null;
  const [, did, wvm, wvmid, eid] = match;
  return {
    baseUrl: `https://${url.hostname.toLowerCase()}`,
    did: did.toLowerCase(),
    wvm: wvm.toLowerCase() as WVM,
    wvmid: wvmid.toLowerCase(),
    ...(eid ? { eid: eid.toLowerCase() } : {}),
  };
}

export function onshapeUrl(ref: OnshapeRef): string {
  const base = `${ref.baseUrl}/documents/${ref.did}/${ref.wvm}/${ref.wvmid}`;
  return ref.eid ? `${base}/e/${ref.eid}` : base;
}

// The path fragment most Onshape API endpoints take: d/<did>/<wvm>/<wvmid>[/e/<eid>]
export function apiPath(ref: OnshapeRef): string {
  const base = `d/${ref.did}/${ref.wvm}/${ref.wvmid}`;
  return ref.eid ? `${base}/e/${ref.eid}` : base;
}
