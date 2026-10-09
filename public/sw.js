// Service Worker: App offline starten und Lebensmittelsuche offline ermöglichen.
// - App-Dateien (Seite, JS, CSS): zuerst übers Netz (neue Version sofort), offline aus dem Cache
// - Lebensmitteldaten und Symbole: aus dem Cache, im Hintergrund aktualisieren
// - /api/ und /cdn-cgi/ nie cachen (Anmeldung!)
const CACHE = "happa-v30";
const SHELL = [
  "/", "/css/app.css", "/js/app.js", "/js/util.js", "/js/icons.js", "/js/api.js", "/js/store.js", "/js/ui.js",
  "/js/nutrition.js", "/js/foods.js", "/js/thumbs.js", "/js/claude.js",
  "/js/views/today.js", "/js/views/add.js", "/js/views/entry.js", "/js/views/weight.js", "/js/views/camera.js",
  "/js/views/progress.js", "/js/views/profile.js", "/js/views/onboarding.js", "/js/views/help.js", "/js/views/favorites.js", "/js/views/health.js", "/js/views/training.js", "/js/views/balance.js",
  "/vendor/preact.mjs", "/vendor/preact-hooks.mjs", "/vendor/htm.mjs", "/icons/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(SHELL.map((u) => fetch(u, { redirect: "manual" }).then((r) => (cacheable(r) ? c.put(u, r) : null)))))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Nur echte Antworten der App cachen – keine Umleitung zur Access-Anmeldeseite
const cacheable = (res) => res && res.ok && res.type === "basic" && !res.redirected;

async function networkFirst(req, key = req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (cacheable(res)) cache.put(key, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(key);
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(event, req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  const net = fetch(req).then((res) => {
    if (cacheable(res)) cache.put(req, res.clone());
    return res;
  });
  if (hit) {
    event.waitUntil(net.catch(() => {}));
    return hit;
  }
  return net;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/cdn-cgi/")) return;

  if (req.mode === "navigate") {
    // Seite immer frisch laden (Anmeldung!), offline die zuletzt geladene Hülle zeigen
    event.respondWith(networkFirst(req, "/"));
    return;
  }
  if (url.pathname.startsWith("/data/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(staleWhileRevalidate(event, req));
    return;
  }
  event.respondWith(networkFirst(req));
});
