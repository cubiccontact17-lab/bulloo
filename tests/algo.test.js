// Tests : node --test tests/
const test = require("node:test");
const assert = require("node:assert");
const { SPECIES, ZONES, FICHES } = require("../js/data.js");
const { scoreSpecies, weatherSummary, levelFor } = require("../js/algo.js");

const { DEPARTEMENTS } = require("../js/departements.js");

function inRing(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i], [yj, xj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function makeWeather(days, { t = 15, rain = 3, rh = 90, tmin } = {}) {
  return {
    tmax: Array(days).fill(t + 4),
    tmin: Array(days).fill(tmin ?? t - 4),
    precip: Array(days).fill(rain),
    rh: Array(days).fill(rh)
  };
}

const mervent = ZONES.find(z => z.id === "mervent");
const cepe = SPECIES.find(s => s.id === "cepe");

test("chaque secteur est dans son département (85 ou 17)", () => {
  for (const z of ZONES) {
    const dep = DEPARTEMENTS.find(d => d.code === z.dept);
    assert.ok(dep, `${z.name} : département inconnu`);
    assert.ok(dep.rings.some(r => inRing(z.lat, z.lon, r)), `${z.name} hors ${dep.name}`);
  }
});

test("identifiants uniques et couleurs distinctes", () => {
  assert.strictEqual(new Set(SPECIES.map(s => s.id)).size, SPECIES.length);
  assert.strictEqual(new Set(SPECIES.map(s => s.color)).size, SPECIES.length);
  assert.strictEqual(new Set(ZONES.map(z => z.id)).size, ZONES.length);
});

test("chaque espèce a au moins un secteur compatible", () => {
  for (const s of SPECIES) assert.ok(ZONES.some(z => s.habitats.some(h => z.habitats.includes(h))), s.name);
});

test("conditions idéales en octobre → cèpe excellent", () => {
  const w = makeWeather(30);
  const r = scoreSpecies(cepe, mervent, weatherSummary(w, 21), 10);
  assert.ok(r.score >= 80, `score ${r.score}`);
  assert.strictEqual(levelFor(r.score).label, "Excellent");
});

test("sécheresse → score faible", () => {
  const w = makeWeather(30, { rain: 0, rh: 60 });
  const r = scoreSpecies(cepe, mervent, weatherSummary(w, 21), 10);
  assert.ok(r.score < 15, `score ${r.score}`);
});

test("hors saison → 0", () => {
  const w = makeWeather(30);
  assert.strictEqual(scoreSpecies(cepe, mervent, weatherSummary(w, 21), 3).score, 0);
});

test("habitat absent → 0 (lactaire hors pinède)", () => {
  const lactaire = SPECIES.find(s => s.id === "lactaire");
  const w = makeWeather(30);
  assert.strictEqual(scoreSpecies(lactaire, mervent, weatherSummary(w, 21), 10).score, 0);
});

test("gel → pénalité", () => {
  const ok = scoreSpecies(cepe, mervent, weatherSummary(makeWeather(30, { t: 12 }), 21), 10).score;
  const gel = scoreSpecies(cepe, mervent, weatherSummary(makeWeather(30, { t: 12, tmin: -2 }), 21), 10).score;
  assert.ok(gel < ok);
});

test("trop chaud → score réduit", () => {
  const w = makeWeather(30, { t: 28 });
  const r = scoreSpecies(cepe, mervent, weatherSummary(w, 21), 9);
  assert.ok(r.score < 40, `score ${r.score}`);
});

test("chaque espèce a une fiche complète", () => {
  for (const s of SPECIES) {
    const f = FICHES[s.id];
    assert.ok(f, `fiche manquante : ${s.name}`);
    for (const k of ["wiki", "size", "ident", "milieu", "cuisine"]) assert.ok(f[k], `${s.name} : ${k}`);
  }
});

test("amanite des Césars : espèce rare, score plafonné même en conditions idéales", () => {
  const cesar = SPECIES.find(s => s.id === "cesar");
  const w = makeWeather(30, { t: 22, rain: 4 });
  const r = scoreSpecies(cesar, mervent, weatherSummary(w, 21), 8);
  assert.ok(r.score > 0 && r.score <= 60, `score ${r.score}`);
  assert.ok(FICHES.cesar.expertNote);
});
