// Test de l'appli dans un vrai navigateur, avec les vraies données (météo, IGN).
// Lancé par le workflow « Tester l'appli en conditions réelles ».
const { chromium, devices } = require("playwright");
const fs = require("fs");
const OUT = process.argv[2] || "captures";
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices["Pixel 7"], locale: "fr-FR", timezoneId: "Europe/Paris" });
  const page = await ctx.newPage();
  const errors = [], wfs = [];
  page.on("pageerror", e => errors.push("JS : " + e.message));
  page.on("console", m => { if (m.type() === "error") errors.push("console : " + m.text()); });
  page.on("response", async r => {
    if (r.url().includes("/wfs")) wfs.push(`${r.status()} ${(await r.body().catch(() => "")).length} octets`);
  });
  page.on("requestfailed", r => {
    if (r.url().includes("/wmts")) return; // tuiles annulées pendant les déplacements : normal
    errors.push("échec réseau : " + r.url() + " " + (r.failure() || {}).errorText);
  });
  page.on("response", r => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} : ${r.url()}`); });

  await page.goto("http://localhost:8080/");
  await page.waitForFunction(() => !/Chargement/.test(document.querySelector("#subtitle").textContent), null, { timeout: 30000 });
  console.log("Sous-titre :", await page.textContent("#subtitle"));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/1-accueil.png` });
  console.log("Bandeau :", await page.locator("#woods-hint").isVisible() ? await page.textContent("#woods-hint") : "(caché)");

  for (const [i, name] of [["2", "Forêt d'Aizenay"], ["3", "Forêt de Mervent-Vouvant (sud)"], ["4", "Forêt de la Coubre (La Tremblade)"]]) {
    await page.click("#sheet-close").catch(() => {});
    await page.evaluate(() => { const s = document.querySelector("#sheet"); if (s) s.hidden = true; const b = document.querySelector("#sheet-backdrop"); if (b) b.hidden = true; });
    const marker = page.locator(`.leaflet-marker-icon[title="${name}"]`);
    if (!(await marker.count())) { console.log(name, ": marqueur introuvable"); continue; }
    await marker.first().evaluate(el => el.click());
    await page.waitForSelector("#zone-woods", { timeout: 5000 });
    console.log(name, "· météo :", (await page.textContent(".source").catch(() => "?")).trim());
    await page.click("#zone-woods");
    const before = wfs.length;
    await page.waitForTimeout(9000);
    const dots = await page.locator(".zone-dots.wood").count();
    console.log(`${name} : ${wfs.length - before} requêtes bois (${wfs.slice(before).join(", ")}), ${dots} parcelles avec pastilles, bandeau : ${await page.locator("#woods-hint").isVisible() ? await page.textContent("#woods-hint") : "(caché)"}`);
    await page.screenshot({ path: `${OUT}/${i}-bois.png` });
  }
  // vue rapprochée : noms des champignons sur les parcelles
  await page.click("#sheet-close").catch(() => {});
  await page.locator(".leaflet-control-zoom-in").click();
  await page.waitForTimeout(800);
  await page.locator(".leaflet-control-zoom-in").click();
  await page.waitForTimeout(4000);
  console.log("Vue rapprochée :", await page.locator(".wood-label").count(), "étiquettes avec nom, exemple :",
    (await page.locator(".wood-label").first().textContent().catch(() => "-")).trim());
  await page.screenshot({ path: `${OUT}/6-noms.png` });
  // fiche d'un bois
  const dot = page.locator(".zone-dots.wood").first();
  if (await dot.count()) {
    await dot.evaluate(el => el.closest(".leaflet-marker-icon").click());
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/5-fiche-bois.png` });
    console.log("Fiche bois :", (await page.textContent("#sheet-content")).replace(/\s+/g, " ").slice(0, 200));
  }
  console.log("Erreurs :", errors.length ? "\n  " + errors.join("\n  ") : "aucune");
  await browser.close();
})().catch(e => { console.error("Échec du test :", e); process.exit(1); });
