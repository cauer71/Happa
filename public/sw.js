// Service Worker: App-Hülle und Lebensmitteldaten offline verfügbar machen.
// Strategie: Dateien der App "stale-while-revalidate", /api/ immer übers Netz.
const CACHE = "happa-v1";
const SHELL = [
  "/", "/css/app.css", "/js/app.js", "/js/util.js", "/js/icons.js", "/js/api.js", "/js/store.js", "/js/ui.js",
  "/js/nutrition.js", "/js/foods.js", "/js/thumbs.js",
  "/js/views/today.js", "/js/views/add.js", "/js/views/entry.js", "/js/views/weight.js", "/js/views/camera.js",
  "/js/views/progress.js", "/js/views/profile.js", "/js/views/onboarding.js",
  "/vendor/preact.mjs", "/vendor/preact-hooks.mjs", "/vendor/htm.mjs", "/icons/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Nur echte Antworten der App cachen – keine Umleitung zur Access-Anmeldeseite
const cacheable = (res) => res && res.ok && res.type === "basic" && !res.redirected;

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/cdn-cgi/")) return;

  if (req.mode === "navigate") {
    // Seite immer frisch laden (Anmeldung!), offline die gespeicherte Hülle zeigen
    event.respondWith(fetch(req).catch(() => caches.match("/")));
    return;
  }

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      const net = fetch(req).then((res) => {
        if (cacheable(res)) cache.put(req, res.clone());
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
