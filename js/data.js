// Données : espèces comestibles et secteurs de cueillette en Vendée et Charente-Maritime.
//
// Habitats utilisés :
//   feuillus, chenes, chataigniers, hetres, pins, dunes, peupliers,
//   prairies, haies, lisiere, boismort
//
// Pour chaque espèce :
//   season  : poids de saison par mois (1 = janvier … 12 = décembre), 0 → 1
//   temp    : [min, optimum bas, optimum haut, max] en °C (moyenne sur 7 jours)
//   rainMin : cumul de pluie (mm) sur les ~2 semaines précédentes pour une pousse optimale
//   frostTolerant : supporte mieux les premières gelées

const SPECIES = [
  {
    id: "cepe",
    name: "Cèpe de Bordeaux",
    latin: "Boletus edulis",
    color: "#7a4a1f",
    habitats: ["feuillus", "chenes", "chataigniers", "hetres", "pins"],
    season: { 6: 0.3, 7: 0.4, 8: 0.7, 9: 1, 10: 1, 11: 0.6 },
    temp: [8, 13, 20, 25],
    rainMin: 40,
    tips: "Sous chênes et châtaigniers, en lisière claire, souvent après un gros orage chaud suivi de nuits fraîches.",
    lookalikes: "Bolet amer (chair très amère, réseau foncé sur le pied), bolet de Satan (pores rouges, toxique). Le cèpe a des pores blancs à jaune-vert et un réseau blanc en haut du pied."
  },
  {
    id: "girolle",
    name: "Girolle",
    latin: "Cantharellus cibarius",
    color: "#ffb000",
    habitats: ["chenes", "chataigniers", "hetres", "feuillus"],
    season: { 6: 0.6, 7: 0.8, 8: 0.8, 9: 1, 10: 0.9, 11: 0.4 },
    temp: [10, 14, 22, 27],
    rainMin: 30,
    tips: "Dans la mousse, sur sols acides sous chênes et châtaigniers. Revient souvent aux mêmes endroits.",
    lookalikes: "Clitocybe de l'olivier (toxique, vraies lames, pousse en touffe sur souche), fausse girolle. La girolle a des plis épais et fourchus, pas des lames."
  },
  {
    id: "trompette",
    name: "Trompette des morts",
    latin: "Craterellus cornucopioides",
    color: "#222222",
    habitats: ["hetres", "chenes", "feuillus"],
    season: { 8: 0.3, 9: 0.7, 10: 1, 11: 1, 12: 0.5 },
    temp: [5, 9, 16, 20],
    rainMin: 35,
    tips: "En troupes dans les feuilles mortes, sols argileux et frais. Très discrète : regarder à contre-jour.",
    lookalikes: "Peu de confusions dangereuses. Forme d'entonnoir creux, gris-noir, sans lames."
  },
  {
    id: "piedmouton",
    name: "Pied de mouton",
    latin: "Hydnum repandum",
    color: "#f5deb3",
    habitats: ["feuillus", "chenes", "hetres", "pins"],
    season: { 9: 0.7, 10: 1, 11: 1, 12: 0.6 },
    temp: [3, 7, 15, 19],
    rainMin: 30,
    tips: "En ronds ou en lignes, sous feuillus et conifères. Supporte bien les premiers froids.",
    lookalikes: "Peu de confusions : aiguillons (petites pointes) sous le chapeau au lieu de lames."
  },
  {
    id: "chanterelletube",
    name: "Chanterelle en tube",
    latin: "Craterellus tubaeformis",
    color: "#2a9d8f",
    habitats: ["pins", "feuillus", "hetres"],
    season: { 10: 0.8, 11: 1, 12: 1, 1: 0.5 },
    temp: [2, 5, 13, 17],
    rainMin: 30,
    tips: "En grandes colonies dans la mousse humide, souvent en fin de saison.",
    lookalikes: "Peu de confusions dangereuses : pied creux jaune, plis gris sous le chapeau."
  },
  {
    id: "lactaire",
    name: "Lactaire délicieux",
    latin: "Lactarius deliciosus",
    color: "#e8590c",
    habitats: ["pins"],
    season: { 9: 0.8, 10: 1, 11: 1, 12: 0.5 },
    temp: [6, 10, 18, 22],
    rainMin: 30,
    tips: "Sous les pins maritimes des forêts littorales (Monts, Olonne, Longeville, la Coubre, Oléron).",
    lookalikes: "Lactaire à toison (toxique, lait blanc, chapeau poilu). Le lactaire délicieux a un lait orange carotte."
  },
  {
    id: "coulemelle",
    name: "Coulemelle",
    latin: "Macrolepiota procera",
    color: "#6a994e",
    habitats: ["lisiere", "prairies", "haies", "pins"],
    season: { 7: 0.5, 8: 0.8, 9: 1, 10: 1, 11: 0.5 },
    temp: [10, 14, 22, 27],
    rainMin: 25,
    tips: "En lisière, clairières et bords de prés. Grand chapeau écailleux, anneau coulissant.",
    lookalikes: "Petites lépiotes MORTELLES. Ne cueillir que des chapeaux de plus de 10 cm, pied chiné et anneau coulissant."
  },
  {
    id: "rose",
    name: "Rosé des prés",
    latin: "Agaricus campestris",
    color: "#e75480",
    habitats: ["prairies"],
    season: { 5: 0.3, 6: 0.4, 8: 0.8, 9: 1, 10: 1, 11: 0.4 },
    temp: [10, 14, 22, 26],
    rainMin: 25,
    tips: "Prairies pâturées (chevaux, vaches) du bocage et des marais, après pluie chaude.",
    lookalikes: "Amanites phalloïde et vireuse (MORTELLES, lames blanches, volve à la base). Le rosé a des lames roses puis brunes, jamais blanches."
  },
  {
    id: "piedbleu",
    name: "Pied bleu",
    latin: "Lepista nuda",
    color: "#7b4fc9",
    habitats: ["feuillus", "pins", "haies", "lisiere"],
    season: { 10: 0.7, 11: 1, 12: 1, 1: 0.6 },
    temp: [0, 4, 12, 16],
    rainMin: 30,
    tips: "Dans les litières épaisses de feuilles ou d'aiguilles, souvent en ronds, tard en saison.",
    lookalikes: "Cortinaires violets (toxiques, cortine en toile d'araignée, sporée rouille). Le pied bleu a une sporée rose pâle."
  },
  {
    id: "pleurote",
    name: "Pleurote en huître",
    latin: "Pleurotus ostreatus",
    color: "#4f86c6",
    habitats: ["boismort"],
    season: { 10: 0.6, 11: 1, 12: 1, 1: 1, 2: 0.8, 3: 0.5 },
    temp: [0, 4, 13, 17],
    rainMin: 25,
    tips: "En étages sur troncs et souches de feuillus (peupliers, hêtres) le long des vallées humides.",
    lookalikes: "Peu de confusions dangereuses sur bois. Pas de pied ou pied latéral très court."
  },
  {
    id: "morille",
    name: "Morille",
    latin: "Morchella sp.",
    color: "#c1121f",
    habitats: ["lisiere", "haies", "feuillus"],
    season: { 3: 0.8, 4: 1, 5: 0.6 },
    temp: [5, 9, 17, 21],
    rainMin: 25,
    tips: "Au printemps, sous frênes et ormes, haies, bords de rivières et zones remuées.",
    lookalikes: "Gyromitre (MORTEL, chapeau cérébriforme, intérieur cloisonné). La morille est entièrement creuse. Toujours bien cuire."
  },
  {
    id: "mousseron",
    name: "Mousseron de la Saint-Georges",
    latin: "Calocybe gambosa",
    color: "#8d99ae",
    habitats: ["prairies", "haies", "lisiere"],
    season: { 4: 1, 5: 1, 6: 0.3 },
    temp: [6, 10, 17, 21],
    rainMin: 20,
    tips: "En ronds dans l'herbe, au pied des haies, autour du 23 avril. Forte odeur de farine.",
    lookalikes: "Entolome livide (toxique) et inocybe de Patouillard (MORTEL). Vérifier l'odeur de farine et les lames blanches serrées."
  },
  {
    id: "boletorange",
    name: "Bolet orangé",
    latin: "Leccinum aurantiacum",
    color: "#a44a3f",
    habitats: ["peupliers", "chenes", "feuillus"],
    season: { 6: 0.3, 7: 0.6, 8: 0.9, 9: 1, 10: 0.8, 11: 0.3 },
    temp: [10, 14, 21, 26],
    rainMin: 30,
    tips: "Sous les peupliers et les trembles, parfois sous les chênes et les bouleaux, en bord de chemin et de lisière humide.",
    lookalikes: "Pas de sosie mortel. Bolet de Satan (toxique) : pores ROUGES et pied ventru rose. Le bolet orangé a des pores blanc-gris et un pied couvert de petites écailles brunes à noires. Toujours BIEN CUIT : cru ou peu cuit, il rend malade."
  },
  {
    id: "cesar",
    name: "Amanite des Césars",
    latin: "Amanita caesarea",
    color: "#c6d81e",
    habitats: ["chenes", "chataigniers", "lisiere"],
    season: { 6: 0.3, 7: 0.7, 8: 1, 9: 1, 10: 0.6 },
    temp: [14, 18, 26, 31],
    rainMin: 30,
    abundance: 0.6, // espèce méridionale, rare dans nos deux départements
    expert: true,
    tips: "Espèce de chaleur : après les orages d'été et de début d'automne, dans les chênaies et châtaigneraies claires sur sol sableux ou acide. Rare ici.",
    lookalikes: "Amanite tue-mouches (TOXIQUE, chapeau rouge à flocons blancs, lames et pied BLANCS). Au stade d'œuf, confusion possible avec les amanites MORTELLES (phalloïde, panthère) : ne jamais cueillir d'œuf fermé."
  }
];

// Secteurs de cueillette (forêts, bois, bocages et prairies), dept = n° du département.
// Coordonnées approximatives du cœur du massif ; radius en mètres.
const ZONES = [
  { id: "mervent", dept: "85", name: "Forêt de Mervent-Vouvant (sud)", lat: 46.523, lon: -0.766, radius: 3500,
    habitats: ["feuillus", "chenes", "chataigniers", "hetres", "lisiere", "boismort"],
    note: "Plus grand massif de feuillus de Vendée, très riche." },
  { id: "vouvant", dept: "85", name: "Forêt de Mervent-Vouvant (nord)", lat: 46.565, lon: -0.775, radius: 2500,
    habitats: ["feuillus", "chenes", "chataigniers", "hetres", "pins"],
    note: "Partie nord du massif, quelques parcelles de résineux." },
  { id: "aizenay", dept: "85", name: "Forêt d'Aizenay", lat: 46.755, lon: -1.580, radius: 2500,
    habitats: ["pins", "chenes", "feuillus", "lisiere"],
    note: "Forêt domaniale mixte pins / chênes." },
  { id: "chaize", dept: "85", name: "Forêt de La Chaize-le-Vicomte", lat: 46.680, lon: -1.270, radius: 2000,
    habitats: ["feuillus", "chenes", "chataigniers", "boismort"],
    note: "Chênaie-châtaigneraie sur sols acides." },
  { id: "grasla", dept: "85", name: "Forêt de Grasla (Les Brouzils)", lat: 46.880, lon: -1.325, radius: 2500,
    habitats: ["feuillus", "chenes", "chataigniers", "lisiere"],
    note: "Grande chênaie du bocage." },
  { id: "monts-nord", dept: "85", name: "Forêt des Pays-de-Monts (Notre-Dame-de-Monts)", lat: 46.840, lon: -2.135, radius: 3500,
    habitats: ["pins", "dunes", "chenes"],
    note: "Pins maritimes et chênes verts sur dunes." },
  { id: "monts-sud", dept: "85", name: "Forêt des Pays-de-Monts (Saint-Jean-de-Monts)", lat: 46.770, lon: -2.050, radius: 3000,
    habitats: ["pins", "dunes"],
    note: "Pinède littorale." },
  { id: "riez", dept: "85", name: "Forêt de Sion / Saint-Hilaire-de-Riez", lat: 46.705, lon: -1.975, radius: 2000,
    habitats: ["pins", "dunes", "lisiere"],
    note: "Pinède dunaire." },
  { id: "olonne", dept: "85", name: "Forêt d'Olonne", lat: 46.550, lon: -1.830, radius: 3500,
    habitats: ["pins", "chenes", "dunes"],
    note: "Pins maritimes et chênes verts." },
  { id: "jard", dept: "85", name: "Bois de Jard / Saint-Vincent-sur-Jard", lat: 46.420, lon: -1.560, radius: 2000,
    habitats: ["pins", "chenes"],
    note: "Pinède et chênaie verte." },
  { id: "longeville", dept: "85", name: "Forêt de Longeville-sur-Mer", lat: 46.405, lon: -1.495, radius: 3000,
    habitats: ["pins", "chenes", "dunes"],
    note: "Grande pinède littorale." },
  { id: "tranche", dept: "85", name: "Forêt de La Tranche-sur-Mer", lat: 46.355, lon: -1.420, radius: 2500,
    habitats: ["pins", "dunes"],
    note: "Pinède dunaire." },
  { id: "noirmoutier", dept: "85", name: "Bois de la Chaize (Noirmoutier)", lat: 47.005, lon: -2.220, radius: 1200,
    habitats: ["pins", "chenes"],
    note: "Pins et chênes verts sur l'île." },
  { id: "soubise", dept: "85", name: "Parc Soubise (Mouchamps)", lat: 46.785, lon: -1.040, radius: 1500,
    habitats: ["feuillus", "chenes", "hetres", "lisiere"],
    note: "Vieux bois de feuillus du Haut-Bocage." },
  { id: "pouzauges", dept: "85", name: "Bois de la Folie (Pouzauges)", lat: 46.785, lon: -0.835, radius: 1200,
    habitats: ["feuillus", "chenes", "chataigniers", "lisiere"],
    note: "Sommet boisé du Haut-Bocage." },
  { id: "alouettes", dept: "85", name: "Mont des Alouettes (Les Herbiers)", lat: 46.865, lon: -1.010, radius: 2000,
    habitats: ["feuillus", "chataigniers", "pins", "lisiere"],
    note: "Collines boisées du Haut-Bocage." },
  { id: "sevre", dept: "85", name: "Vallée de la Sèvre nantaise (Mortagne)", lat: 46.985, lon: -1.060, radius: 2500,
    habitats: ["feuillus", "chenes", "boismort", "lisiere"],
    note: "Coteaux boisés et vallée humide." },
  { id: "yon", dept: "85", name: "Vallée de l'Yon (La Roche-sur-Yon)", lat: 46.700, lon: -1.400, radius: 2000,
    habitats: ["feuillus", "boismort", "prairies", "haies", "peupliers"],
    note: "Bois et prairies humides de bord de rivière." },
  { id: "lay", dept: "85", name: "Bocage de Mareuil / vallée du Lay", lat: 46.535, lon: -1.235, radius: 3000,
    habitats: ["prairies", "haies", "lisiere", "boismort"],
    note: "Prairies et haies bocagères." },
  { id: "chantonnay", dept: "85", name: "Bocage de Chantonnay", lat: 46.690, lon: -1.050, radius: 3000,
    habitats: ["prairies", "haies", "lisiere"],
    note: "Prairies pâturées et haies." },
  { id: "montaigu", dept: "85", name: "Bocage de Montaigu / Rocheservière", lat: 46.925, lon: -1.350, radius: 3000,
    habitats: ["prairies", "haies", "lisiere"],
    note: "Bocage du nord Vendée." },
  { id: "fontenay", dept: "85", name: "Prairies de la vallée de la Vendée (Fontenay)", lat: 46.470, lon: -0.810, radius: 2500,
    habitats: ["prairies", "haies", "boismort", "peupliers"],
    note: "Prairies et peupleraies." },
  { id: "marais-poitevin", dept: "85", name: "Prairies du Marais poitevin (Luçon)", lat: 46.400, lon: -1.050, radius: 5000,
    habitats: ["prairies", "haies", "peupliers"],
    note: "Grandes prairies pâturées." },
  { id: "marais-breton", dept: "85", name: "Prairies du Marais breton (Challans)", lat: 46.880, lon: -1.920, radius: 4000,
    habitats: ["prairies"],
    note: "Prairies humides pâturées." },
  // ----- Charente-Maritime (17) -----
  { id: "coubre", dept: "17", name: "Forêt de la Coubre (La Tremblade)", lat: 45.715, lon: -1.195, radius: 4500,
    habitats: ["pins", "chenes", "dunes", "lisiere"],
    note: "Grande pinède littorale de pins maritimes et chênes verts." },
  { id: "saint-trojan", dept: "17", name: "Forêt de Saint-Trojan (Oléron)", lat: 45.835, lon: -1.225, radius: 3000,
    habitats: ["pins", "chenes", "dunes"],
    note: "Pinède dunaire du sud de l'île d'Oléron." },
  { id: "saumonards", dept: "17", name: "Forêt des Saumonards (Oléron)", lat: 45.965, lon: -1.250, radius: 2000,
    habitats: ["pins", "chenes", "dunes"],
    note: "Pins maritimes et chênes verts au nord-est de l'île." },
  { id: "re", dept: "17", name: "Bois de Trousse-Chemise (Île de Ré)", lat: 46.235, lon: -1.490, radius: 1200,
    habitats: ["pins", "chenes", "dunes"],
    note: "Petit bois de pins et chênes verts au nord de l'île." },
  { id: "suzac", dept: "17", name: "Forêt de Suzac (Meschers)", lat: 45.580, lon: -0.985, radius: 1500,
    habitats: ["chenes", "pins", "lisiere"],
    note: "Chênaie verte et pins sur les falaises de l'estuaire." },
  { id: "benon", dept: "17", name: "Forêt de Benon", lat: 46.200, lon: -0.820, radius: 3500,
    habitats: ["feuillus", "chenes", "chataigniers", "lisiere", "boismort"],
    note: "Grande chênaie de l'Aunis, au nord-est de La Rochelle." },
  { id: "aulnay", dept: "17", name: "Forêt d'Aulnay", lat: 46.035, lon: -0.330, radius: 2500,
    habitats: ["feuillus", "chenes", "hetres", "lisiere", "boismort"],
    note: "Massif de feuillus de la Saintonge du nord-est." },
  { id: "montendre", dept: "17", name: "Forêts de la Double saintongeaise (Montendre)", lat: 45.285, lon: -0.390, radius: 4500,
    habitats: ["pins", "chataigniers", "chenes", "lisiere"],
    note: "Pins maritimes, châtaigniers et landes du sud du département." },
  { id: "montguyon", dept: "17", name: "Bois de Montguyon", lat: 45.215, lon: -0.190, radius: 3000,
    habitats: ["pins", "chataigniers", "chenes", "feuillus"],
    note: "Bois mixtes de la Double, à l'est de Montendre." },
  { id: "jonzac", dept: "17", name: "Bois de Haute-Saintonge (Jonzac)", lat: 45.440, lon: -0.450, radius: 3000,
    habitats: ["feuillus", "chenes", "chataigniers", "haies", "lisiere"],
    note: "Bois et bocage autour de Jonzac." },
  { id: "charente", dept: "17", name: "Vallée de la Charente (Saintes)", lat: 45.765, lon: -0.660, radius: 3000,
    habitats: ["prairies", "haies", "boismort", "feuillus", "peupliers"],
    note: "Prairies inondables, frênes et peupliers." },
  { id: "boutonne", dept: "17", name: "Vallée de la Boutonne (Saint-Jean-d'Angély)", lat: 45.945, lon: -0.520, radius: 2500,
    habitats: ["prairies", "haies", "boismort", "peupliers"],
    note: "Prairies et peupleraies de la vallée." },
  { id: "brouage", dept: "17", name: "Prairies du marais de Brouage", lat: 45.860, lon: -1.050, radius: 4000,
    habitats: ["prairies"],
    note: "Grandes prairies pâturées entre Rochefort et Marennes." },
  { id: "marans", dept: "17", name: "Prairies du Marais poitevin (Marans)", lat: 46.290, lon: -0.980, radius: 3500,
    habitats: ["prairies", "haies"],
    note: "Prairies pâturées du sud du Marais poitevin." }
];


// Fiches descriptives (photo chargée depuis Wikipédia via le titre "wiki").
const FICHES = {
  cepe: {
    wiki: "Boletus edulis",
    size: "Chapeau 8 à 25 cm",
    ident: "Chapeau brun noisette, bombé, comme une brioche. Dessous à tubes (une éponge) blancs puis jaune-vert, jamais rouges. Pied épais et ventru, avec un fin réseau blanc en haut. Chair blanche qui ne bleuit pas.",
    milieu: "Chênaies et châtaigneraies claires, lisières, bords d'allées. En Vendée : massif de Mervent-Vouvant, forêts de Grasla, de La Chaize et d'Aizenay, et sous les pins des forêts littorales. En Charente-Maritime : forêts de Benon et d'Aulnay, Double saintongeaise.",
    cuisine: "Poêlé à l'ail et au persil, en omelette ou séché. Retirer les tubes s'ils sont mous."
  },
  girolle: {
    wiki: "Cantharellus cibarius",
    size: "Chapeau 3 à 10 cm",
    ident: "Jaune d'œuf, en forme d'entonnoir aux bords ondulés. Dessous avec des plis épais et fourchus qui descendent sur le pied (pas de vraies lames). Odeur fruitée d'abricot. Chair blanche et ferme.",
    milieu: "Dans la mousse, sur sol acide, sous chênes, châtaigniers et hêtres. En Vendée : Mervent-Vouvant, Grasla, Bois de la Folie, Haut-Bocage. En Charente-Maritime : Benon, Double saintongeaise.",
    cuisine: "Sautée à la poêle, sans trop la laver, avec beurre et échalote."
  },
  trompette: {
    wiki: "Craterellus cornucopioides",
    size: "Hauteur 5 à 12 cm",
    ident: "Cornet creux gris-noir, fin comme du cuir. Extérieur gris cendré et lisse, sans lames. Très difficile à voir dans les feuilles mortes.",
    milieu: "En troupes sous hêtres et chênes, sur sol frais et argileux. En Vendée : Mervent-Vouvant, Parc Soubise, vallée de la Sèvre. En Charente-Maritime : forêt d'Aulnay.",
    cuisine: "Excellente séchée puis réduite en poudre, ou en sauce avec une volaille."
  },
  piedmouton: {
    wiki: "Hydnum repandum",
    size: "Chapeau 4 à 15 cm",
    ident: "Chapeau crème à orangé pâle, irrégulier. Dessous couvert de petits aiguillons (comme des pointes) au lieu de lames. Chair blanche, cassante.",
    milieu: "En ronds ou en lignes sous feuillus et conifères. Supporte les premiers froids. Dans les forêts de feuillus et les pinèdes des deux départements.",
    cuisine: "Bien cuit à la poêle. Gratter les aiguillons des gros exemplaires, parfois amers."
  },
  chanterelletube: {
    wiki: "Craterellus tubaeformis",
    size: "Chapeau 2 à 5 cm",
    ident: "Petit chapeau brun en entonnoir, souvent percé au centre. Dessous avec des plis gris. Pied creux, jaune vif.",
    milieu: "En grandes colonies dans la mousse humide, sous pins et feuillus, en fin de saison.",
    cuisine: "Sautée, en fricassée ou en sauce. Se sèche bien."
  },
  lactaire: {
    wiki: "Lactarius deliciosus",
    size: "Chapeau 5 à 12 cm",
    ident: "Chapeau orangé à cercles plus foncés, verdissant avec l'âge. À la cassure, il coule un lait ORANGE CAROTTE. Les blessures verdissent.",
    milieu: "Uniquement sous les pins. En Vendée : forêts des Pays-de-Monts, d'Olonne, de Longeville et de La Tranche, Bois de la Chaize. En Charente-Maritime : la Coubre, Saint-Trojan et les Saumonards (Oléron), Suzac.",
    cuisine: "Grillé ou poêlé. La couleur orange des urines après consommation est normale."
  },
  coulemelle: {
    wiki: "Macrolepiota procera",
    size: "Chapeau 10 à 30 cm, pied jusqu'à 40 cm",
    ident: "Grand chapeau en ombrelle couvert d'écailles brunes, avec un mamelon central. Lames blanches libres. Pied chiné de brun avec un anneau double qui coulisse.",
    milieu: "Lisières, clairières, bords de chemins et prairies. Partout dans le bocage et les forêts des deux départements.",
    cuisine: "Chapeau seulement, pané ou grillé. Ne jamais cueillir de petits exemplaires."
  },
  rose: {
    wiki: "Agaricus campestris",
    size: "Chapeau 4 à 10 cm",
    ident: "Chapeau blanc soyeux. Lames ROSE vif puis brun chocolat, jamais blanches. Pied court avec un anneau fragile, SANS volve à la base. Odeur agréable.",
    milieu: "Prairies pâturées (chevaux, vaches), jamais en forêt. Prairies des marais poitevin et breton, bocage vendéen ; en Charente-Maritime, marais de Brouage et vallées de la Charente et de la Boutonne.",
    cuisine: "Cru en salade quand il est jeune, ou poêlé."
  },
  piedbleu: {
    wiki: "Lepista nuda",
    size: "Chapeau 6 à 15 cm",
    ident: "Chapeau lisse lilas à brun-violet. Lames serrées violettes. Pied violet et fibreux, sans anneau ni voile. Odeur fruitée. Sporée rose pâle.",
    milieu: "Litières épaisses de feuilles ou d'aiguilles, haies, tas de compost, souvent en ronds. Tard en saison.",
    cuisine: "Toujours bien cuit, jamais cru. Bon en fricassée ou en omelette."
  },
  pleurote: {
    wiki: "Pleurotus ostreatus",
    size: "Chapeau 5 à 15 cm",
    ident: "En étages sur le bois. Chapeau gris ardoise à brun, en forme de coquille d'huître. Lames blanches qui descendent sur un pied très court ou absent.",
    milieu: "Troncs et souches de feuillus (peupliers, hêtres), surtout dans les vallées humides, de l'automne au printemps.",
    cuisine: "Poêlé ou en tempura. Choisir des exemplaires jeunes et tendres."
  },
  morille: {
    wiki: "Morchella",
    size: "Hauteur 5 à 15 cm",
    ident: "Chapeau en nid d'abeilles avec des alvéoles. Coupée en deux, elle est ENTIÈREMENT CREUSE d'un seul tenant, du chapeau au pied.",
    milieu: "Au printemps, sous frênes et ormes, au bord des haies, des rivières et dans les zones remuées.",
    cuisine: "TOUJOURS bien cuite, jamais crue (toxique crue). À la crème."
  },
  mousseron: {
    wiki: "Calocybe gambosa",
    size: "Chapeau 5 à 12 cm",
    ident: "Charnu, blanc crème. Lames blanches très serrées. Forte odeur de farine fraîche. Pousse en ronds dans l'herbe vers le 23 avril.",
    milieu: "Prairies, bords de haies et lisières, au printemps.",
    cuisine: "Poêlé ou en omelette. Très parfumé."
  },
  boletorange: {
    wiki: "Leccinum aurantiacum",
    size: "Chapeau 6 à 20 cm",
    ident: "Chapeau orange brique à rouge orangé, velouté, dont la marge dépasse un peu. Dessous à tubes (une éponge) blanchâtres puis gris. Pied haut et ferme, blanc, couvert de petites écailles (méchules) rousses puis noires. Chair blanche qui devient grise, violacée puis noire à la coupe : c'est normal.",
    milieu: "Sous les peupliers et les trembles, plus rarement sous les chênes et les bouleaux, sur sol frais. En Vendée et Charente-Maritime : peupleraies des vallées (Lay, Vendée, Charente, Boutonne), lisières du Marais poitevin.",
    cuisine: "Toujours bien cuit (au moins 15 minutes) : cru ou peu cuit, il provoque des troubles digestifs. La chair noircit à la cuisson, c'est sans danger. Bon en poêlée ou séché."
  },
  cesar: {
    wiki: "Amanita caesarea",
    size: "Chapeau 8 à 20 cm",
    ident: "Chapeau orange vif à rouge orangé, lisse, sans flocons blancs (ou un seul grand lambeau blanc). Lames JAUNE D'OR. Pied JAUNE avec un anneau jaune. Grande volve blanche en sac à la base. Jeune, il sort d'un « œuf » blanc.",
    milieu: "Chênaies et châtaigneraies claires et chaudes, sols sableux ou acides, lisières bien exposées. Espèce plutôt méridionale : rare en Vendée et en Charente-Maritime, surtout après les étés chauds et orageux (Double saintongeaise, Mervent-Vouvant, Benon).",
    cuisine: "Réputée la meilleure des amanites, crue en fines lamelles ou juste poêlée. Seulement si l'identification est CERTAINE : faites-la vérifier par un pharmacien.",
    expertNote: "Réservée aux cueilleurs expérimentés. Les trois critères doivent être réunis : lames jaunes, pied jaune, volve blanche en sac. Un seul critère blanc (lames ou pied) : ne pas cueillir."
  }
};

if (typeof module !== "undefined") module.exports = { SPECIES, ZONES, FICHES };
