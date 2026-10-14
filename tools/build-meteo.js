// Prépare la météo des secteurs pour le site : data/meteo.json
// Lancé toutes les 3 heures par le workflow de publication (GitHub Actions).
// L'appli lit ce fichier au lieu d'interroger Open-Meteo depuis chaque téléphone.
const fs = require("fs");
const path = require("path");
const data = require("../js/data.js");
const algo = require("../js/algo.js");
Object.assign(global, data, algo);
const user = require("../js/user.js");

(async () => {
  let r = null;
  for (let attempt = 1; attempt <= 3 && !r; attempt++) {
    try { r = await user.fetchPoints(data.ZONES); }
    catch (e) {
      console.log(`Essai ${attempt} raté : ${e.message}`);
      if (attempt < 3) await new Promise(ok => setTimeout(ok, 20000 * attempt));
    }
  }
  if (!r) { console.log("Météo non préparée : l'appli interrogera Open-Meteo directement."); return; }
  const out = { at: new Date().toISOString(), source: r.source, zones: r.data };
  const file = path.join(__dirname, "..", "data", "meteo.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out));
  console.log(`data/meteo.json : ${r.data.length} secteurs, source ${r.source}, ${fs.statSync(file).size} octets`);
})();
