/*
 * Service worker for the till: lets /pos open (or reload) while the internet is down, so cash sales
 * can continue into the offline queue. Deliberately small:
 *  - /_next/static/* and /vendor/*: cache-first (file names carry a content hash / never change)
 *  - opening /pos: network-first, the last good page is kept for when the network is gone
 *  - everything else (the API, other pages): not touched
 * Bump VERSION to throw away every cached file.
 */
const VERSION = "v1";
const STATIC = `pos-static-${VERSION}`;
const PAGES = `pos-pages-${VERSION}`;
const POS_PAGE = "/pos";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC, PAGES]);
      for (const key of await caches.keys()) if (key.startsWith("pos-") && !keep.has(key)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/vendor/")) {
    event.respondWith(cacheFirst(req));
    return;
  }
  if (req.mode === "navigate" && (url.pathname === POS_PAGE || url.pathname === `${POS_PAGE}/`)) {
    event.respondWith(posPage(req));
  }
});

// The page lists the files it loaded before this worker took control (and asks for itself), so they are kept too
self.addEventListener("message", (event) => {
  if (event.data?.type !== "cache-urls" || !Array.isArray(event.data.urls)) return;
  event.waitUntil(
    (async () => {
      if (event.data.page) {
        try {
          const res = await fetch(POS_PAGE, { credentials: "same-origin" });
          if (res.ok && !res.redirected) await (await caches.open(PAGES)).put(POS_PAGE, res);
        } catch {
          /* kept on the next visit */
        }
      }
      const cache = await caches.open(STATIC);
      for (const u of event.data.urls.slice(0, 300)) {
        const url = new URL(u, self.location.origin);
        if (url.origin !== self.location.origin || !(url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/vendor/"))) continue;
        if (await cache.match(url.href)) continue;
        try {
          const res = await fetch(url.href);
          if (res.ok) await cache.put(url.href, res);
        } catch {
          /* offline already: try again next visit */
        }
      }
    })(),
  );
});

async function cacheFirst(req) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone()).catch(() => {});
  return res;
}

async function posPage(req) {
  const cache = await caches.open(PAGES);
  try {
    const res = await fetch(req);
    // a redirect to /login (signed out) or an error page is not the till
    if (res.ok && !res.redirected && res.type === "basic") await cache.put(POS_PAGE, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const hit = await cache.match(POS_PAGE);
    if (hit) return hit;
    throw err;
  }
}
