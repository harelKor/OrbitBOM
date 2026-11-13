// OrbitParts' service worker (Harel, 2026-11-13: installed app that opens fast and works offline).
//
// - The app's code (/_next/static: scripts, styles, fonts) comes from the device: each file's name
//   changes with its contents, so a saved copy never goes stale and the app opens without
//   downloading its code again.
// - Pages always come from the server first, so nobody works from old data while online. A copy of
//   each page you open is kept; offline (or when the server takes too long) that copy is shown,
//   and the page's offline bar says from when (OfflineSupport.tsx asks here).
// - Never kept: /api, saves (server actions are POSTs), sign-in, the Onshape panel, MCP. Signed R2
//   links aren't ours (another origin) and pass straight through; 3D meshes have their own cache
//   (meshCache.ts).
// - Saved pages hold team data, and the shop's phones are shared: any visit to /login (signing out
//   ends there, and so does an expired session) deletes them.
//
// Plain JS on purpose: served as-is from /public, no build step. Bump VERSION to drop every cache
// this file made.

const VERSION = "v1";
const STATIC = `orbit-static-${VERSION}`;
const PAGES = `orbit-pages-${VERSION}`;
const OURS = [STATIC, PAGES];
const SAVED_AT = "x-orbit-saved"; // ms since 1970, on each saved page
const LAST = "/__orbit/last-page"; // the URL of the page saved most recently
const MAX_STATIC = 1200;
const MAX_PAGES = 200;
// A page the server hasn't answered after this long shows its saved copy (shop Wi-Fi that's
// connected but not getting through); the server's answer still replaces the copy when it comes.
const SLOW_MS = 8000;

// Paths whose pages are never saved or answered from the cache.
const NOT_SAVED = /^\/(api|auth|login|invite|onshape|dev|pending|_next\/data|__orbit)(\/|$)/;
// Our own pictures in /public: kept, but checked again in the background.
const PICTURE = /^\/(categories|apps)\/|\.(png|ico|svg|webp|jpg)$/;

// Pages served from their saved copy, by URL, for the page to ask "am I a saved copy, from when?"
const servedFromCache = new Map();

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        // Older versions of these two; the mesh cache (orbit-meshes-*) is meshCache.ts's own.
        if (/^orbit-(static|pages)-/.test(name) && !OURS.includes(name)) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "saved-at" && event.ports[0]) {
    const at = servedFromCache.get(data.url) ?? null;
    servedFromCache.delete(data.url);
    event.ports[0].postMessage({ savedAt: at });
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    if (url.pathname === "/login") {
      // Signed out (or the session ran out): the next person on this device mustn't see these.
      event.waitUntil(caches.delete(PAGES));
      return;
    }
    if (NOT_SAVED.test(url.pathname)) return;
    event.respondWith(page(event, request, url));
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (PICTURE.test(url.pathname) && !url.pathname.startsWith("/__mesh-cache/")) {
    event.respondWith(staleWhileRevalidate(event, request));
  }
  // Everything else (RSC payloads, /api, server actions, the manifest) goes to the network as
  // usual. Offline, Next's router turns a failed in-app navigation into a full page load, which
  // lands in page() above.
});

const pageKey = (url) => url.origin + url.pathname + url.search;

async function page(event, request, url) {
  const cache = await caches.open(PAGES);
  const key = pageKey(url);
  let saving = null;
  const network = fetch(request).then(
    (response) => {
      // Only a whole, signed-in page: a redirect (to /login, or /go/<page> to its robot) comes back
      // opaque here and is passed on as it is.
      const html = (response.headers.get("content-type") || "").includes("text/html");
      if (response.ok && response.type === "basic" && html) saving = save(cache, key, response.clone());
      return response;
    },
    () => null,
  );
  // Keeps the worker alive to save the server's answer even when the saved copy went out first.
  event.waitUntil(network.then(() => saving));

  const saved = await cache.match(key);
  const quick = saved ? await Promise.race([network, new Promise((r) => setTimeout(() => r("slow"), SLOW_MS))]) : await network;
  if (quick && quick !== "slow") return quick;
  if (saved) {
    servedFromCache.set(url.href, Number(saved.headers.get(SAVED_AT)) || null);
    return saved;
  }
  // Offline with no copy of this page. The installed app opens at "/" (which redirects to the
  // robot last used) and the home-screen shortcuts at /go/<page>: open the page seen last instead.
  if (url.pathname === "/" || url.pathname.startsWith("/go/")) {
    const last = await cache.match(LAST);
    const lastUrl = last ? await last.text() : null;
    if (lastUrl) return Response.redirect(lastUrl, 302);
  }
  return offlinePage();
}

async function save(cache, key, response) {
  try {
    const headers = new Headers(response.headers);
    headers.set(SAVED_AT, String(Date.now()));
    const body = await response.blob();
    await cache.put(key, new Response(body, { status: response.status, statusText: response.statusText, headers }));
    await cache.put(LAST, new Response(key));
    await trim(cache, MAX_PAGES);
  } catch {
    // Full or not allowed: it's only a copy.
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) {
    cache.put(request, response.clone()).then(() => trim(cache, MAX_STATIC)).catch(() => {});
  }
  return response;
}

async function staleWhileRevalidate(event, request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  let saving = null;
  const network = fetch(request).then((response) => {
    if (response.ok) saving = cache.put(request, response.clone()).catch(() => {});
    return response;
  });
  event.waitUntil(network.then(() => saving, () => {}));
  return hit || network;
}

// Drops the oldest entries over `max` (keys() lists them in the order they were saved). Old
// builds' scripts stay until then, so a page saved before a deploy still opens offline.
async function trim(cache, max) {
  const keys = (await cache.keys()).filter((r) => !r.url.endsWith(LAST));
  for (const r of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(r);
}

function offlinePage() {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0000cc"><title>Offline · OrbitParts</title>
<style>body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;background:#f2f2f2;color:#111318}main{max-width:22rem;padding:1.5rem;text-align:center}h1{font-size:1.25rem;margin:0 0 .5rem}p{color:#555;line-height:1.45;margin:0 0 1.25rem}button,a{display:inline-flex;align-items:center;min-height:40px;padding:0 1rem;border-radius:.5rem;border:0;font:inherit;font-weight:600;text-decoration:none;cursor:pointer;margin:.25rem}button{background:#0000cc;color:#fff}a{background:#fff;color:#111318;box-shadow:0 0 0 1px #ddd}@media (prefers-color-scheme:dark){body{background:#111318;color:#eee}p{color:#aaa}a{background:#1c1f26;color:#eee;box-shadow:0 0 0 1px #333}}</style></head>
<body><main><h1>You're offline</h1><p>This page hasn't been opened on this device yet, so there's no saved copy. Pages you've opened before still work.</p><button onclick="location.reload()">Try again</button><a href="javascript:history.back()">Go back</a></main></body></html>`;
  return new Response(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
