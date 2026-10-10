// Fonctions partagées entre l'application et le service worker :
// météo, mes coins, apprentissage à partir des sorties, alertes.
// Dépend de SPECIES / ZONES (data.js) et de scoreSpecies / weatherSummary (algo.js).

const PAST_DAYS = 21;
const FORECAST_DAYS = 8;
const DATA_CACHE = "champi-data";      // copie des données utilisateur lisible par le service worker
const ALERT_HORIZON = 3;               // aujourd'hui + 3 jours

// ---------- Météo ----------
function weatherUrl() {
  const lats = ZONES.map(z => z.lat.toFixed(3)).join(",");
  const lons = ZONES.map(z => z.lon.toFixed(3)).join(",");
  return "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${lats}&longitude=${lons}` +
    "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,relative_humidity_2m_mean" +
    `&past_days=${PAST_DAYS}&forecast_days=${FORECAST_DAYS}&timezone=Europe%2FParis`;
}

function parseWeather(json) {
  const arr = Array.isArray(json) ? json : [json];
  return arr.map(r => ({
    time: r.daily.time,
    tmax: r.daily.temperature_2m_max,
    tmin: r.daily.temperature_2m_min,
    precip: r.daily.precipitation_sum,
    rh: r.daily.relative_humidity_2m_mean
  }));
}

// Date du jour en France (YYYY-MM-DD)
function todayStr(d) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(d || new Date());
}

function todayIndex(weather) {
  const idx = weather[0].time.indexOf(todayStr());
  return idx >= 0 ? idx : PAST_DAYS;
}

function monthOf(weather, t) {
  return Number(weather[0].time[t].slice(5, 7));
}

// ---------- Lieux : secteurs et coins personnels ----------
function distKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Un coin utilise la météo du secteur le plus proche
function nearestZoneIndex(p) {
  let best = 0, bd = Infinity;
  ZONES.forEach((z, i) => { const d = distKm(p, z); if (d < bd) { bd = d; best = i; } });
  return best;
}

// Habitat d'un coin = celui des espèces que l'on y a notées
function coinAsZone(coin) {
  const habitats = new Set();
  coin.species.forEach(id => {
    const sp = SPECIES.find(s => s.id === id);
    if (sp) sp.habitats.forEach(h => habitats.add(h));
  });
  return { id: coin.id, name: coin.name, lat: coin.lat, lon: coin.lon, habitats: [...habitats] };
}

const placeKey = (kind, id) => `${kind}:${id}`;

// ---------- Apprentissage ----------
// Petite régression logistique : un biais par espèce (partout) et un biais
// par espèce dans chaque lieu,
// appris à partir des sorties (trouvé / rien trouvé) et du score prévu ce jour-là.
// Le biais décale la probabilité en échelle logit ; une pénalité le garde
// proche de 0 tant qu'il y a peu de sorties.
function logit(p) { return Math.log(p / (1 - p)); }
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

function fitCalibration(observations) {
  const calib = { species: {}, place: {}, count: {}, total: 0 };
  const obs = (observations || []).filter(o => o && typeof o.raw === "number");
  if (!obs.length) return calib;
  const lambda = 1.0, lr = 0.15, iters = 400, maxB = 2.5;
  for (let it = 0; it < iters; it++) {
    const gs = {}, gp = {};
    for (const o of obs) {
      const p0 = Math.min(0.97, Math.max(0.03, o.raw / 100));
      const lk = o.place + "|" + o.species;
      const p = sigmoid(logit(p0) + (calib.species[o.species] || 0) + (calib.place[lk] || 0));
      const g = (o.found ? 1 : 0) - p;
      gs[o.species] = (gs[o.species] || 0) + g;
      gp[lk] = (gp[lk] || 0) + g;
    }
    for (const k in gs) {
      const b = calib.species[k] || 0;
      calib.species[k] = Math.max(-maxB, Math.min(maxB, b + lr * (gs[k] - lambda * b)));
    }
    for (const k in gp) {
      const b = calib.place[k] || 0;
      calib.place[k] = Math.max(-maxB, Math.min(maxB, b + lr * (gp[k] - lambda * b)));
    }
  }
  obs.forEach(o => { calib.count[o.species] = (calib.count[o.species] || 0) + 1; });
  calib.total = obs.length;
  return calib;
}

function calibrateScore(raw, speciesId, place, calib) {
  if (!raw || !calib) return raw;
  const b = (calib.species[speciesId] || 0) + (calib.place[place + "|" + speciesId] || 0);
  if (Math.abs(b) < 1e-3) return raw;
  const p0 = Math.min(0.99, Math.max(0.01, raw / 100));
  return Math.round(100 * sigmoid(logit(p0) + b));
}

// ---------- Évaluation d'un lieu ----------
// zoneLike : objet avec habitats ; ws : résumé météo ; place : clé du lieu
function scorePlace(zoneLike, ws, month, place, calib, onlySpecies) {
  return SPECIES
    .filter(sp => !onlySpecies || onlySpecies.includes(sp.id))
    .map(sp => {
      const r = scoreSpecies(sp, zoneLike, ws, month);
      return { species: sp, raw: r.score, score: calibrateScore(r.score, sp.id, place, calib), factors: r.factors };
    })
    .sort((a, b) => b.score - a.score);
}

function evaluateCoin(coin, weather, t, calib) {
  const zi = nearestZoneIndex(coin);
  const ws = weatherSummary(weather[zi], t);
  const scores = scorePlace(coinAsZone(coin), ws, monthOf(weather, t), placeKey("coin", coin.id), calib, coin.species);
  return { coin, zone: ZONES[zi], ws, scores };
}

function evaluateZone(i, weather, t, calib) {
  const zone = ZONES[i];
  const ws = weatherSummary(weather[i], t);
  return { zone, ws, scores: scorePlace(zone, ws, monthOf(weather, t), placeKey("zone", zone.id), calib) };
}

// ---------- Alertes ----------
const DEFAULT_ALERTS = {
  enabled: false,
  threshold: 60,
  coins: true,
  zones: false,
  species: SPECIES.map(s => s.id)
};

// Meilleur jour (aujourd'hui → +3 j) par lieu et par espèce au-dessus du seuil
function computeAlerts({ weather, coins, calib, settings }) {
  const s = Object.assign({}, DEFAULT_ALERTS, settings || {});
  const t0 = todayIndex(weather);
  const best = {};
  const consider = (kind, id, name, scores, d, date) => {
    scores.forEach(x => {
      if (!s.species.includes(x.species.id) || x.score < s.threshold) return;
      const k = `${kind}:${id}|${x.species.id}`;
      if (!best[k] || x.score > best[k].score) {
        best[k] = { key: `${k}|${date}`, kind, id, name, speciesId: x.species.id, speciesName: x.species.name, score: x.score, day: d, date };
      }
    });
  };
  for (let d = 0; d <= ALERT_HORIZON && t0 + d < weather[0].time.length; d++) {
    const t = t0 + d, date = weather[0].time[t];
    if (s.coins) (coins || []).forEach(c => consider("coin", c.id, c.name, evaluateCoin(c, weather, t, calib).scores, d, date));
    if (s.zones) ZONES.forEach((z, i) => consider("zone", z.id, z.name, evaluateZone(i, weather, t, calib).scores, d, date));
  }
  return Object.values(best).sort((a, b) => b.score - a.score || a.day - b.day);
}

function dayLabel(d, date) {
  if (d === 0) return "aujourd'hui";
  if (d === 1) return "demain";
  return new Date(date + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long" });
}

function alertLine(a) {
  return `${a.speciesName} · ${a.name} · ${a.score} % ${dayLabel(a.day, a.date)}`;
}

// ---------- Stockage partagé avec le service worker (Cache API) ----------
async function readShared(name) {
  try {
    const cache = await caches.open(DATA_CACHE);
    const res = await cache.match("./" + name);
    return res ? await res.json() : null;
  } catch (e) { return null; }
}

async function writeShared(name, value) {
  try {
    const cache = await caches.open(DATA_CACHE);
    await cache.put("./" + name, new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } }));
  } catch (e) { /* Cache API indisponible */ }
}

// Envoie une notification groupée pour les alertes pas encore signalées.
// Retourne les alertes nouvelles.
async function notifyNew(registration, alerts) {
  const notified = (await readShared("notified.json")) || {};
  const fresh = alerts.filter(a => !notified[a.key]);
  if (!fresh.length) return [];
  const now = Date.now();
  fresh.forEach(a => { notified[a.key] = now; });
  // on oublie les alertes de plus de 10 jours
  for (const k in notified) if (now - notified[k] > 10 * 864e5) delete notified[k];
  await writeShared("notified.json", notified);
  if (registration && typeof Notification !== "undefined" && Notification.permission === "granted") {
    const top = fresh.slice(0, 4).map(alertLine).join("\n");
    await registration.showNotification(
      fresh.length > 1 ? `🍄 ${fresh.length} coins favorables` : `🍄 ${fresh[0].speciesName} : conditions favorables`,
      { body: top, icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: "champi-alertes", data: { url: "./#alertes" } }
    );
  }
  return fresh;
}

if (typeof module !== "undefined") {
  module.exports = {
    fitCalibration, calibrateScore, computeAlerts, coinAsZone, nearestZoneIndex,
    evaluateCoin, evaluateZone, parseWeather, todayStr, placeKey, DEFAULT_ALERTS
  };
}
