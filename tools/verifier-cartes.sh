#!/usr/bin/env bash
# Vérifie les fonds de carte IGN (Géoplateforme) utilisés par l'appli.
set -u
CAP=$(curl -sS "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetCapabilities&VERSION=1.0.0")
echo "Couches disponibles (extrait) :"
echo "$CAP" | grep -o '<ows:Identifier>[^<]*</ows:Identifier>' | sed 's/<[^>]*>//g' \
  | grep -E 'PLANIGN|ORTHOPHOTOS$|FOREST|SCAN|CADASTRAL|ELEVATION.SLOPES|HYDRO' | sort -u
echo
# styles et formats de la carte forestière
echo "$CAP" | awk '/<Layer>/{l=""} {l=l $0 "\n"} /<\/Layer>/{ if (l ~ /FORESTINVENTORY/) print l }' \
  | grep -E 'Identifier|Format|TileMatrixSet>|<Style' | sed 's/^ *//' | head -30
echo
# tuile test au-dessus de Mervent (zoom 15)
Z=15; X=$(python3 -c "print(int((-0.77+180)/360*2**$Z))"); Y=$(python3 -c "import math;l=math.radians(46.52);print(int((1-math.log(math.tan(l)+1/math.cos(l))/math.pi)/2*2**$Z))")
for spec in "GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2|normal|image/png" "ORTHOIMAGERY.ORTHOPHOTOS|normal|image/jpeg" \
            "LANDCOVER.FORESTINVENTORY.V2|normal|image/png" "LANDCOVER.FORESTINVENTORY.V2|LANDCOVER.FORESTINVENTORY.V2|image/png" \
            "GEOGRAPHICALGRIDSYSTEMS.MAPS.SCAN25TOUR|normal|image/jpeg"; do
  IFS='|' read -r L S F <<< "$spec"
  U="https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=$L&STYLE=$S&TILEMATRIXSET=PM&TILEMATRIX=$Z&TILEROW=$Y&TILECOL=$X&FORMAT=$F"
  R=$(curl -sS -o /tmp/t -w "%{http_code} %{content_type} %{size_download}" "$U")
  echo "$L [$S] → $R"
done
