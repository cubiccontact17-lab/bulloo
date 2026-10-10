(function () {
  "use strict";

  const PAST_DAYS = 21;
  const FORECAST_DAYS = 8;
  const CACHE_KEY = "champi-meteo-v1";
  const CACHE_TTL = 60 * 60 * 1000; // 1 h
  const MIN_SHOWN = 15;             // score minimum pour afficher une espèce
  const PREFS_KEY = "champi-prefs-v1";

  const state = {
    day: 0,
    enabled: new Set(SPECIES.map(s => s.id)),
    weather: null,   // tableau par secteur : { time, tmax, tmin, precip, rh }
    todayIdx: PAST_DAYS,
    fetchedAt: null,
    results: [],     // par secteur : { zone, ws, scores: [{species, score, factors}] }
    userPos: null
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

  const prefs = storeGet(PREFS_KEY);
  if (prefs && Array.isArray(prefs.enabled)) {
    state.enabled = new Set(prefs.enabled.filter(id => speciesById[id]));
  }
  function savePrefs() { storeSet(PREFS_KEY, { enabled: [...state.enabled] }); }

  // ---------- Carte ----------
  const bounds = L.latLngBounds(VENDEE_OUTLINE.flat());
  const map = L.map("map", {
    zoomControl: false,
    maxBounds: bounds.pad(0.25),
    maxBoundsViscosity: 0.8,
    minZoom: 8
  }).fitBounds(bounds, { padding: [10, 10] });
  L.control.zoom({ position: "bottomright" }).addTo(map);

  const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  });
  const topo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
    maxZoom: 17,
    attribution: '&copy; OpenStreetMap, SRTM | &copy; <a href="https://opentopomap.org">OpenTopoMap</a>'
  });
  const sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19,
    attribution: "Imagerie &copy; Esri"
  });
  osm.addTo(map);
  L.control.layers({ "Plan": osm, "Relief / forêts": topo, "Satellite": sat }, null, { position: "topright" }).addTo(map);

  // Masque hors Vendée + contour du département
  const world = [[85, -180], [85, 180], [-85, 180], [-85, -180]];
  L.polygon([world, ...VENDEE_OUTLINE], {
    stroke: false, fillColor: "#3d2b1f", fillOpacity: 0.35, interactive: false
  }).addTo(map);
  L.polygon(VENDEE_OUTLINE, {
    color: "#3d2b1f", weight: 2.5, fill: false, interactive: false
  }).addTo(map);

  const zoneLayer = L.layerGroup().addTo(map);
  let lastCompact = null;
  map.on("zoomend", () => {
    const compact = map.getZoom() < 10;
    if (compact !== lastCompact && state.results.length) renderMap();
  });
  let userMarker = null;

  // ---------- Météo (Open-Meteo, gratuit, sans clé) ----------
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

  function todayStr() {
    // Date du jour en France (YYYY-MM-DD)
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
  }

  async function loadWeather() {
    const cached = storeGet(CACHE_KEY);
    const fresh = cached && cached.zones === ZONES.length && Date.now() - cached.at < CACHE_TTL &&
      cached.data[0].time.includes(todayStr());
    if (fresh) return useWeather(cached.data, cached.at);

    toast("Chargement de la météo…");
    try {
      const res = await fetch(weatherUrl());
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = parseWeather(await res.json());
      if (data.length !== ZONES.length) throw new Error("réponse incomplète");
      storeSet(CACHE_KEY, { at: Date.now(), zones: ZONES.length, data });
      hideToast();
      useWeather(data, Date.now());
    } catch (err) {
      if (cached && cached.data) {
        toast("Hors ligne : météo du " + fmtDateTime(cached.at), 4000);
        useWeather(cached.data, cached.at);
      } else {
        toast("Impossible de charger la météo. Vérifiez votre connexion.", 6000);
        $("#subtitle").textContent = "Météo indisponible";
      }
    }
  }

  function useWeather(data, at) {
    state.weather = data;
    state.fetchedAt = at;
    const idx = data[0].time.indexOf(todayStr());
    state.todayIdx = idx >= 0 ? idx : PAST_DAYS;
    const maxDay = data[0].time.length - 1 - state.todayIdx;
    if (state.day > maxDay) state.day = maxDay;
    renderDays();
    compute();
  }

  // ---------- Calcul ----------
  function targetDate() {
    const t = state.todayIdx + state.day;
    return state.weather ? new Date(state.weather[0].time[t] + "T12:00:00") : new Date();
  }

  function compute() {
    if (!state.weather) return;
    const t = state.todayIdx + state.day;
    const month = targetDate().getMonth() + 1;
    state.results = ZONES.map((zone, i) => {
      const ws = weatherSummary(state.weather[i], t);
      const scores = SPECIES.map(sp => ({ species: sp, ...scoreSpecies(sp, zone, ws, month) }))
        .sort((a, b) => b.score - a.score);
      return { zone, ws, scores };
    });
    renderMap();
    renderSubtitle();
    if (openSheet.kind === "zone") showZone(openSheet.id);
    if (openSheet.kind === "list") showList();
    if (openSheet.kind === "fiche") showFiche(openSheet.id);
  }

  // ---------- Rendu ----------
  function visibleScores(r) {
    return r.scores.filter(s => state.enabled.has(s.species.id) && s.score >= MIN_SHOWN);
  }

  function renderMap() {
    zoneLayer.clearLayers();
    lastCompact = map.getZoom() < 10;
    state.results.forEach(r => {
      const vis = visibleScores(r);
      const best = vis[0];
      L.circle([r.zone.lat, r.zone.lon], {
        radius: r.zone.radius,
        color: best ? best.species.color : "#9e9e9e",
        weight: 1.5,
        opacity: best ? 0.9 : 0.4,
        fillColor: best ? best.species.color : "#9e9e9e",
        fillOpacity: best ? 0.08 + 0.3 * best.score / 100 : 0.05
      }).on("click", () => showZone(r.zone.id)).addTo(zoneLayer);

      // Vue d'ensemble : pastilles compactes (3 max) ; zoomé : jusqu'à 8
      const compact = map.getZoom() < 10;
      const dots = vis.slice(0, compact ? 3 : 8).map(s => {
        const size = Math.round(compact ? 7 + s.score / 14 : 9 + s.score / 9);
        return `<i class="dot" style="width:${size}px;height:${size}px;background:${s.species.color}"></i>`;
      }).join("");
      const html = `<div class="zone-dots${vis.length ? "" : " empty"}${compact ? " compact" : ""}">${dots}</div>`;
      L.marker([r.zone.lat, r.zone.lon], {
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
    if (openSheet.kind === "fiche") showFiche(openSheet.id);
    if (!state.results.length) return;
    renderMap();
    renderSubtitle();
    if (openSheet.kind === "zone") showZone(openSheet.id);
    if (openSheet.kind === "list") showList();
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
    const li = e.target.closest("li[data-zone]");
    if (li && openSheet.kind === "fiche") {
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
          <div class="bar"><i style="width:${s.score}%;background:${sp.color}"></i></div>
          <div class="factors">${factors}</div>
          <p>${sp.tips}</p>
          <p class="warn">⚠ Confusions : ${sp.lookalikes}</p>
          <button class="link-btn" data-fiche="${sp.id}">Voir la fiche complète →</button>
        </details>`;
      }).join("");

    const dist = state.userPos ? ` · à ${distanceKm(state.userPos, zone).toFixed(0)} km` : "";
    const nav = `https://www.google.com/maps/dir/?api=1&destination=${zone.lat},${zone.lon}`;
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
      <h3>Champignons possibles</h3>
      ${rows || '<p class="muted">Aucune espèce sélectionnée ne correspond à ce milieu.</p>'}
      <a class="btn" href="${nav}" target="_blank" rel="noopener">🧭 Itinéraire</a>
    `, "zone", id);
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
      <p class="muted">Météo mise à jour : ${updated} · source Open-Meteo</p>
      <div class="alert"><b>⚠ Sécurité :</b> ne mangez jamais un champignon sans identification certaine.
        Faites vérifier votre cueillette par un pharmacien ou une association mycologique.
        En cas de malaise après consommation : appelez le 15 ou le centre antipoison.</div>
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
      <h3>Légende</h3>
      <p><span class="lvl lvl-5">Excellent</span> ≥ 80 % · <span class="lvl lvl-4">Bon</span> ≥ 60 % · <span class="lvl lvl-3">Moyen</span> ≥ 35 % · <span class="lvl lvl-2">Faible</span> ≥ 15 %</p>
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
    lisiere: "Lisières", boismort: "Bois mort"
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
      else toast("Vous êtes hors de Vendée : les distances restent affichées.", 3500);
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

  renderLegend();
  loadWeather();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.fetchedAt && Date.now() - state.fetchedAt > CACHE_TTL) loadWeather();
  });

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
