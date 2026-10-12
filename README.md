# Champi 85-17 🍄

Application pour téléphone (web app installable) qui indique les **coins à champignons comestibles en Vendée (85) et en Charente-Maritime (17)**, avec une **probabilité de pousse calculée à partir de la météo**.

## Fonctionnalités

- Carte limitée à la Vendée et à la Charente-Maritime (contours des départements, reste grisé).
- 38 secteurs. **Vendée** (24) : forêts de Mervent-Vouvant, Aizenay, La Chaize, Grasla, Pays-de-Monts, Olonne, Longeville, Jard, La Tranche, Noirmoutier, Haut-Bocage, vallées, bocages et prairies des marais. **Charente-Maritime** (14) : forêts de la Coubre, Saint-Trojan et Saumonards (Oléron), Île de Ré, Suzac, Benon, Aulnay, Double saintongeaise (Montendre, Montguyon), Haute-Saintonge, vallées de la Charente et de la Boutonne, marais de Brouage et de Marans.
- 12 champignons **comestibles uniquement**, chacun avec **sa couleur** :

| Couleur | Champignon | Milieu |
|---|---|---|
| 🟤 `#7a4a1f` | Cèpe de Bordeaux | chênes, châtaigniers, hêtres, pins |
| 🟡 `#ffb000` | Girolle | chênes, châtaigniers |
| ⚫ `#222222` | Trompette des morts | hêtres, chênes |
| 🟫 `#f5deb3` | Pied de mouton | feuillus, pins |
| 🟢 `#2a9d8f` | Chanterelle en tube | pins, feuillus |
| 🟠 `#e8590c` | Lactaire délicieux | pins maritimes |
| 🟩 `#6a994e` | Coulemelle | lisières, prairies |
| 🩷 `#e75480` | Rosé des prés | prairies pâturées |
| 🟣 `#7b4fc9` | Pied bleu | litières, haies |
| 🔵 `#4f86c6` | Pleurote en huître | bois mort |
| 🔴 `#c1121f` | Morille | haies, lisières (printemps) |
| ⚪ `#8d99ae` | Mousseron de la Saint-Georges | prairies, haies (printemps) |

- Sélecteur de jour : aujourd'hui + 7 jours de prévision.
- Fiche de chaque secteur : météo (pluie 15 j, température, humidité, gel), score par espèce, conseils, **confusions dangereuses**, bouton itinéraire.
- Classement des meilleurs coins, géolocalisation et distances.
- Fonctionne hors connexion avec la dernière météo connue.

## Mes coins, sorties, alertes (`js/user.js`)

- **Mes coins** : appui long sur la carte (ou bouton ★) pour enregistrer un coin avec les champignons qu'on y trouve. Le coin utilise la météo du secteur le plus proche et affiche ses chances de pousse chaque jour.
- **Noter une sortie** (📝) : pour chaque champignon cherché, « Trouvé » ou « Rien ». L'appli compare avec ce qu'elle avait prévu ce jour-là.
- **Apprentissage** : petite régression logistique, avec un biais par espèce (partout) et un biais par espèce dans chaque lieu. Les biais décalent la probabilité en échelle logit. Une pénalité les garde modestes tant qu'il y a peu de sorties.
- **Alertes** (🔔) : seuil Bon (60 %) ou Excellent (80 %), sur mes coins et/ou tous les secteurs, espèces au choix, pour aujourd'hui et les 3 jours suivants. Sur Android, avec l'appli installée, le service worker vérifie en arrière-plan (Periodic Background Sync, environ toutes les 6 h). Ailleurs, la vérification a lieu à chaque ouverture. Une même alerte n'est notifiée qu'une fois.
- **Sauvegarde** : export / import JSON. Les données restent sur le téléphone (localStorage, avec une copie dans le Cache API pour le service worker).

## L'algorithme (`js/algo.js`)

La météo journalière (21 jours passés + 7 jours de prévision) vient en priorité des modèles de **Météo-France** : AROME, maille d'environ 1,3 km, puis ARPEGE jusqu'à environ 4 jours. Au-delà, ou si une valeur manque, elle est complétée jour par jour par le meilleur modèle disponible. Les données passent par [Open-Meteo](https://open-meteo.com) (`models=meteofrance_seamless,best_match`, gratuit, sans clé). La météo est demandée pour chaque secteur et **au point exact de chaque coin personnel**, en une seule requête.

| Facteur | Calcul |
|---|---|
| Pluie | cumul de J-14 à J-3 (+30 % de J-2 à J) ÷ besoin de l'espèce (20 à 40 mm) |
| Température | moyenne 7 jours comparée à la plage idéale de l'espèce (trapèze min / optimum / max) |
| Humidité | humidité relative moyenne 7 jours : 55 % → 0, 85 % → 1 |
| Gel | −25 % par jour de gel sur 5 jours (−10 % pour les espèces tardives) |
| Sécheresse | −30 % si aucune pluie et air sec sur 5 jours |
| Saison | poids mensuel propre à chaque espèce |
| Milieu | l'espèce n'est proposée que si son habitat existe dans le secteur |

`score = saison × gel × sécheresse × (0,45·pluie + 0,35·temp + 0,2·humidité) × (0,4 + 0,6·min(pluie, temp))`

Le dernier terme fait chuter la note si la pluie **ou** la température est franchement défavorable.

## Installer sur le téléphone

1. Activer GitHub Pages : *Settings → Pages → Source : GitHub Actions*. Le workflow `.github/workflows/pages.yml` publie le site à chaque push.
2. Ouvrir l'adresse du site sur le téléphone.
3. **Android (Chrome)** : menu ⋮ → *Installer l'application*. **iPhone (Safari)** : bouton Partager → *Sur l'écran d'accueil*.

En local : `python3 -m http.server` puis ouvrir `http://localhost:8000`.

Tests : `node --test tests/*.test.js`

## ⚠ Sécurité

Ne mangez jamais un champignon sans identification certaine : faites vérifier votre cueillette par un pharmacien ou une association mycologique. Les secteurs sont des **milieux favorables**, pas des coins garantis ; la probabilité est indicative. Respectez les propriétés privées et la réglementation locale.

Fond de carte © OpenStreetMap, contours des départements : france-geojson, météo : Open-Meteo, carte : Leaflet.
