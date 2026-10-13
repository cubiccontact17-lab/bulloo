// Algorithme de probabilité de pousse.
//
// Les champignons fructifient en général 7 à 14 jours après une bonne pluie,
// si la température reste dans leur plage et que l'air reste humide.
// Pour un jour cible T (aujourd'hui ou une prévision) on calcule :
//
//   pluie      : cumul des pluies de T-14 à T-3 (+30 % des pluies de T-2 à T)
//                comparé au besoin de l'espèce (rainMin)
//   température: moyenne (min+max)/2 des 7 derniers jours, notée selon la
//                plage [min, optimum bas, optimum haut, max] de l'espèce
//   humidité   : humidité relative moyenne des 7 derniers jours (55 % → 0, 85 % → 1)
//   gel        : pénalité par jour de gel sur les 5 derniers jours
//   sécheresse : pénalité si ni pluie ni humidité sur les 5 derniers jours
//   saison     : poids mensuel de l'espèce
//   habitat    : l'espèce doit trouver son habitat dans le secteur
//   abondance  : plafond pour les espèces rares dans la région
//
// Le score final (0 → 100) combine ces facteurs de façon à ce qu'un facteur
// limitant (pas de pluie, trop froid…) fasse chuter la note.

const LEVELS = [
  { min: 80, label: "Excellent", cls: "lvl-5" },
  { min: 60, label: "Bon", cls: "lvl-4" },
  { min: 35, label: "Moyen", cls: "lvl-3" },
  { min: 15, label: "Faible", cls: "lvl-2" },
  { min: 0, label: "Nul", cls: "lvl-1" }
];

function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

function trapezoid(x, [a, b, c, d]) {
  if (x <= a || x >= d) return 0;
  if (x >= b && x <= c) return 1;
  return x < b ? (x - a) / (b - a) : (d - x) / (d - c);
}

function sumRange(arr, from, to) {
  let s = 0;
  for (let i = Math.max(0, from); i <= Math.min(arr.length - 1, to); i++) s += arr[i] || 0;
  return s;
}

function meanRange(arr, from, to) {
  let s = 0, n = 0;
  for (let i = Math.max(0, from); i <= Math.min(arr.length - 1, to); i++) {
    if (arr[i] != null) { s += arr[i]; n++; }
  }
  return n ? s / n : null;
}

// Résumé météo d'un secteur pour l'indice de jour t.
// w = { tmax:[], tmin:[], precip:[], rh:[] } (tableaux journaliers)
function weatherSummary(w, t) {
  const tmean = w.tmax.map((v, i) => (v != null && w.tmin[i] != null ? (v + w.tmin[i]) / 2 : null));
  let frostDays = 0;
  for (let i = t - 4; i <= t; i++) if (w.tmin[i] != null && w.tmin[i] < 0) frostDays++;
  return {
    rainLag: sumRange(w.precip, t - 14, t - 3),
    rainRecent: sumRange(w.precip, t - 2, t),
    rain5: sumRange(w.precip, t - 4, t),
    temp7: meanRange(tmean, t - 6, t),
    hum7: meanRange(w.rh, t - 6, t),
    frostDays
  };
}

function habitatMatch(species, zone) {
  return species.habitats.some(h => zone.habitats.includes(h));
}

// Retourne { score (0-100), factors } pour une espèce, un secteur, un résumé météo et un mois.
function scoreSpecies(species, zone, ws, month) {
  const season = species.season[month] || 0;
  if (!habitatMatch(species, zone) || season === 0) {
    return { score: 0, factors: { season, habitat: habitatMatch(species, zone) ? 1 : 0 } };
  }
  const rainEff = ws.rainLag + 0.3 * ws.rainRecent;
  const rain = clamp(rainEff / species.rainMin, 0, 1);
  const temp = ws.temp7 == null ? 0.5 : trapezoid(ws.temp7, species.temp);
  const hum = ws.hum7 == null ? 0.5 : clamp((ws.hum7 - 55) / 30, 0, 1);
  const frost = clamp(1 - ws.frostDays * (species.frostTolerant || species.temp[0] <= 2 ? 0.1 : 0.25), 0.2, 1);
  const dry = ws.rain5 < 1 && ws.hum7 != null && ws.hum7 < 70 ? 0.7 : 1;

  const core = 0.45 * rain + 0.35 * temp + 0.2 * hum;
  const limiter = Math.min(rain, temp);
  // abondance : espèces rares dans la région (ex. amanite des Césars) plafonnées
  const abundance = species.abundance == null ? 1 : species.abundance;
  const score = Math.round(100 * season * frost * dry * core * (0.4 + 0.6 * limiter) * abundance);
  return { score, factors: { season, habitat: 1, rain, temp, hum, frost, dry } };
}

function levelFor(score) {
  return LEVELS.find(l => score >= l.min);
}

if (typeof module !== "undefined") {
  module.exports = { scoreSpecies, weatherSummary, levelFor, trapezoid, habitatMatch, LEVELS };
}
