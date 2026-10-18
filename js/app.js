(function () {
  "use strict";

  const CACHE_KEY = "champi-meteo-v2";
  const CACHE_TTL = 60 * 60 * 1000; // 1 h
  const MIN_SHOWN = 15;             // score minimum pour afficher une espèce
  const PREFS_KEY = "champi-prefs-v1";
  const COINS_KEY = "champi-coins-v1";
  const OBS_KEY = "champi-sorties-v1";
  const ALERTS_KEY = "champi-alertes-v1";
  const MAP_KEY = "champi-carte-v2";

  const state = {
    day: 0,
    enabled: new Set(SPECIES.map(s => s.id)),
    weather: null,   // tableau par secteur : { time, tmax, tmin, precip, rh }
    todayIdx: PAST_DAYS,
    fetchedAt: null,
    results: [],     // par secteur : { zone, ws, scores: [{species, score, factors}] }
    userPos: null,
    coins: [],       // mes coins : { id, name, lat, lon, species[], notes, created }
    observations: [],// mes sorties : { id, date, place, species, found, raw }
    calib: null,     // apprentissage calculé à partir des sorties
    alertSettings: null,
    alerts: []
  };

  const $ = sel => document.querySelector(sel);
  const speciesById = Object.fromEntries(SPECIES.map(s => [s.id, s]));

  // ---------- Stockage local (préférences + cache météo) ----------
  function storeGet(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  function storeSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* stockage indisponible */ }
  }

  // Les champignons ajoutés dans une mise à jour s'affichent d'office,
  // même si la liste des champignons affichés a été mémorisée avant.
  const LATER_SPECIES = ["cesar", "boletorange"]; // ajoutés après la première version
  const prefs = storeGet(PREFS_KEY);
  if (prefs && Array.isArray(prefs.enabled)) {
    const known = new Set(prefs.known || SPECIES.map(s => s.id).filter(id => !LATER_SPECIES.includes(id)));
    state.enabled = new Set(prefs.enabled.filter(id => speciesById[id]));
    SPECIES.forEach(s => { if (!known.has(s.id)) state.enabled.add(s.id); });
  }
  function savePrefs() { storeSet(PREFS_KEY, { enabled: [...state.enabled], known: SPECIES.map(s => s.id) }); }
  savePrefs();

  state.coins = storeGet(COINS_KEY) || [];
  state.observations = storeGet(OBS_KEY) || [];
  state.alertSettings = Object.assign({}, DEFAULT_ALERTS, storeGet(ALERTS_KEY) || {});
  // nouveaux champignons ajoutés aux alertes aussi
  {
    const a = state.alertSettings;
    const knownA = new Set(a.known || SPECIES.map(s => s.id).filter(id => !LATER_SPECIES.includes(id)));
    SPECIES.forEach(s => { if (!knownA.has(s.id) && !a.species.includes(s.id)) a.species.push(s.id); });
    a.known = SPECIES.map(s => s.id);
  }
  state.calib = fitCalibration(state.observations);

  // Les données sont aussi copiées dans le cache pour le service worker
  // (vérification des alertes en arrière-plan) et comme filet de sécurité.
  function saveUserData() {
    storeSet(COINS_KEY, state.coins);
    storeSet(OBS_KEY, state.observations);
    storeSet(ALERTS_KEY, state.alertSettings);
    writeShared("user-data.json", {
      coins: state.coins, observations: state.observations, alertSettings: state.alertSettings
    });
  }

  // Si le navigateur a vidé le stockage local, on récupère la copie
  async function restoreUserData() {
    if (state.coins.length || state.observations.length) return saveUserData();
    const copy = await readShared("user-data.json");
    if (copy && ((copy.coins || []).length || (copy.observations || []).length)) {
      state.coins = copy.coins || [];
      state.observations = copy.observations || [];
      state.alertSettings = Object.assign({}, DEFAULT_ALERTS, copy.alertSettings || {});
      state.calib = fitCalibration(state.observations);
      saveUserData();
      renderCoins();
      compute();
    }
  }

  // ---------- Carte ----------
  const bounds = L.latLngBounds(REGION_OUTLINE.flat());
  const map = L.map("map", {
    zoomControl: false,
    maxBounds: bounds.pad(0.25),
    maxBoundsViscosity: 0.8,
    minZoom: 7,
    zoomSnap: 0.5
  }).fitBounds(bounds, { padding: [10, 10] });
  L.control.zoom({ position: "bottomright" }).addTo(map);

  // Fonds de carte IGN (Géoplateforme, gratuits) : Plan IGN, photos aériennes,
  // carte forestière (essences d'arbres) et cadastre, jusqu'au zoom 19.
  const IGN_ATTR = '&copy; <a href="https://www.ign.fr">IGN</a> – Géoplateforme';
  const ignUrl = (layer, style, format) => "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0" +
    `&LAYER=${layer}&STYLE=${encodeURIComponent(style)}&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=${format}`;
  const ign = (layer, style, format, opts) => L.tileLayer(ignUrl(layer, style, format),
    Object.assign({ maxZoom: 19, attribution: IGN_ATTR }, opts));

  const BASES = {
    "Plan IGN": ign("GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2", "normal", "image/png"),
    "Photos aériennes IGN": ign("ORTHOIMAGERY.ORTHOPHOTOS", "normal", "image/jpeg"),
    "OpenStreetMap": L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }),
    "Relief (OpenTopoMap)": L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, maxNativeZoom: 17,
      attribution: '&copy; OpenStreetMap, SRTM | &copy; <a href="https://opentopomap.org">OpenTopoMap</a>'
    })
  };
  const forestLayer = ign("LANDCOVER.FORESTINVENTORY.V2", "normal", "image/png",
    { maxNativeZoom: 16, opacity: 0.55, minZoom: 6 });
  const cadastreLayer = ign("CADASTRALPARCELS.PARCELLAIRE_EXPRESS", "PCI vecteur", "image/png",
    { minZoom: 14, opacity: 0.9 });
  const OVERLAYS = { "Essences forestières (IGN)": forestLayer, "Cadastre (parcelles)": cadastreLayer };

  // Le choix des fonds est mémorisé sur le téléphone
  const mapPrefs = storeGet(MAP_KEY) || {};
  (BASES[mapPrefs.base] || BASES["Plan IGN"]).addTo(map);
  const layersControl = L.control.layers(BASES, OVERLAYS, { position: "topright" }).addTo(map);
  const saveMapPrefs = () => storeSet(MAP_KEY, {
    base: Object.keys(BASES).find(k => map.hasLayer(BASES[k])),
    overlays: Object.keys(OVERLAYS).filter(k => map.hasLayer(OVERLAYS[k])),
    woodsOff: OVERLAYS["Champignons par bois"] ? !map.hasLayer(OVERLAYS["Champignons par bois"]) : !!mapPrefs.woodsOff
  });
  map.on("baselayerchange overlayadd overlayremove", saveMapPrefs);
  // Appui sur la carte forestière : type de forêt et champignons possibles à cet endroit
  map.on("click", e => { if (map.hasLayer(forestLayer)) showForestPoint(e.latlng); });
  map.on("overlayadd", e => {
    if (e.layer === forestLayer) toast("Carte forestière : touchez une forêt pour connaître ses arbres et ses champignons", 4500);
    if (e.layer === cadastreLayer && map.getZoom() < 14) toast("Zoomez pour voir les parcelles du cadastre", 3000);
  });

  // Masque hors Vendée et Charente-Maritime + contours des départements
  const world = [[85, -180], [85, 180], [-85, 180], [-85, -180]];
  L.polygon([world, ...REGION_OUTLINE], {
    stroke: false, fillColor: "#3d2b1f", fillOpacity: 0.35, interactive: false
  }).addTo(map);
  DEPARTEMENTS.forEach(d => L.polygon(d.rings, {
    color: "#3d2b1f", weight: 1.5, dashArray: "6 4", fill: false, interactive: false
  }).addTo(map));
  L.polygon(REGION_OUTLINE, {
    color: "#3d2b1f", weight: 2.5, fill: false, interactive: false
  }).addTo(map);

  const zoneLayer = L.layerGroup().addTo(map);
  const coinLayer = L.layerGroup().addTo(map);
  // Appui long (ou clic droit) sur la carte : ajouter un coin
  map.on("contextmenu", e => showCoinForm(null, { lat: e.latlng.lat, lon: e.latlng.lng }));
  let lastCompact = null;
  let lastWoodsView = null;
  map.on("zoomend", () => {
    const compact = map.getZoom() < 10;
    const woodsView = map.getZoom() >= 13;
    if ((compact !== lastCompact || woodsView !== lastWoodsView) && state.results.length) renderMap();
  });
  let userMarker = null;

  // ---------- Météo (Météo-France AROME / ARPEGE via Open-Meteo) ----------
  // Une seule requête pour les secteurs et pour chacun de mes coins (au point exact).
  const coinSignature = () => state.coins.map(c => `${c.id}@${c.lat.toFixed(4)},${c.lon.toFixed(4)}`).join(";");

  async function loadWeather(force) {
    const cached = storeGet(CACHE_KEY);
    const usable = cached && cached.zones === ZONES.length && cached.data && cached.data[0];
    const fresh = usable && !force && Date.now() - cached.at < CACHE_TTL &&
      cached.data[0].time.includes(todayStr()) && cached.coins === coinSignature();
    if (fresh) return useWeather(cached, cached.at);

    if (!force) toast("Chargement de la météo…");
    try {
      const w = await fetchWeather(state.coins);
      const entry = { at: Date.now(), dataAt: w.dataAt, zones: ZONES.length, coins: coinSignature(),
        data: w.zones, coinWeather: w.coinWeather, source: w.source };
      storeSet(CACHE_KEY, entry);
      hideToast();
      useWeather(entry, entry.at);
    } catch (err) {
      const why = weatherErrorText(err);
      if (usable) {
        toast(`Météo non mise à jour (${why}) : données du ${fmtDateTime(cached.at)}`, 5000);
        useWeather(cached, cached.at);
      } else {
        toast(`Météo indisponible : ${why}. Touchez le titre pour réessayer.`, 8000);
        $("#subtitle").textContent = "Météo indisponible · toucher pour réessayer";
        weatherFailed = true;
      }
    }
  }

  let weatherFailed = false;
  $(".brand").addEventListener("click", () => {
    if (weatherFailed || !state.weather) { weatherFailed = false; $("#subtitle").textContent = "Chargement de la météo…"; loadWeather(true); }
  });

  function useWeather(entry, at) {
    const data = entry.data;
    state.weather = data;
    state.coinWeather = entry.coinWeather || {};
    state.weatherSource = entry.source || "auto";
    state.fetchedAt = entry.dataAt || at;
    state.todayIdx = todayIndex(data);
    const maxDay = data[0].time.length - 1 - state.todayIdx;
    if (state.day > maxDay) state.day = maxDay;
    renderDays();
    compute();
    checkAlerts();
  }

  const SOURCE_LABEL = {
    meteofrance: "Météo-France (AROME 1,3 km / ARPEGE), complété au-delà de 4 jours",
    auto: "Open-Meteo (meilleur modèle disponible)"
  };

  // ---------- Calcul ----------
  function targetDate() {
    const t = state.todayIdx + state.day;
    return state.weather ? new Date(state.weather[0].time[t] + "T12:00:00") : new Date();
  }

  function compute() {
    if (!state.weather) return;
    const t = state.todayIdx + state.day;
    state.results = ZONES.map((zone, i) => evaluateZone(i, state.weather, t, state.calib));
    state.coinResults = state.coins.map(c => evaluateCoin(c, state.weather, t, state.calib, state.coinWeather));
    renderMap();
    renderCoins();
    renderSubtitle();
    rerenderSheet();
  }

  function rerenderSheet() {
    const { kind, id } = openSheet;
    if (kind === "zone") showZone(id);
    if (kind === "list") showList();
    if (kind === "fiche") showFiche(id);
    if (kind === "coin") showCoin(id);
    if (kind === "coins") showCoins();
  }

  // ---------- Rendu ----------
  function visibleScores(r) {
    return r.scores.filter(s => state.enabled.has(s.species.id) && s.score >= MIN_SHOWN);
  }

  function renderMap() {
    woodScoreCache.clear();
    renderWoods();
    zoneLayer.clearLayers();
    lastCompact = map.getZoom() < 10;
    lastWoodsView = map.getZoom() >= 13;
    // en vue « bois par bois », le cercle du secteur est remplacé par les contours des bois
    const hideCircles = lastWoodsView && map.hasLayer(woodsLayer);
    state.results.forEach(r => {
      const vis = visibleScores(r);
      const best = vis[0];
      if (!hideCircles) L.circle([r.zone.lat, r.zone.lon], {
        radius: r.zone.radius,
        color: best ? best.species.color : "#9e9e9e",
        weight: 1.5,
        opacity: best ? 0.9 : 0.4,
        fillColor: best ? best.species.color : "#9e9e9e",
        fillOpacity: best ? 0.08 + 0.3 * best.score / 100 : 0.05,
        bubblingMouseEvents: false
      }).on("click", () => showZone(r.zone.id)).addTo(zoneLayer);

      // Vue d'ensemble : pastilles compactes (3 max) ; zoomé : jusqu'à 8
      const compact = map.getZoom() < 10;
      const dots = vis.slice(0, compact ? 3 : 8).map(s => {
        const size = Math.round(compact ? 7 + s.score / 14 : 9 + s.score / 9);
        return `<i class="dot" style="width:${size}px;height:${size}px;background:${s.species.color}"></i>`;
      }).join("");
      const html = `<div class="zone-dots${vis.length ? "" : " empty"}${compact ? " compact" : ""}">${dots}</div>`;
      if (!hideCircles) L.marker([r.zone.lat, r.zone.lon], {
        icon: L.divIcon({ className: "zone-icon", html, iconSize: [0, 0] }),
        title: r.zone.name,
        zIndexOffset: best ? best.score * 10 : 0
      }).on("click", () => showZone(r.zone.id)).addTo(zoneLayer);
    });
  }

  function renderSubtitle() {
    const d = targetDate();
    const label = state.day === 0 ? "aujourd'hui" : d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    const good = state.results.reduce((n, r) => n + (visibleScores(r).some(s => s.score >= 60) ? 1 : 0), 0);
    $("#subtitle").textContent = `Pousse ${label} · ${good} secteur${good > 1 ? "s" : ""} favorable${good > 1 ? "s" : ""}`;
  }

  function renderDays() {
    const nav = $("#days");
    nav.innerHTML = "";
    if (!state.weather) return;
    const times = state.weather[0].time;
    for (let d = 0; state.todayIdx + d < times.length; d++) {
      const date = new Date(times[state.todayIdx + d] + "T12:00:00");
      const b = document.createElement("button");
      b.className = "day";
      b.setAttribute("aria-pressed", String(d === state.day));
      const top = d === 0 ? "Auj." : d === 1 ? "Demain" : date.toLocaleDateString("fr-FR", { weekday: "short" });
      b.innerHTML = `${top}<small>${date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</small>`;
      b.addEventListener("click", () => {
        state.day = d;
        nav.querySelectorAll(".day").forEach((el, i) => el.setAttribute("aria-pressed", String(i === d)));
        compute();
      });
      nav.appendChild(b);
    }
  }

  function renderLegend() {
    const el = $("#legend");
    el.innerHTML = "";
    const all = document.createElement("button");
    all.className = "chip all";
    const allOn = state.enabled.size === SPECIES.length;
    all.textContent = allOn ? "Aucun" : "Tous";
    all.addEventListener("click", () => {
      state.enabled = new Set(allOn ? [] : SPECIES.map(s => s.id));
      savePrefs(); renderLegend(); refresh();
    });
    el.appendChild(all);

    SPECIES.forEach(sp => {
      const b = document.createElement("button");
      b.className = "chip";
      b.setAttribute("aria-pressed", String(state.enabled.has(sp.id)));
      b.innerHTML = `<span class="swatch" style="background:${sp.color}"></span>${sp.name}`;
      b.title = "Voir la fiche";
      b.addEventListener("click", () => showFiche(sp.id));
      el.appendChild(b);
    });
  }

  function toggleSpecies(id) {
    if (state.enabled.has(id)) state.enabled.delete(id); else state.enabled.add(id);
    savePrefs(); renderLegend(); refresh();
  }

  function refresh() {
    if (!state.results.length) { if (openSheet.kind === "fiche") showFiche(openSheet.id); return; }
    renderMap();
    renderSubtitle();
    rerenderSheet();
  }

  // ---------- Panneau du bas ----------
  const openSheet = { kind: null, id: null };

  function showSheet(html, kind, id) {
    const wasOpen = openSheet.kind !== null;
    const scroll = wasOpen && openSheet.kind === kind && openSheet.id === id ? $("#sheet-content").scrollTop : 0;
    openSheet.kind = kind; openSheet.id = id;
    $("#sheet-content").innerHTML = html;
    $("#sheet").hidden = false;
    $("#sheet-backdrop").hidden = false;
    $("#sheet-content").scrollTop = scroll;
  }

  function closeSheet() {
    openSheet.kind = null; openSheet.id = null;
    $("#sheet").hidden = true;
    $("#sheet-backdrop").hidden = true;
  }
  $("#sheet-close").addEventListener("click", closeSheet);
  $("#sheet-content").addEventListener("click", e => {
    const fiche = e.target.closest("[data-fiche]");
    if (fiche) { e.preventDefault(); showFiche(fiche.dataset.fiche); return; }
    const sortie = e.target.closest("[data-sortie]");
    if (sortie) { showSortie(sortie.dataset.sortie); return; }
    const coinLi = e.target.closest("[data-coin]");
    if (coinLi) {
      const c = state.coins.find(x => x.id === coinLi.dataset.coin);
      if (c) { map.flyTo([c.lat, c.lon], Math.max(map.getZoom(), 12), { duration: 0.8 }); showCoin(c.id); }
      return;
    }
    const li = e.target.closest("li[data-zone]");
    if (li && (openSheet.kind === "fiche" || openSheet.kind === "alerts")) {
      const z = ZONES.find(x => x.id === li.dataset.zone);
      map.flyTo([z.lat, z.lon], 12, { duration: 0.8 });
      showZone(z.id);
    }
  });
  $("#sheet-backdrop").addEventListener("click", closeSheet);
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheet(); });

  const pct = x => Math.round(x * 100) + " %";
  const fmt1 = x => x == null ? "–" : (Math.round(x * 10) / 10).toLocaleString("fr-FR");

  function levelBadge(score) {
    const l = levelFor(score);
    return `<span class="lvl ${l.cls}">${l.label}</span>`;
  }

  function showZone(id) {
    const r = state.results.find(x => x.zone.id === id);
    if (!r) return;
    const { zone, ws } = r;
    const opened = new Set([...document.querySelectorAll("#sheet-content details[open]")].map(d => d.dataset.id));
    const rows = r.scores
      .filter(s => state.enabled.has(s.species.id) && s.factors.habitat)
      .map(s => {
        const sp = s.species, f = s.factors;
        const factors = f.season === 0
          ? `<span>Hors saison</span>`
          : `<span>Pluie ${pct(f.rain)}</span><span>Temp. ${pct(f.temp)}</span><span>Humidité ${pct(f.hum)}</span><span>Saison ${pct(f.season)}</span>` +
            (f.frost < 1 ? `<span>Gel −${pct(1 - f.frost)}</span>` : "") +
            (f.dry < 1 ? `<span>Sécheresse −30 %</span>` : "");
        return `<details class="sp" data-id="${sp.id}"${opened.has(sp.id) ? " open" : ""}>
          <summary>
            <span class="swatch" style="background:${sp.color}"></span>
            <span class="name">${sp.name} ${levelBadge(s.score)}<em>${sp.latin}</em></span>
            <span class="score">${s.score} %</span>
          </summary>
          ${adjustNote(s)}
          <div class="bar"><i style="width:${s.score}%;background:${sp.color}"></i></div>
          <div class="factors">${factors}</div>
          <p>${sp.tips}</p>
          <p class="warn">⚠ Confusions : ${sp.lookalikes}</p>
          <button class="link-btn" data-fiche="${sp.id}">Voir la fiche complète →</button>
        </details>`;
      }).join("");

    const dist = state.userPos ? ` · à ${distanceKm(state.userPos, zone).toFixed(0)} km` : "";
    showSheet(`
      <h2>${zone.name}</h2>
      <p class="muted">${zone.note}${dist}</p>
      <div class="tags">${zone.habitats.map(h => `<span class="tag">${HABITAT_LABELS[h] || h}</span>`).join("")}</div>
      <div class="wx">
        <div><b>${fmt1(ws.rainLag + ws.rainRecent)}</b><span>mm pluie 15 j</span></div>
        <div><b>${fmt1(ws.temp7)}°</b><span>temp. moy. 7 j</span></div>
        <div><b>${ws.hum7 == null ? "–" : Math.round(ws.hum7)} %</b><span>humidité 7 j</span></div>
        <div><b>${ws.frostDays}</b><span>jour(s) de gel</span></div>
      </div>
      <p class="source">Météo : ${SOURCE_LABEL[state.weatherSource] || SOURCE_LABEL.auto}</p>
      <h3>Champignons possibles</h3>
      ${rows || '<p class="muted">Aucune espèce sélectionnée ne correspond à ce milieu.</p>'}
      <div class="btn-row">
        <button class="btn" id="zone-woods">🌳 Voir les bois</button>
        <button class="btn ghost" data-sortie="zone:${zone.id}">📝 Noter ma sortie</button>
      </div>
      ${routeBlock(zone.lat, zone.lon)}
    `, "zone", id);
    $("#zone-woods").addEventListener("click", () => {
      if (!map.hasLayer(woodsLayer)) woodsLayer.addTo(map);
      closeSheet();
      map.flyTo([zone.lat, zone.lon], 14, { duration: 0.8 });
    });
  }

  // ---------- Fiches espèces ----------
  const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
  const MONTH_NAMES = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const PHOTO_KEY = "champi-photos-v1";
  const photoCache = storeGet(PHOTO_KEY) || {};

  // Photo libre de droits depuis Wikipédia (français, puis anglais)
  async function wikiPhoto(title) {
    if (photoCache[title]) return photoCache[title];
    for (const lang of ["fr", "en"]) {
      try {
        const res = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`);
        if (!res.ok) continue;
        const j = await res.json();
        if (!j.thumbnail) continue;
        let src = j.thumbnail.source;
        if (j.originalimage && j.originalimage.width >= 640) src = src.replace(/\/\d+px-/, "/640px-");
        const photo = { src, page: (j.content_urls && j.content_urls.mobile.page) || "", title: j.title };
        photoCache[title] = photo;
        storeSet(PHOTO_KEY, photoCache);
        return photo;
      } catch (e) { /* hors ligne : on essaie la langue suivante */ }
    }
    return null;
  }

  function seasonText(sp) {
    const months = Object.keys(sp.season).map(Number).filter(m => sp.season[m] >= 0.7).sort((a, b) => a - b);
    if (!months.length) return "";
    // gère les saisons à cheval sur l'année (octobre → janvier)
    let start = 0;
    for (let i = 1; i < months.length; i++) if (months[i] !== months[i - 1] + 1) start = i;
    const ordered = months.slice(start).concat(months.slice(0, start));
    return `Pleine saison : ${MONTH_NAMES[ordered[0] - 1]} à ${MONTH_NAMES[ordered[ordered.length - 1] - 1]}`;
  }

  function showFiche(id) {
    const sp = speciesById[id], f = FICHES[id];
    if (!sp || !f) return;
    const month = targetDate().getMonth() + 1;
    const on = state.enabled.has(id);

    const strip = MONTHS.map((m, i) => {
      const w = sp.season[i + 1] || 0;
      return `<span class="m${i + 1 === month ? " now" : ""}" title="${MONTH_NAMES[i]}">
        <i style="background:${sp.color};opacity:${w ? 0.25 + 0.75 * w : 0}"></i>${m}</span>`;
    }).join("");

    let where = "";
    if (state.results.length) {
      const spots = state.results
        .map(r => ({ zone: r.zone, s: r.scores.find(x => x.species.id === id) }))
        .filter(x => x.s.factors.habitat)
        .sort((a, b) => b.s.score - a.s.score)
        .slice(0, 5);
      const day = state.day === 0 ? "aujourd'hui" : targetDate().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric" });
      where = `<h3>Où le chercher ${day}</h3>` + (spots.length
        ? `<ul class="rank">${spots.map(x => `<li data-zone="${x.zone.id}">
            <span class="swatch" style="background:${sp.color}"></span>
            <span class="txt"><b>${x.zone.name}</b><span>${x.zone.note}</span></span>
            ${levelBadge(x.s.score)}<span class="score">${x.s.score} %</span></li>`).join("")}</ul>`
        : '<p class="muted">Aucun secteur adapté.</p>');
    }

    showSheet(`
      <figure class="photo" style="--sp:${sp.color}">
        <img id="fiche-img" alt="Photo : ${sp.name}" hidden>
        <figcaption id="fiche-credit" hidden></figcaption>
        <span class="photo-ph">Chargement de la photo…</span>
      </figure>
      <h2><span class="swatch big" style="background:${sp.color}"></span>${sp.name}</h2>
      <p class="muted"><em>${sp.latin}</em> · ${f.size}</p>
      <button class="toggle" id="fiche-toggle" aria-pressed="${on}">
        ${on ? "✓ Affiché sur la carte" : "Masqué sur la carte : afficher"}
      </button>

      ${f.expertNote ? `<div class="alert expert">⛔ <b>Cueilleurs expérimentés uniquement.</b> ${f.expertNote}</div>` : ""}
      ${sp.abundance != null && sp.abundance < 1 ? '<p class="muted">Espèce rare dans la région : son score est volontairement plafonné.</p>' : ""}
      <h3>Comment le reconnaître</h3>
      <p>${f.ident}</p>
      <div class="alert">⚠ <b>Confusions possibles :</b> ${sp.lookalikes}</div>

      <h3>Milieu</h3>
      <p>${f.milieu}</p>
      <div class="tags">${sp.habitats.map(h => `<span class="tag">${HABITAT_LABELS[h] || h}</span>`).join("")}</div>
      <p class="muted" style="margin-top:8px">${sp.tips}</p>

      <h3>Saison</h3>
      <div class="months">${strip}</div>
      <p class="muted">${seasonText(sp)}</p>

      <h3>Météo favorable</h3>
      <div class="wx">
        <div><b>${sp.temp[1]}–${sp.temp[2]}°</b><span>température idéale</span></div>
        <div><b>${sp.rainMin} mm</b><span>pluie sur 2 semaines</span></div>
        <div><b>&gt; 85 %</b><span>humidité de l'air</span></div>
        <div><b>${sp.temp[0] <= 2 ? "Oui" : "Non"}</b><span>supporte le froid</span></div>
      </div>

      ${where}

      <h3>En cuisine</h3>
      <p>${f.cuisine}</p>
    `, "fiche", id);

    $("#fiche-toggle").addEventListener("click", () => toggleSpecies(id));

    wikiPhoto(f.wiki).then(photo => {
      if (openSheet.kind !== "fiche" || openSheet.id !== id) return;
      const img = $("#fiche-img"), ph = document.querySelector(".photo-ph");
      if (!img) return;
      if (!photo) { ph.textContent = "Photo indisponible hors connexion"; return; }
      img.onload = () => { img.hidden = false; ph.hidden = true; };
      img.onerror = () => { ph.textContent = "Photo indisponible hors connexion"; };
      img.src = photo.src;
      const cr = $("#fiche-credit");
      cr.innerHTML = `Photo : <a href="${photo.page}" target="_blank" rel="noopener">Wikipédia – ${photo.title}</a>`;
      cr.hidden = false;
    });
  }

  // ---------- Apprentissage : affichage ----------
  const esc = str => String(str == null ? "" : str).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function adjustNote(s) {
    if (s.raw == null || s.raw === s.score) return "";
    const up = s.score > s.raw;
    return `<p class="adjust">${up ? "▲" : "▼"} Ajusté d'après vos sorties (prévu ${s.raw} %)</p>`;
  }

  // ---------- Mes coins ----------
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function coinResult(id) {
    return (state.coinResults || []).find(r => r.coin.id === id);
  }

  function renderCoins() {
    coinLayer.clearLayers();
    state.coins.forEach(c => {
      const r = coinResult(c.id);
      const best = r && r.scores.find(x => x.score > 0);
      const color = best ? best.species.color : "#3d2b1f";
      const label = best ? best.score : "–";
      L.marker([c.lat, c.lon], {
        icon: L.divIcon({
          className: "zone-icon",
          html: `<div class="coin-pin" style="--c:${color}"><span>★</span><b>${label}</b></div>`,
          iconSize: [0, 0]
        }),
        title: c.name,
        zIndexOffset: 4000
      }).on("click", () => showCoin(c.id)).addTo(coinLayer);
    });
  }

  function showCoins() {
    const rows = state.coins.map(c => {
      const r = coinResult(c.id);
      const best = r && r.scores[0];
      const dist = state.userPos ? ` · ${distKm(state.userPos, c).toFixed(0)} km` : "";
      const sw = c.species.map(id => `<i class="mini" style="background:${speciesById[id].color}"></i>`).join("");
      return `<li data-coin="${c.id}">
        <span class="coin-ico">★</span>
        <span class="txt"><b>${esc(c.name)}</b><span>${sw} ${c.species.length} espèce${c.species.length > 1 ? "s" : ""}${dist}</span></span>
        ${best ? `${levelBadge(best.score)}<span class="score">${best.score} %</span>` : ""}
      </li>`;
    }).join("");
    showSheet(`
      <h2>Mes coins</h2>
      <p class="muted">Vos coins sont enregistrés sur ce téléphone. Pensez à les sauvegarder (🔔 → Sauvegarde).</p>
      <div class="btn-row">
        <button class="btn" id="add-center">＋ Au centre de la carte</button>
        <button class="btn ghost" id="add-here">◎ À ma position</button>
      </div>
      <p class="muted" style="margin-top:8px">Astuce : un appui long sur la carte ajoute un coin à cet endroit.</p>
      ${rows ? `<ul class="rank">${rows}</ul>` : `<div class="empty"><b>Aucun coin pour l'instant.</b><br>Ajoutez l'endroit où vous avez trouvé des champignons : l'appli calculera ses chances de pousse chaque jour et pourra vous alerter.</div>`}
    `, "coins", null);
    $("#add-center").addEventListener("click", () => {
      const c = map.getCenter();
      showCoinForm(null, { lat: c.lat, lon: c.lng });
    });
    $("#add-here").addEventListener("click", () => {
      getPosition(p => showCoinForm(null, p));
    });
  }

  function showCoinForm(id, pos, preset) {
    const existing = id ? state.coins.find(c => c.id === id) : null;
    const draft = existing
      ? { ...existing, species: [...existing.species] }
      : { name: (preset && preset.name) || "", lat: pos.lat, lon: pos.lon, species: (preset && preset.species) || [], notes: (preset && preset.notes) || "" };
    const inVendee = bounds.pad(0.05).contains([draft.lat, draft.lon]);
    const chips = SPECIES.map(sp => `<button type="button" class="chip pick" data-sp="${sp.id}" aria-pressed="${draft.species.includes(sp.id)}">
      <span class="swatch" style="background:${sp.color}"></span>${sp.name}</button>`).join("");
    showSheet(`
      <h2>${existing ? "Modifier le coin" : "Nouveau coin"}</h2>
      <p class="muted">Position : ${draft.lat.toFixed(5)}, ${draft.lon.toFixed(5)}${inVendee ? "" : " · ⚠ hors Vendée / Charente-Maritime"}</p>
      <form id="coin-form" class="form">
        <label for="coin-name">Nom du coin</label>
        <input id="coin-name" type="text" maxlength="60" required placeholder="Ex. : Chênes du chemin creux" value="${esc(draft.name)}">
        <label>Champignons trouvés ici</label>
        <div class="pick-grid">${chips}</div>
        <p class="muted">Ils servent à calculer les chances de pousse de ce coin.</p>
        <label for="coin-notes">Notes</label>
        <textarea id="coin-notes" rows="3" maxlength="500" placeholder="Accès, repères, parking…">${esc(draft.notes)}</textarea>
        <p id="coin-error" class="form-error" hidden></p>
        <div class="btn-row">
          <button class="btn" type="submit">Enregistrer</button>
          <button class="btn ghost" type="button" id="coin-cancel">Annuler</button>
        </div>
        ${existing ? '<button class="btn danger" type="button" id="coin-delete">Supprimer ce coin</button>' : ""}
      </form>
    `, "coinform", id);

    document.querySelectorAll(".pick").forEach(b => b.addEventListener("click", () => {
      const sp = b.dataset.sp;
      const on = draft.species.includes(sp);
      draft.species = on ? draft.species.filter(x => x !== sp) : [...draft.species, sp];
      b.setAttribute("aria-pressed", String(!on));
    }));
    $("#coin-cancel").addEventListener("click", () => existing ? showCoin(existing.id) : closeSheet());
    $("#coin-form").addEventListener("submit", e => {
      e.preventDefault();
      const name = $("#coin-name").value.trim();
      const err = $("#coin-error");
      if (!name) { err.textContent = "Donnez un nom à ce coin."; err.hidden = false; return; }
      if (!draft.species.length) { err.textContent = "Choisissez au moins un champignon trouvé ici."; err.hidden = false; return; }
      const coin = {
        id: existing ? existing.id : newId(),
        name, lat: draft.lat, lon: draft.lon,
        species: draft.species, notes: $("#coin-notes").value.trim(),
        created: existing ? existing.created : todayStr()
      };
      state.coins = existing ? state.coins.map(c => c.id === coin.id ? coin : c) : [...state.coins, coin];
      saveUserData();
      compute();
      if (!state.weather) renderCoins();
      toast(existing ? "Coin modifié" : "Coin enregistré", 2000);
      showCoin(coin.id);
      if (!existing) loadWeather(true);
    });
    const del = $("#coin-delete");
    if (del) del.addEventListener("click", () => {
      if (del.dataset.confirm !== "1") {
        del.dataset.confirm = "1";
        del.textContent = "Confirmer la suppression";
        return;
      }
      state.coins = state.coins.filter(c => c.id !== existing.id);
      saveUserData();
      compute();
      if (!state.weather) renderCoins();
      toast("Coin supprimé", 2000);
      showCoins();
    });
  }

  function showCoin(id) {
    const c = state.coins.find(x => x.id === id);
    if (!c) return closeSheet();
    const r = coinResult(id);
    const dist = state.userPos ? ` · à ${distKm(state.userPos, c).toFixed(0)} km` : "";
    const day = state.day === 0 ? "aujourd'hui" : targetDate().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric" });
    const rows = r ? r.scores.map(s => `<div class="sp">
        <div class="sp-head">
          <span class="swatch" style="background:${s.species.color}"></span>
          <span class="name">${s.species.name} ${levelBadge(s.score)}${s.factors.season === 0 ? "<em>Hors saison</em>" : ""}</span>
          <span class="score">${s.score} %</span>
        </div>
        ${adjustNote(s)}
        <div class="bar"><i style="width:${s.score}%;background:${s.species.color}"></i></div>
      </div>`).join("") : '<p class="muted">Météo en cours de chargement…</p>';
    const hist = state.observations
      .filter(o => o.place === placeKey("coin", id))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 15)
      .map(o => `<li class="hist"><span>${new Date(o.date + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}</span>
        <span>${speciesById[o.species] ? speciesById[o.species].name : o.species}</span>
        <b class="${o.found ? "ok" : "ko"}">${o.found ? "Trouvé" : "Rien"}</b></li>`).join("");
    showSheet(`
      <h2>★ ${esc(c.name)}</h2>
      <p class="muted">Mon coin${dist}${r ? (r.precise ? " · météo calculée au point exact du coin" : ` · météo du secteur ${r.zone.name} (en attente de la météo du coin)`) : ""}</p>
      ${c.notes ? `<p class="notes">${esc(c.notes)}</p>` : ""}
      ${r ? `<div class="wx">
        <div><b>${fmt1(r.ws.rainLag + r.ws.rainRecent)}</b><span>mm pluie 15 j</span></div>
        <div><b>${fmt1(r.ws.temp7)}°</b><span>temp. moy. 7 j</span></div>
        <div><b>${r.ws.hum7 == null ? "–" : Math.round(r.ws.hum7)} %</b><span>humidité 7 j</span></div>
        <div><b>${r.ws.frostDays}</b><span>jour(s) de gel</span></div>
      </div>` : ""}
      <p class="source">Météo : ${SOURCE_LABEL[state.weatherSource] || SOURCE_LABEL.auto}</p>
      <h3>Chances de pousse ${day}</h3>
      ${rows}
      <div class="btn-row">
        <button class="btn" data-sortie="coin:${c.id}">📝 Noter ma sortie</button>
        <button class="btn ghost" id="coin-edit">✏️ Modifier</button>
      </div>
      ${routeBlock(c.lat, c.lon)}
      <h3>Mes sorties ici</h3>
      ${hist ? `<ul class="rank">${hist}</ul>` : '<p class="muted">Aucune sortie notée. Après votre passage, notez ce que vous avez trouvé : l\'appli s\'ajustera.</p>'}
    `, "coin", id);
    $("#coin-edit").addEventListener("click", () => showCoinForm(id));
  }

  // ---------- Itinéraire en voiture ----------
  // Ouvre l'appli de navigation du téléphone (Google Maps, Waze ou Plans sur iPhone).
  // La destination est le cœur du bois : le GPS s'arrête au point accessible le plus proche.
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  function routeBlock(lat, lon) {
    const ll = `${lat.toFixed(6)},${lon.toFixed(6)}`;
    const dist = state.userPos ? `<span class="muted"> · ${distKm(state.userPos, { lat, lon }).toFixed(0)} km à vol d'oiseau</span>` : "";
    const google = `https://www.google.com/maps/dir/?api=1&destination=${ll}&travelmode=driving`;
    const waze = `https://waze.com/ul?ll=${ll}&navigate=yes`;
    const apple = `https://maps.apple.com/?daddr=${ll}&dirflg=d`;
    return `<div class="route">
      <a class="btn route-main" href="${isIOS ? apple : google}" target="_blank" rel="noopener">🚗 Itinéraire en voiture</a>${dist}
      <div class="route-alt">Autre appli :
        ${isIOS ? `<a href="${google}" target="_blank" rel="noopener">Google Maps</a> ·` : ""}
        <a href="${waze}" target="_blank" rel="noopener">Waze</a>
      </div>
    </div>`;
  }

  // ---------- Champignons par bois (contours BD Forêt, WFS IGN) ----------
  // À partir du zoom 13, les bois visibles sont téléchargés par carrés de
  // 0,04° et coloriés avec le champignon le plus probable du jour.
  const WOODS_MIN_ZOOM = 13;
  const SHORT_NAMES = {
    cepe: "Cèpe", girolle: "Girolle", trompette: "Trompette", piedmouton: "Pied de mouton",
    chanterelletube: "Chanterelle", lactaire: "Lactaire", coulemelle: "Coulemelle", rose: "Rosé",
    piedbleu: "Pied bleu", pleurote: "Pleurote", morille: "Morille", mousseron: "Mousseron", cesar: "Oronge",
    boletorange: "Bolet orangé"
  };
  const CELL = 0.04;
  const woodsRenderer = L.canvas({ padding: 0.3 });
  const woodsLayer = L.layerGroup();
  const woodCells = new Map();     // clé de carré → { features } ou { loading: true }
  const woodScoreCache = new Map(); // secteur|milieux|jour → scores
  let woodsError = false;

  // Bandeau sur la carte : invite à zoomer, chargement, erreur
  function updateWoodsHint() {
    const el = $("#woods-hint");
    if (!map.hasLayer(woodsLayer)) { el.hidden = true; return; }
    if (map.getZoom() < WOODS_MIN_ZOOM) {
      el.textContent = "🔍 Zoomez ici pour voir les champignons de chaque bois";
      el.dataset.action = "zoom";
      el.hidden = false;
      return;
    }
    const loading = visibleCells().some(c => woodCells.get(c.key) && woodCells.get(c.key).loading);
    if (loading) { el.textContent = "Chargement des bois…"; el.dataset.action = ""; el.hidden = false; return; }
    if (woodsError) { el.textContent = "Bois indisponibles (réseau ?) · toucher pour réessayer"; el.dataset.action = "retry"; el.hidden = false; return; }
    el.hidden = true;
  }

  function woodScores(habitats, pos, onlyEnabled) {
    if (!state.weather) return [];
    const zi = nearestZoneIndex(pos);
    const t = state.todayIdx + state.day;
    const key = `${zi}|${habitats.slice().sort().join(",")}|${t}|${state.calib.total}`;
    let scores = woodScoreCache.get(key);
    if (!scores) {
      const ids = speciesForHabitats(habitats).map(x => x.id);
      const ws = weatherSummary(state.weather[zi], t);
      scores = scorePlace({ habitats }, ws, monthOf(state.weather, t), "point", state.calib, ids);
      woodScoreCache.set(key, scores);
    }
    return onlyEnabled ? scores.filter(x => state.enabled.has(x.species.id)) : scores;
  }

  function woodsUrl(lat0, lon0) {
    const bb = [lon0, lat0, lon0 + CELL, lat0 + CELL].map(v => v.toFixed(4)).join(",");
    return "https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature" +
      "&TYPENAMES=LANDCOVER.FORESTINVENTORY.V2:formation_vegetale&SRSNAME=EPSG:4326" +
      `&BBOX=${bb},EPSG:4326&COUNT=2000&OUTPUTFORMAT=application/json`;
  }

  function visibleCells() {
    const b = map.getBounds();
    const cells = [];
    for (let la = Math.floor(b.getSouth() / CELL) * CELL; la < b.getNorth(); la += CELL)
      for (let lo = Math.floor(b.getWest() / CELL) * CELL; lo < b.getEast(); lo += CELL)
        cells.push({ key: `${la.toFixed(2)},${lo.toFixed(2)}`, lat: la, lon: lo });
    return cells;
  }

  // File d'attente : 2 téléchargements à la fois, 3 essais par carré
  const woodQueue = [];
  let woodActive = 0;

  function loadWoodCell(c) {
    woodCells.set(c.key, { loading: true });
    woodQueue.push(c);
    pumpWoodQueue();
  }

  function pumpWoodQueue() {
    while (woodActive < 2 && woodQueue.length) {
      const c = woodQueue.shift();
      woodActive++;
      fetchWoodCell(c).finally(() => { woodActive--; pumpWoodQueue(); });
    }
  }

  async function fetchWoodCell(c) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(woodsUrl(c.lat, c.lon));
        if (!res.ok) throw new Error("HTTP " + res.status);
        const j = await res.json();
        woodCells.set(c.key, { features: j.features || [], at: Date.now() });
        // on garde en mémoire les 60 derniers carrés
        if (woodCells.size > 60) woodCells.delete(woodCells.keys().next().value);
        woodsError = false;
        renderWoods();
        updateWoodsHint();
        return;
      } catch (e) {
        if (attempt < 3) await new Promise(r => setTimeout(r, 1500 * attempt));
      }
    }
    woodCells.delete(c.key);
    woodsError = true;
    renderWoods();
    updateWoodsHint();
  }

  function updateWoods() {
    if (!map.hasLayer(woodsLayer)) return;
    if (map.getZoom() < WOODS_MIN_ZOOM) {
      woodsLayer.clearLayers();
      updateWoodsHint();
      return;
    }
    const cells = visibleCells();
    if (cells.length > 30) return; // vue trop grande (écran très large)
    cells.filter(c => !woodCells.has(c.key)).forEach(loadWoodCell);
    renderWoods();
    updateWoodsHint();
  }

  function renderWoods() {
    woodsLayer.clearLayers();
    if (!map.hasLayer(woodsLayer) || map.getZoom() < WOODS_MIN_ZOOM) return;
    const seen = new Set();
    const z = map.getZoom();
    let dots = 0;
    visibleCells().forEach(c => {
      const cell = woodCells.get(c.key);
      if (!cell || !cell.features) return;
      cell.features.forEach(f => {
        const id = f.properties.id || f.id;
        if (seen.has(id)) return;
        seen.add(id);
        const habitats = habitatsFromForest(f.properties);
        const geo = L.geoJSON(f, { renderer: woodsRenderer });
        const center = geo.getBounds().getCenter();
        const pos = { lat: center.lat, lon: center.lng };
        const scores = woodScores(habitats, pos, true).filter(x => x.score >= MIN_SHOWN);
        const best = scores[0];
        geo.setStyle({
          renderer: woodsRenderer,
          color: best ? "#3d2b1f" : "#7d8b6a",
          weight: best ? 1.2 : 0.8,
          opacity: best ? 0.7 : 0.4,
          fillColor: best ? best.species.color : "#7d8b6a",
          fillOpacity: best ? 0.15 + 0.45 * best.score / 100 : 0.06
        });
        geo.eachLayer(l => { l.options.bubblingMouseEvents = false; });
        geo.on("click", () => renderForestSheet(f.properties, pos));
        woodsLayer.addLayer(geo);
        // pastilles sur chaque parcelle : le meilleur champignon, ou les 3 meilleurs si la parcelle est assez grande
        if (best && dots < 800) {
          const bb = geo.getBounds();
          const px = map.latLngToContainerPoint(bb.getNorthEast()).x - map.latLngToContainerPoint(bb.getSouthWest()).x;
          if (px > 10) {
            dots++;
            const n = px > 34 && z >= 14 ? 3 : px > 24 ? 2 : 1;
            // de près, sur les grandes parcelles : nom du champignon et pourcentage
            const html = z >= 15 && px > 70
              ? `<div class="wood-label">${scores.slice(0, 2).map(x =>
                  `<span><i class="dot" style="background:${x.species.color}"></i>${SHORT_NAMES[x.species.id] || x.species.name} ${x.score} %</span>`).join("")}</div>`
              : `<div class="zone-dots compact wood">${scores.slice(0, n).map(x =>
                  `<i class="dot" style="width:${Math.round(7 + x.score / 14)}px;height:${Math.round(7 + x.score / 14)}px;background:${x.species.color}"></i>`).join("")}</div>`;
            woodsLayer.addLayer(L.marker(center, {
              icon: L.divIcon({ className: "zone-icon", html, iconSize: [0, 0] }),
              interactive: true, bubblingMouseEvents: false
            }).on("click", () => renderForestSheet(f.properties, pos)));
          }
        }
      });
    });
  }

  OVERLAYS["Champignons par bois"] = woodsLayer;
  layersControl.addOverlay(woodsLayer, "Champignons par bois");
  // « Champignons par bois » est toujours actif, sauf si on l'a décoché soi-même
  (mapPrefs.overlays || []).forEach(n => OVERLAYS[n] && OVERLAYS[n].addTo(map));
  if (!mapPrefs.woodsOff) woodsLayer.addTo(map);

  map.on("moveend", updateWoods);
  map.on("overlayadd", e => { if (e.layer === woodsLayer) updateWoods(); });
  map.on("zoomend overlayremove", updateWoodsHint);
  $("#woods-hint").addEventListener("click", () => {
    const el = $("#woods-hint");
    if (el.dataset.action === "zoom") map.flyTo(map.getCenter(), 14, { duration: 0.8 });
    if (el.dataset.action === "retry") { woodsError = false; updateWoods(); }
  });
  updateWoodsHint();

  // ---------- Carte forestière : que pousse-t-il ici ? ----------
  async function showForestPoint(latlng) {
    const z = 16;
    const p = map.project(latlng, z);
    const url = "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetFeatureInfo&VERSION=1.0.0" +
      "&LAYER=LANDCOVER.FORESTINVENTORY.V2&STYLE=normal&FORMAT=image/png&INFOFORMAT=application/json" +
      `&TILEMATRIXSET=PM&TILEMATRIX=${z}&TILECOL=${Math.floor(p.x / 256)}&TILEROW=${Math.floor(p.y / 256)}` +
      `&I=${Math.floor(p.x % 256)}&J=${Math.floor(p.y % 256)}`;
    const pos = { lat: latlng.lat, lon: latlng.lng };
    showSheet(`<h2>Ce bois</h2><p class="muted">Interrogation de la carte forestière IGN…</p>`, "forest", null);
    let props = null;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const j = await res.json();
      props = j.features && j.features[0] ? j.features[0].properties : null;
    } catch (err) {
      if (openSheet.kind === "forest") showSheet(`<h2>Ce bois</h2><div class="alert">Carte forestière injoignable. Vérifiez votre connexion.</div>`, "forest", null);
      return;
    }
    if (openSheet.kind !== "forest") return;
    if (!props) {
      showSheet(`<h2>Hors forêt</h2>
        <p class="muted">La carte forestière IGN n'indique pas de bois à cet endroit (prairie, culture, ville, eau…).</p>
        <p>Touchez une zone colorée de la carte forestière.</p>`, "forest", null);
      return;
    }
    renderForestSheet(props, pos);
  }

  // Fiche d'un bois : type de forêt, champignons possibles et chances du jour
  function renderForestSheet(props, pos) {
    const habitats = habitatsFromForest(props);
    const list = speciesForHabitats(habitats);
    let rows = "";
    if (state.weather) {
      const scores = woodScores(habitats, pos, null);
      rows = scores.map(s => `<li data-fiche="${s.species.id}">
          <span class="swatch" style="background:${s.species.color}"></span>
          <span class="txt"><b>${s.species.name}</b><span>${s.factors.season === 0 ? "Hors saison" : "Voir la fiche"}</span></span>
          ${levelBadge(s.score)}<span class="score">${s.score} %</span></li>`).join("");
    }
    const essence = props.essence && props.essence !== "NR" ? props.essence : "";
    showSheet(`
      <h2>${esc(props.tfv || "Formation boisée")}</h2>
      <p class="muted">${essence ? `Essence : ${esc(essence)} · ` : ""}source : carte forestière IGN (BD Forêt)</p>
      <div class="tags">${habitats.map(h => `<span class="tag">${HABITAT_LABELS[h] || h}</span>`).join("")}</div>
      ${routeBlock(pos.lat, pos.lon)}
      <h3>Champignons possibles ici</h3>
      ${rows ? `<ul class="rank">${rows}</ul><p class="source">Chances calculées avec la météo du secteur le plus proche.</p>`
        : '<p class="muted">Aucun des champignons suivis ne correspond à ce type de forêt.</p>'}
      <div class="btn-row">
        <button class="btn ghost" id="forest-coin">★ Enregistrer comme coin</button>
      </div>
      <p class="muted" style="margin-top:10px">Une forêt indiquée n'est pas forcément ouverte au public : vérifiez avec le cadastre et respectez les propriétés privées.</p>
    `, "forest", null);
    $("#forest-coin").addEventListener("click", () => showCoinForm(null, pos, {
      species: list.map(x => x.id),
      notes: props.tfv || ""
    }));
  }

  // ---------- Noter une sortie (apprentissage) ----------
  function showSortie(place) {
    if (!state.weather) return toast("Météo pas encore chargée", 2500);
    const [kind, id] = place.split(":");
    let name, speciesList, evalAt;
    if (kind === "coin") {
      const c = state.coins.find(x => x.id === id);
      if (!c) return;
      name = c.name;
      speciesList = c.species;
      evalAt = t => evaluateCoin(c, state.weather, t, null, state.coinWeather);
    } else {
      const i = ZONES.findIndex(z => z.id === id);
      if (i < 0) return;
      name = ZONES[i].name;
      speciesList = SPECIES.filter(sp => sp.habitats.some(h => ZONES[i].habitats.includes(h))).map(sp => sp.id);
      evalAt = t => evaluateZone(i, state.weather, t, null);
    }
    const answers = {};
    const times = state.weather[0].time;
    const opts = [];
    for (let d = 0; d <= 7 && state.todayIdx - d >= 14; d++) {
      const date = times[state.todayIdx - d];
      const label = d === 0 ? "Aujourd'hui" : d === 1 ? "Hier" : new Date(date + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
      opts.push(`<option value="${d}">${label}</option>`);
    }
    const rows = speciesList.map(sid => {
      const sp = speciesById[sid];
      return `<div class="answer" data-sp="${sid}">
        <span class="swatch" style="background:${sp.color}"></span>
        <span class="name">${sp.name}</span>
        <button type="button" class="seg" data-v="1" aria-pressed="false">Trouvé</button>
        <button type="button" class="seg" data-v="0" aria-pressed="false">Rien</button>
      </div>`;
    }).join("");
    showSheet(`
      <h2>Ma sortie</h2>
      <p class="muted">${esc(name)}</p>
      <form id="sortie-form" class="form">
        <label for="sortie-day">Date de la sortie</label>
        <select id="sortie-day">${opts.join("")}</select>
        <label>Qu'avez-vous trouvé ?</label>
        <p class="muted">Répondez seulement pour les champignons que vous avez cherchés.</p>
        ${rows}
        <p id="sortie-error" class="form-error" hidden></p>
        <div class="btn-row">
          <button class="btn" type="submit">Enregistrer</button>
          <button class="btn ghost" type="button" id="sortie-cancel">Annuler</button>
        </div>
      </form>
    `, "sortie", place);
    document.querySelectorAll(".answer .seg").forEach(b => b.addEventListener("click", () => {
      const row = b.closest(".answer"), sp = row.dataset.sp;
      const v = b.dataset.v === "1";
      const same = answers[sp] === v;
      if (same) delete answers[sp]; else answers[sp] = v;
      row.querySelectorAll(".seg").forEach(x => x.setAttribute("aria-pressed", String(!same && (x.dataset.v === "1") === v)));
    }));
    $("#sortie-cancel").addEventListener("click", () => kind === "coin" ? showCoin(id) : showZone(id));
    $("#sortie-form").addEventListener("submit", e => {
      e.preventDefault();
      const keys = Object.keys(answers);
      if (!keys.length) { const er = $("#sortie-error"); er.textContent = "Indiquez au moins un champignon trouvé ou non."; er.hidden = false; return; }
      const d = Number($("#sortie-day").value);
      const t = state.todayIdx - d;
      const raw = Object.fromEntries(evalAt(t).scores.map(x => [x.species.id, x.raw]));
      const date = times[t];
      // une seule réponse par lieu, espèce et jour : la nouvelle remplace l'ancienne
      state.observations = state.observations.filter(o => !(o.place === place && o.date === date && keys.includes(o.species)));
      keys.forEach(sp => state.observations.push({ id: newId(), date, place, species: sp, found: answers[sp], raw: raw[sp] || 0 }));
      state.calib = fitCalibration(state.observations);
      saveUserData();
      compute();
      toast("Sortie enregistrée : l'algorithme s'ajuste", 2500);
      kind === "coin" ? showCoin(id) : showZone(id);
    });
  }

  // ---------- Alertes et réglages ----------
  function backgroundSupport() {
    return "serviceWorker" in navigator && "periodicSync" in ServiceWorkerRegistration.prototype;
  }

  async function registerBackgroundCheck() {
    if (!backgroundSupport()) return "open";
    try {
      const reg = await navigator.serviceWorker.ready;
      if (!state.alertSettings.enabled) { await reg.periodicSync.unregister("champi-alertes"); return "off"; }
      const st = await navigator.permissions.query({ name: "periodic-background-sync" });
      if (st.state !== "granted") return "install";
      await reg.periodicSync.register("champi-alertes", { minInterval: 6 * 3600 * 1000 });
      return "background";
    } catch (e) { return "open"; }
  }

  async function checkAlerts() {
    if (!state.weather) return;
    state.alerts = computeAlerts({ weather: state.weather, coinWeather: state.coinWeather, coins: state.coins, calib: state.calib, settings: state.alertSettings });
    const btn = $("#btn-alerts");
    btn.classList.toggle("has-alerts", state.alertSettings.enabled && state.alerts.length > 0);
    if (openSheet.kind === "alerts") showAlerts();
    if (!state.alertSettings.enabled) return;
    let reg = null;
    try { reg = "serviceWorker" in navigator ? await navigator.serviceWorker.ready : null; } catch (e) { /* pas de SW */ }
    const fresh = await notifyNew(reg, state.alerts);
    if (fresh.length) toast(`🔔 ${fresh.length > 1 ? fresh.length + " alertes" : "Alerte"} : ${alertLine(fresh[0])}`, 6000);
  }

  function showAlerts() {
    const a = state.alertSettings;
    const perm = typeof Notification === "undefined" ? "unsupported" : Notification.permission;
    const chips = SPECIES.map(sp => `<button type="button" class="chip pick" data-sp="${sp.id}" aria-pressed="${a.species.includes(sp.id)}">
      <span class="swatch" style="background:${sp.color}"></span>${sp.name}</button>`).join("");
    const list = state.alerts.map(x => `<li data-${x.kind}="${x.id}">
        <span class="swatch" style="background:${speciesById[x.speciesId].color}"></span>
        <span class="txt"><b>${x.speciesName}</b><span>${x.kind === "coin" ? "★ " : ""}${esc(x.name)} · ${dayLabel(x.day, x.date)}</span></span>
        ${levelBadge(x.score)}<span class="score">${x.score} %</span></li>`).join("");

    // résumé de l'apprentissage
    const learned = SPECIES.filter(sp => state.calib.count[sp.id]).map(sp => {
      const b = state.calib.species[sp.id] || 0;
      const at50 = Math.round(100 / (1 + Math.exp(-b))) - 50;
      const txt = Math.abs(at50) < 2 ? "inchangé" : at50 > 0 ? `plus optimiste (+${at50} pts)` : `plus prudent (${at50} pts)`;
      return `<li class="hist"><span><i class="mini" style="background:${sp.color}"></i> ${sp.name}</span><span>${state.calib.count[sp.id]} sortie${state.calib.count[sp.id] > 1 ? "s" : ""}</span><b>${txt}</b></li>`;
    }).join("");

    showSheet(`
      <h2>Alertes et réglages</h2>
      <h3>Alertes de pousse</h3>
      <button class="toggle" id="al-toggle" aria-pressed="${a.enabled}">${a.enabled ? "✓ Alertes activées" : "Activer les alertes"}</button>
      <p class="muted" id="al-status"></p>
      ${perm === "denied" ? '<div class="alert">Les notifications sont bloquées pour ce site. Autorisez-les dans les réglages du navigateur ou du téléphone.</div>' : ""}
      <form class="form" id="al-form">
        <label>Prévenir à partir de</label>
        <div class="btn-row">
          <button type="button" class="seg" data-th="60" aria-pressed="${a.threshold === 60}">Bon (60 %)</button>
          <button type="button" class="seg" data-th="80" aria-pressed="${a.threshold === 80}">Excellent (80 %)</button>
        </div>
        <label>Où surveiller</label>
        <label class="check"><input type="checkbox" id="al-coins" ${a.coins ? "checked" : ""}> Mes coins (${state.coins.length})</label>
        <label class="check"><input type="checkbox" id="al-zones" ${a.zones ? "checked" : ""}> Tous les secteurs de la carte</label>
        <label>Champignons surveillés</label>
        <div class="pick-grid">${chips}</div>
      </form>
      <p class="muted">Période surveillée : aujourd'hui et les 3 prochains jours.</p>
      <button class="btn ghost" id="al-test">Tester une notification</button>

      <h3 id="alertes">Alertes en cours</h3>
      ${list ? `<ul class="rank">${list}</ul>` : `<p class="muted">Aucun ${a.coins && !a.zones ? "coin" : "lieu"} au-dessus du seuil pour l'instant.</p>`}

      <h3>Apprentissage de l'algorithme</h3>
      <p class="muted">${state.calib.total ? `${state.calib.total} réponse${state.calib.total > 1 ? "s" : ""} enregistrée${state.calib.total > 1 ? "s" : ""}. Pour une prévision à 50 %, l'appli est maintenant :` : "Notez vos sorties (bouton 📝 dans un coin ou un secteur) : l'appli comparera avec ses prévisions et s'ajustera."}</p>
      ${learned ? `<ul class="rank">${learned}</ul><button class="btn danger" id="al-reset">Effacer l'apprentissage</button>` : ""}

      <h3>Sauvegarde</h3>
      <p class="muted">Vos coins et sorties restent sur ce téléphone. Exportez-les pour les garder ou les passer sur un autre appareil.</p>
      <div class="btn-row">
        <button class="btn ghost" id="bk-export">⬇ Exporter</button>
        <label class="btn ghost" for="bk-import">⬆ Importer</label>
        <input type="file" id="bk-import" accept="application/json,.json" hidden>
      </div>
    `, "alerts", null);

    registerBackgroundCheck().then(mode => {
      const el = $("#al-status");
      if (!el) return;
      el.textContent = !a.enabled ? "Recevez une notification quand un coin passe au-dessus du seuil."
        : mode === "background" ? "Vérification automatique environ toutes les 6 heures, même appli fermée (le téléphone choisit le moment exact)."
        : mode === "install" ? "Vérification à chaque ouverture. Installez l'appli sur l'écran d'accueil pour la vérification automatique en arrière-plan."
        : "Vérification à chaque ouverture de l'appli (votre téléphone ne permet pas la vérification en arrière-plan).";
    });

    const save = () => { saveUserData(); checkAlerts(); };
    $("#al-toggle").addEventListener("click", async () => {
      if (!a.enabled) {
        if (typeof Notification !== "undefined" && Notification.permission === "default") {
          try { await Notification.requestPermission(); } catch (e) { /* refus */ }
        }
        a.enabled = true;
      } else a.enabled = false;
      save(); showAlerts();
    });
    document.querySelectorAll("#al-form .seg").forEach(b => b.addEventListener("click", () => {
      a.threshold = Number(b.dataset.th); save(); showAlerts();
    }));
    $("#al-coins").addEventListener("change", e => { a.coins = e.target.checked; save(); });
    $("#al-zones").addEventListener("change", e => { a.zones = e.target.checked; save(); });
    document.querySelectorAll("#al-form .pick").forEach(b => b.addEventListener("click", () => {
      const sp = b.dataset.sp, on = a.species.includes(sp);
      a.species = on ? a.species.filter(x => x !== sp) : [...a.species, sp];
      b.setAttribute("aria-pressed", String(!on));
      save();
    }));
    $("#al-test").addEventListener("click", async () => {
      if (typeof Notification === "undefined") return toast("Notifications non disponibles sur ce navigateur", 3500);
      if (Notification.permission === "default") await Notification.requestPermission();
      if (Notification.permission !== "granted") return toast("Notifications refusées", 3000);
      const reg = await navigator.serviceWorker.ready;
      reg.showNotification("🍄 Champi 85-17", { body: "Les alertes fonctionnent !", icon: "icons/icon-192.png", tag: "champi-test" });
    });
    const reset = $("#al-reset");
    if (reset) reset.addEventListener("click", () => {
      if (reset.dataset.confirm !== "1") { reset.dataset.confirm = "1"; reset.textContent = "Confirmer : effacer toutes les sorties"; return; }
      state.observations = [];
      state.calib = fitCalibration([]);
      saveUserData(); compute(); checkAlerts();
      toast("Apprentissage effacé", 2000);
    });
    $("#bk-export").addEventListener("click", () => {
      const data = { app: "champi-vendee", version: 1, exported: new Date().toISOString(),
        coins: state.coins, observations: state.observations, alertSettings: state.alertSettings };
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url; link.download = `champi-85-17-${todayStr()}.json`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    $("#bk-import").addEventListener("change", async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (data.app !== "champi-vendee" || !Array.isArray(data.coins)) throw new Error("format");
        const validCoin = c => c && typeof c.id === "string" && typeof c.lat === "number" && typeof c.lon === "number" && Array.isArray(c.species);
        const coins = data.coins.filter(validCoin).map(c => ({ ...c, name: String(c.name || "Coin"), species: c.species.filter(id => speciesById[id]) }));
        const obs = (data.observations || []).filter(o => o && speciesById[o.species] && typeof o.raw === "number");
        // fusion : les éléments importés remplacent ceux de même identifiant
        const ids = new Set(coins.map(c => c.id));
        state.coins = [...state.coins.filter(c => !ids.has(c.id)), ...coins];
        const oids = new Set(obs.map(o => o.id));
        state.observations = [...state.observations.filter(o => !oids.has(o.id)), ...obs];
        state.calib = fitCalibration(state.observations);
        saveUserData(); compute(); renderCoins(); checkAlerts();
        toast(`Import réussi : ${coins.length} coin${coins.length > 1 ? "s" : ""}, ${obs.length} réponse${obs.length > 1 ? "s" : ""}`, 3500);
        showAlerts();
      } catch (err) {
        toast("Fichier non reconnu : choisissez un export Champi (.json)", 4000);
      }
    });
  }

  function getPosition(cb) {
    if (!navigator.geolocation) return toast("Géolocalisation non disponible", 3000);
    toast("Recherche de votre position…");
    navigator.geolocation.getCurrentPosition(pos => {
      hideToast();
      cb({ lat: pos.coords.latitude, lon: pos.coords.longitude });
    }, () => toast("Position refusée ou indisponible", 3000), { enableHighAccuracy: true, timeout: 15000 });
  }

  function showList() {
    const items = [];
    state.results.forEach(r => visibleScores(r).forEach(s => items.push({ zone: r.zone, s })));
    items.sort((a, b) => b.s.score - a.s.score);
    const rows = items.slice(0, 40).map(({ zone, s }) => {
      const dist = state.userPos ? ` · ${distanceKm(state.userPos, zone).toFixed(0)} km` : "";
      return `<li data-zone="${zone.id}">
        <span class="swatch" style="background:${s.species.color}"></span>
        <span class="txt"><b>${s.species.name}</b><span>${zone.name}${dist}</span></span>
        ${levelBadge(s.score)}
        <span class="score">${s.score} %</span>
      </li>`;
    }).join("");
    const d = targetDate();
    showSheet(`
      <h2>Meilleurs coins</h2>
      <p class="muted">${state.day === 0 ? "Aujourd'hui" : d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })} · classement par probabilité de pousse</p>
      <ul class="rank">${rows || '<li class="muted">Conditions défavorables pour les espèces sélectionnées.</li>'}</ul>
    `, "list", null);
    document.querySelectorAll(".rank li[data-zone]").forEach(li => li.addEventListener("click", () => {
      const z = ZONES.find(x => x.id === li.dataset.zone);
      map.flyTo([z.lat, z.lon], 12, { duration: 0.8 });
      showZone(z.id);
    }));
  }

  function showInfo() {
    const updated = state.fetchedAt ? fmtDateTime(state.fetchedAt) : "jamais";
    showSheet(`
      <h2>Comment ça marche ?</h2>
      <p class="muted">Météo mise à jour : ${updated} · ${SOURCE_LABEL[state.weatherSource] || SOURCE_LABEL.auto}</p>
      <div class="alert"><b>⚠ Sécurité :</b> ne mangez jamais un champignon sans identification certaine.
        Faites vérifier votre cueillette par un pharmacien ou une association mycologique.
        En cas de malaise après consommation : appelez le 15 ou le centre antipoison.</div>
      <h3>La météo</h3>
      <p>L'appli utilise en priorité les modèles de <b>Météo-France</b> : AROME (maille d'environ 1,3 km) pour les 2 premiers jours, puis ARPEGE jusqu'à environ 4 jours. Au-delà, elle complète avec le meilleur modèle disponible. Les données passent par le service gratuit Open-Meteo.</p>
      <p>Chaque secteur a sa propre météo. <b>Chacun de vos coins a aussi la sienne</b>, calculée à ses coordonnées exactes : pluie, températures et humidité de votre parcelle.</p>
      <h3>L'algorithme</h3>
      <ul class="plain">
        <li><b>Pluie</b> : les champignons sortent 7 à 14 jours après une bonne pluie. On additionne les pluies de J-14 à J-3 (et un peu des 3 derniers jours) et on compare au besoin de chaque espèce (20 à 40 mm).</li>
        <li><b>Température</b> : moyenne des 7 derniers jours, comparée à la plage idéale de l'espèce.</li>
        <li><b>Humidité de l'air</b> : moyenne des 7 derniers jours (idéal &gt; 85 %).</li>
        <li><b>Gel et sécheresse</b> : pénalités si gelées ou temps sec récent.</li>
        <li><b>Saison</b> : chaque espèce a ses mois de pousse.</li>
        <li><b>Milieu</b> : chaque secteur est classé (chênes, châtaigniers, pins, prairies, bois mort…) et ne montre que les espèces qui y vivent.</li>
      </ul>
      <p>Le score combine ces facteurs : un seul facteur très défavorable (pas de pluie, trop froid) suffit à faire chuter la note. Les jours suivants utilisent les <b>prévisions</b> météo.</p>
      <p><b>Apprentissage</b> : quand vous notez une sortie (trouvé / rien trouvé), l'appli compare avec ce qu'elle avait prévu et ajuste ses scores pour chaque espèce et chaque lieu. Plus vous notez de sorties, plus elle colle à votre terrain.</p>
      <h3>Légende</h3>
      <p><span class="lvl lvl-5">Excellent</span> ≥ 80 % · <span class="lvl lvl-4">Bon</span> ≥ 60 % · <span class="lvl lvl-3">Moyen</span> ≥ 35 % · <span class="lvl lvl-2">Faible</span> ≥ 15 %</p>
      <p><b>Bois par bois</b> : en zoomant (à partir de l'échelle d'un village), chaque bois est colorié avec le champignon le plus probable du jour, d'après la carte forestière de l'IGN (chênes, châtaigniers, pins…). Touchez un bois pour voir tous ses champignons.</p>
      <p>Sur la carte, chaque secteur affiche une pastille par espèce probable (plus elle est grosse, plus la probabilité est forte). Touchez un secteur pour le détail. Touchez un champignon en bas de l'écran pour ouvrir sa fiche (photo, milieu, saison) et choisir de l'afficher ou non sur la carte.</p>
      <h3>Bonnes pratiques</h3>
      <ul class="plain">
        <li>Respectez les propriétés privées et la réglementation locale (certaines communes ou forêts limitent la cueillette).</li>
        <li>Cueillette raisonnable, pour votre consommation personnelle.</li>
        <li>Utilisez un panier, coupez proprement, laissez les jeunes et les vieux exemplaires.</li>
      </ul>
      <p class="muted">Les secteurs indiqués sont des milieux favorables, pas des coins garantis. Probabilité indicative.</p>
    `, "info", null);
  }

  const HABITAT_LABELS = {
    feuillus: "Feuillus", chenes: "Chênes", chataigniers: "Châtaigniers", hetres: "Hêtres",
    pins: "Pins", dunes: "Dunes", prairies: "Prairies", haies: "Haies",
    lisiere: "Lisières", boismort: "Bois mort", peupliers: "Peupliers"
  };

  // ---------- Géolocalisation ----------
  function distanceKm(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function locate() {
    if (!navigator.geolocation) return toast("Géolocalisation non disponible", 3000);
    toast("Recherche de votre position…");
    navigator.geolocation.getCurrentPosition(pos => {
      hideToast();
      state.userPos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      const ll = [state.userPos.lat, state.userPos.lon];
      if (userMarker) userMarker.setLatLng(ll);
      else userMarker = L.marker(ll, {
        icon: L.divIcon({ className: "zone-icon", html: '<div class="user-pos"></div>', iconSize: [0, 0] }),
        zIndexOffset: 5000, interactive: false
      }).addTo(map);
      if (bounds.pad(0.1).contains(ll)) map.flyTo(ll, 11, { duration: 0.8 });
      else toast("Vous êtes hors Vendée / Charente-Maritime : les distances restent affichées.", 3500);
      if (openSheet.kind === "zone") showZone(openSheet.id);
      if (openSheet.kind === "list") showList();
    }, () => toast("Position refusée ou indisponible", 3000), { enableHighAccuracy: true, timeout: 15000 });
  }

  // ---------- Divers ----------
  let toastTimer = null;
  function toast(msg, ms) {
    const el = $("#toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    if (ms) toastTimer = setTimeout(hideToast, ms);
  }
  function hideToast() { $("#toast").hidden = true; }

  function fmtDateTime(ts) {
    return new Date(ts).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  $("#btn-list").addEventListener("click", () => state.results.length ? showList() : toast("Météo pas encore chargée", 2500));
  $("#btn-locate").addEventListener("click", locate);
  $("#btn-info").addEventListener("click", showInfo);
  $("#btn-coins").addEventListener("click", showCoins);
  $("#btn-alerts").addEventListener("click", showAlerts);

  renderLegend();
  renderCoins();
  restoreUserData();
  loadWeather();
  if (location.hash === "#alertes") showAlerts();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.fetchedAt && Date.now() - state.fetchedAt > CACHE_TTL) loadWeather();
  });

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
