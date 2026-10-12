// Contrôle de la météo réelle avec le code de l'appli : node tools/verifier-meteo.js
// Vérifie que Météo-France répond, que les données ne sont pas trouées,
// et compare la pluie des 15 derniers jours avec le modèle par défaut.
const data = require("../js/data.js");
const algo = require("../js/algo.js");
Object.assign(global, data, algo);
const user = require("../js/user.js");
const { ZONES } = data;

const fmt = x => (x == null ? "  –  " : x.toFixed(1).padStart(5));
let problems = 0;
const warn = msg => { problems++; console.log("⚠ " + msg); };

(async () => {
  const coin = { id: "test", lat: 46.5, lon: -0.78, species: ["cepe"] };
  const w = await user.fetchWeather([coin]);
  const t0 = user.todayStr();
  const ti = w.zones[0].time.indexOf(t0);
  console.log(`Source retenue : ${w.source} · ${w.zones[0].time.length} jours · aujourd'hui = ${t0} (index ${ti})`);
  if (w.source !== "meteofrance") warn("Météo-France n'a pas été utilisé.");
  if (ti < 0) warn("La date du jour est absente des données.");

  // Trous dans les données utiles à l'algorithme (J-14 → J+7)
  console.log("\nSecteur                                   MF jours  trous(tmax,tmin,pluie,hum)");
  [...w.zones.map((z, i) => [ZONES[i].name, z]), ["Coin test (Mervent)", w.coinWeather.test]].forEach(([name, z]) => {
    const holes = ["tmax", "tmin", "precip", "rh"].map(k => z[k].slice(Math.max(0, ti - 14)).filter(v => v == null).length);
    console.log(`${name.slice(0, 40).padEnd(42)}${String(z.mfDays).padStart(6)}    ${holes.join(", ")}`);
    if (holes.some(h => h > 0)) warn(`${name} : données manquantes ${holes.join(", ")}`);
  });

  // Détail jour par jour pour un secteur
  const z = w.zones[0];
  console.log(`\nDétail ${ZONES[0].name} (Météo-France prioritaire) :`);
  console.log("date        tmin   tmax  pluie  hum%");
  for (let i = Math.max(0, ti - 14); i < z.time.length; i++) {
    console.log(`${z.time[i]}${i === ti ? "*" : " "} ${fmt(z.tmin[i])} ${fmt(z.tmax[i])} ${fmt(z.precip[i])} ${fmt(z.rh[i])}`);
  }

  // Comparaison avec le modèle par défaut seul (pluie J-14 → J)
  const res = await fetch(user.weatherUrl(ZONES, null));
  const def = user.parseWeather(await res.json());
  console.log("\nPluie cumulée des 15 derniers jours (mm) : Météo-France / modèle par défaut");
  ZONES.forEach((zone, i) => {
    const sum = arr => arr.slice(ti - 14, ti + 1).reduce((a, b) => a + (b || 0), 0);
    const a = sum(w.zones[i].precip), b = sum(def[i].precip);
    console.log(`${zone.name.slice(0, 40).padEnd(42)}${a.toFixed(1).padStart(6)} / ${b.toFixed(1).padStart(6)}`);
  });

  console.log(problems ? `\n${problems} problème(s) détecté(s).` : "\n✓ Aucun problème détecté.");
  process.exit(problems ? 1 : 0);
})().catch(e => { console.error("Échec :", e.message); process.exit(1); });
