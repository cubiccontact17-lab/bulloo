// Tests des coins, de l'apprentissage et des alertes : node --test tests/*.test.js
const test = require("node:test");
const assert = require("node:assert");
const data = require("../js/data.js");
const algo = require("../js/algo.js");
Object.assign(global, data, algo); // user.js utilise ces fonctions comme globales (navigateur)
const user = require("../js/user.js");

const days = 29;
function fakeWeather({ t = 15, rain = 3, rh = 90 } = {}) {
  const today = new Date();
  const time = [...Array(days)].map((_, i) => {
    const d = new Date(today); d.setDate(d.getDate() - 21 + i);
    return user.todayStr(d);
  });
  return data.ZONES.map(() => ({
    time,
    tmax: Array(days).fill(t + 4), tmin: Array(days).fill(t - 4),
    precip: Array(days).fill(rain), rh: Array(days).fill(rh)
  }));
}

const coin = { id: "c1", name: "Mon coin", lat: 46.53, lon: -0.77, species: ["cepe", "girolle"] };

test("un coin prend la météo du secteur le plus proche et ses seules espèces", () => {
  assert.strictEqual(data.ZONES[user.nearestZoneIndex(coin)].id, "mervent");
  const r = user.evaluateCoin(coin, fakeWeather(), 21, null);
  assert.deepStrictEqual(r.scores.map(s => s.species.id).sort(), ["cepe", "girolle"]);
});

test("sans sortie, aucun ajustement", () => {
  const calib = user.fitCalibration([]);
  assert.strictEqual(user.calibrateScore(70, "cepe", "coin:c1", calib), 70);
});

test("des sorties bredouilles rendent l'algorithme plus prudent", () => {
  const obs = [1, 2, 3, 4].map(i => ({ id: "o" + i, date: "2026-10-0" + i, place: "coin:c1", species: "cepe", found: false, raw: 80 }));
  const calib = user.fitCalibration(obs);
  const adj = user.calibrateScore(80, "cepe", "coin:c1", calib);
  assert.ok(adj < 60, `ajusté ${adj}`);
  // une autre espèce ailleurs n'est presque pas touchée
  assert.strictEqual(user.calibrateScore(80, "girolle", "zone:aizenay", calib), 80);
});

test("des trouvailles inattendues rendent l'algorithme plus optimiste", () => {
  const obs = [1, 2, 3].map(i => ({ id: "o" + i, date: "2026-10-0" + i, place: "zone:olonne", species: "lactaire", found: true, raw: 30 }));
  const calib = user.fitCalibration(obs);
  assert.ok(user.calibrateScore(30, "lactaire", "zone:olonne", calib) > 45);
});

test("trouvé fait monter l'espèce, rien la fait baisser, au même endroit", () => {
  const obs = [
    { id: "a", date: "2026-10-10", place: "coin:c1", species: "cepe", found: false, raw: 76 },
    { id: "b", date: "2026-10-10", place: "coin:c1", species: "girolle", found: true, raw: 80 }
  ];
  const calib = user.fitCalibration(obs);
  assert.ok(user.calibrateScore(80, "girolle", "coin:c1", calib) > 80);
  assert.ok(user.calibrateScore(76, "cepe", "coin:c1", calib) < 76);
});

test("une seule sortie ne bouleverse pas tout", () => {
  const calib = user.fitCalibration([{ id: "o", date: "2026-10-01", place: "coin:c1", species: "cepe", found: false, raw: 80 }]);
  const adj = user.calibrateScore(80, "cepe", "coin:c1", calib);
  assert.ok(adj > 50 && adj < 80, `ajusté ${adj}`);
});

test("alertes : coin favorable signalé une fois, au meilleur jour", () => {
  const alerts = user.computeAlerts({ weather: fakeWeather(), coins: [coin], calib: null,
    settings: { enabled: true, threshold: 60, coins: true, zones: false, species: ["cepe", "girolle"] } });
  assert.ok(alerts.length >= 1);
  assert.ok(alerts.every(a => a.kind === "coin" && a.score >= 60));
  assert.strictEqual(new Set(alerts.map(a => a.speciesId)).size, alerts.length);
});

test("alertes : rien quand il fait sec", () => {
  const alerts = user.computeAlerts({ weather: fakeWeather({ rain: 0, rh: 55 }), coins: [coin], calib: null,
    settings: { enabled: true, threshold: 60, coins: true, zones: true, species: data.SPECIES.map(s => s.id) } });
  assert.strictEqual(alerts.length, 0);
});

test("alertes : seules les espèces surveillées", () => {
  const alerts = user.computeAlerts({ weather: fakeWeather(), coins: [coin], calib: null,
    settings: { threshold: 60, coins: true, zones: true, species: ["lactaire"] } });
  assert.ok(alerts.length > 0 && alerts.every(a => a.speciesId === "lactaire"));
});

test("météo : Météo-France en priorité, complété par le modèle par défaut", () => {
  const time = ["2026-10-10", "2026-10-11", "2026-10-12"];
  const daily = { time };
  ["temperature_2m_max", "temperature_2m_min", "precipitation_sum", "relative_humidity_2m_mean"].forEach(v => {
    daily[`${v}_meteofrance_seamless`] = [1, 2, null];
    daily[`${v}_best_match`] = [10, 20, 30];
  });
  const [w] = user.parseWeather([{ daily }]);
  assert.deepStrictEqual(w.precip, [1, 2, 30]);
  assert.deepStrictEqual(w.tmax, [1, 2, 30]);
  assert.strictEqual(w.mfDays, 2);
});

test("météo : réponse sans modèle (format simple) toujours lue", () => {
  const [w] = user.parseWeather({ daily: { time: ["2026-10-10"], temperature_2m_max: [12], temperature_2m_min: [5], precipitation_sum: [3], relative_humidity_2m_mean: [90] } });
  assert.deepStrictEqual([w.tmax[0], w.tmin[0], w.precip[0], w.rh[0], w.mfDays], [12, 5, 3, 90, 0]);
});

test("météo : l'adresse demande Météo-France et les coins au point exact", () => {
  const url = user.weatherUrl([...data.ZONES, { lat: 46.1236, lon: -1.2347 }], "meteofrance_seamless,best_match");
  assert.ok(url.includes("models=meteofrance_seamless,best_match"));
  assert.ok(url.includes("46.1236") && url.includes("-1.2347"));
});

test("un coin avec sa propre météo l'utilise plutôt que celle du secteur", () => {
  const zones = fakeWeather();
  const dry = fakeWeather({ rain: 0, rh: 55 })[0];
  const sec = user.evaluateCoin(coin, zones, 21, null);
  const own = user.evaluateCoin(coin, zones, 21, null, { c1: dry });
  assert.strictEqual(sec.precise, false);
  assert.strictEqual(own.precise, true);
  assert.ok(own.scores[0].score < sec.scores[0].score);
});

test("carte forestière : essences traduites en milieux", () => {
  const h = p => user.habitatsFromForest(p).sort();
  assert.deepStrictEqual(h({ tfv: "Forêt fermée de chênes décidus purs", essence: "Chênes décidus" }), ["chenes", "feuillus"]);
  assert.deepStrictEqual(h({ tfv: "Forêt fermée de pin maritime pur", essence: "Pin maritime" }), ["pins"]);
  assert.deepStrictEqual(h({ tfv: "Forêt fermée de châtaignier pur" }), ["chataigniers", "feuillus"]);
  assert.deepStrictEqual(h({ tfv: "Forêt fermée à mélange de feuillus prépondérants et conifères" }), ["feuillus", "pins"]);
  assert.deepStrictEqual(h({ tfv: "Peupleraie" }), ["boismort", "feuillus"]);
  assert.deepStrictEqual(h({ tfv: "Forêt fermée sans couvert arboré", essence: "NR" }), ["lisiere"]);
  const ids = user.speciesForHabitats(["pins"]).map(s => s.id);
  assert.ok(ids.includes("lactaire") && !ids.includes("rose"));
});
