// The browser's own copy of each Part Studio mesh file, in Cache Storage under its R2 key. A key
// names one Part Studio revision (build.ts hashes the revision and the tessellation version into
// it), so a cached file never goes stale: a second visit to a CAD page draws without downloading
// anything, and R2 serves (and counts) only what's new. The signed links change with every page
// load, so the browser's HTTP cache never matched them. Runs in the mesh worker (meshWorker.ts).
//
// Every cache call can fail (private windows, storage turned off, quota): then the file is simply
// downloaded as before.

export const MESH_CACHE = "orbit-meshes-v1";
const USED = "x-orbit-used"; // the day (days since 1970) the file was last drawn
const DAY = 86_400_000;
const today = () => Math.floor(Date.now() / DAY);
const PREFIX = "/__mesh-cache/";
const cacheUrl = (key: string) => `${self.location.origin}${PREFIX}${encodeURI(key)}`;

async function openCache(): Promise<Cache | null> {
  try {
    return typeof caches === "undefined" ? null : await caches.open(MESH_CACHE);
  } catch {
    return null;
  }
}

async function put(cache: Cache, key: string, buf: ArrayBuffer) {
  try {
    // A Blob copies the bytes, so `buf` stays usable for decoding.
    await cache.put(cacheUrl(key), new Response(new Blob([buf]), { headers: { "Content-Type": "application/gzip", [USED]: String(today()) } }));
  } catch {
    // Full or not allowed: it's only a cache.
  }
}

// The gzipped file: from the cache when this key is there, else downloaded from `url` (and kept
// when it has a key). Without a key (a file that can change under its name), always downloaded.
export async function meshFile(url: string, key: string | null): Promise<ArrayBuffer> {
  const cache = key ? await openCache() : null;
  if (cache && key) {
    try {
      const hit = await cache.match(cacheUrl(key));
      if (hit) {
        const buf = await hit.arrayBuffer();
        // Marks it used today (once a day), for the clean-up below.
        if (Number(hit.headers.get(USED)) < today()) void put(cache, key, buf);
        return buf;
      }
    } catch {
      // Fall through to the download.
    }
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`model file ${res.status}`);
  const buf = await res.arrayBuffer();
  if (cache && key) void put(cache, key, buf);
  return buf;
}

const folder = (key: string) => key.slice(0, key.lastIndexOf("/") + 1);

// Which cached files to drop after a model drew from `current`: another revision of a Part Studio
// this model uses (same folder: models/studios/<document>/<element>/) not drawn for two days, and
// anything not drawn for 30 days. The cache is shared by every robot, system page and review, so
// "not in this model" alone would throw away the files of the robot next door; the two days keep
// a reviewer flipping between versions from downloading again.
export function staleKeys(cached: { key: string; used: number }[], current: string[], now = today()): string[] {
  const keep = new Set(current);
  const folders = new Set(current.map(folder));
  return cached
    .filter(({ key, used }) => !keep.has(key) && (now - used > 30 || (folders.has(folder(key)) && now - used >= 2)))
    .map((c) => c.key);
}

export async function sweepMeshCache(current: string[]) {
  const cache = await openCache();
  if (!cache) return;
  try {
    const cached: { key: string; used: number }[] = [];
    for (const req of await cache.keys()) {
      const path = new URL(req.url).pathname;
      if (!path.startsWith(PREFIX)) continue;
      const res = await cache.match(req);
      cached.push({ key: decodeURI(path.slice(PREFIX.length)), used: Number(res?.headers.get(USED)) || 0 });
    }
    for (const key of staleKeys(cached, current)) await cache.delete(cacheUrl(key));
  } catch {
    // Next time.
  }
}
