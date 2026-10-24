/**
 * Registers /sw.js (production only) so the till page opens while the internet is down, and hands
 * it the files this page already loaded plus the page itself, which it could not see being fetched.
 */
export function registerPosWorker() {
  if (process.env.NODE_ENV !== "production" || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  void (async () => {
    try {
      await navigator.serviceWorker.register("/sw.js");
      const reg = await navigator.serviceWorker.ready;
      const urls = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .concat(Array.from(document.scripts, (s) => s.src).filter(Boolean))
        .concat(Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'), (l) => l.href));
      reg.active?.postMessage({ type: "cache-urls", urls: Array.from(new Set(urls)), page: true });
    } catch {
      /* no service worker (private window, blocked): the till works, but not after an offline reload */
    }
  })();
}
