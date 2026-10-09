// Tests : node --test tests/
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { SPECIES, ZONES } = require("../js/data.js");
const { scoreSpecies, weatherSummary, levelFor } = require("../js/algo.js");

const outline = new Function(fs.readFileSync(path.join(__dirname, "../js/vendee.js"), "utf8") + "; return VENDEE_OUTLINE;")();

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

test("tous les secteurs sont en Vendée", () => {
  for (const z of ZONES) {
    assert.ok(outline.some(r => inRing(z.lat, z.lon, r)), `${z.name} hors Vendée`);
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
