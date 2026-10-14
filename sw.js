// Service worker : application utilisable hors connexion
// (avec la dernière météo connue et les tuiles de carte déjà vues).
const VERSION = "champi-v10";
const SHELL = [
  "./",
  "index.html",
  "css/style.css",
  "js/app.js",
  "js/algo.js",
  "js/user.js",
  "js/data.js",
  "js/departements.js",
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
const WOODS_CACHE = "champi-bois";
const MAX_WOODS = 80;
const MAX_TILES = 1500;

// Données et algorithme partagés avec l'application (définit DATA_CACHE, computeAlerts…)
importScripts("js/data.js", "js/algo.js", "js/user.js");

// Vérification des alertes en arrière-plan (Android, appli installée)
async function backgroundCheck() {
  const data = await readShared("user-data.json");
  if (!data || !data.alertSettings || !data.alertSettings.enabled) return;
  const w = await fetchWeather(data.coins || []);
  const alerts = computeAlerts({
    weather: w.zones,
    coinWeather: w.coinWeather,
    coins: data.coins || [],
    calib: fitCalibration(data.observations || []),
    settings: data.alertSettings
  });
  await notifyNew(self.registration, alerts);
}

self.addEventListener("periodicsync", e => {
  if (e.tag === "champi-alertes") e.waitUntil(backgroundCheck().catch(() => {}));
});

// Toucher la notification ouvre l'appli sur la liste des alertes
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) if ("focus" in c) { c.navigate(target).catch(() => {}); return c.focus(); }
    return self.clients.openWindow(target);
  }));
});

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== TILE_CACHE && k !== PHOTO_CACHE && k !== WOODS_CACHE && k !== DATA_CACHE).map(k => caches.delete(k))))
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

  // Contours des bois (WFS) : réseau d'abord, copie gardée pour la forêt sans réseau.
  // La mise en cache ne doit jamais faire échouer la requête.
  if (url.hostname === "data.geopf.fr" && url.pathname.startsWith("/wfs")) {
    e.respondWith((async () => {
      try {
        const res = await fetch(e.request);
        if (res.ok) {
          const copy = res.clone();
          e.waitUntil((async () => {
            try {
              const cache = await caches.open(WOODS_CACHE);
              await cache.put(e.request, copy);
              const keys = await cache.keys();
              for (let i = 0; i < keys.length - MAX_WOODS; i++) await cache.delete(keys[i]);
            } catch (err) { /* cache plein ou indisponible : sans importance */ }
          })());
        }
        return res;
      } catch (err) {
        const hit = await caches.match(e.request);
        if (hit) return hit;
        throw err;
      }
    })());
    return;
  }

  // Interrogation de la carte forestière : toujours le réseau
  if (url.searchParams.get("REQUEST") === "GetFeatureInfo") return;

  // Tuiles de carte (IGN, OpenStreetMap…) : cache d'abord
  if (/tile|arcgisonline|geopf\.fr/.test(url.hostname)) {
    e.respondWith(caches.open(TILE_CACHE).then(async cache => {
      const hit = await cache.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok || res.type === "opaque") { cache.put(e.request, res.clone()); trimTiles(); }
      return res;
    }));
    return;
  }

  // Application : réseau d'abord (en revalidant, pour ne jamais mélanger deux versions), cache en secours
  if (url.origin === self.location.origin) {
    e.respondWith(
      (e.request.mode === "navigate" ? fetch(e.request) : fetch(url.href, { cache: "no-cache", credentials: "same-origin" }))
        .then(res => {
          if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
          return res;
        })
        .catch(() => caches.match(e.request, { ignoreSearch: true }))
    );
  }
});
