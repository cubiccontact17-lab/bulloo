// Service worker : application utilisable hors connexion
// (avec la dernière météo connue et les tuiles de carte déjà vues).
const VERSION = "champi-v2";
const SHELL = [
  "./",
  "index.html",
  "css/style.css",
  "js/app.js",
  "js/algo.js",
  "js/data.js",
  "js/vendee.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "vendor/leaflet/leaflet.js",
  "vendor/leaflet/leaflet.css",
  "vendor/leaflet/images/layers.png",
  "vendor/leaflet/images/layers-2x.png"
];
const TILE_CACHE = "champi-tiles";
const PHOTO_CACHE = "champi-photos";
const MAX_TILES = 800;

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== TILE_CACHE && k !== PHOTO_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trimTiles() {
  const cache = await caches.open(TILE_CACHE);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
}

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;

  // Météo : toujours le réseau (le cache est géré par l'application)
  if (url.hostname.endsWith("open-meteo.com")) return;

  // Photos des fiches (Wikipédia) : cache d'abord, pour les voir hors connexion
  if (url.hostname === "upload.wikimedia.org" || url.pathname.startsWith("/api/rest_v1/page/summary/")) {
    e.respondWith(caches.open(PHOTO_CACHE).then(async cache => {
      const hit = await cache.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok || res.type === "opaque") cache.put(e.request, res.clone());
      return res;
    }));
    return;
  }

  // Tuiles de carte : cache d'abord
  if (/tile|arcgisonline/.test(url.hostname)) {
    e.respondWith(caches.open(TILE_CACHE).then(async cache => {
      const hit = await cache.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok || res.type === "opaque") { cache.put(e.request, res.clone()); trimTiles(); }
      return res;
    }));
    return;
  }

  // Application : réseau d'abord, cache en secours
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
          return res;
        })
        .catch(() => caches.match(e.request, { ignoreSearch: true }))
    );
  }
});
