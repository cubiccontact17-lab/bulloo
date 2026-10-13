#!/usr/bin/env bash
# Vérifie que les fonds de carte IGN (Géoplateforme) utilisés par l'appli répondent.
set -u
Z=15; X=$(python3 -c "print(int((-0.77+180)/360*2**$Z))"); Y=$(python3 -c "import math;l=math.radians(46.52);print(int((1-math.log(math.tan(l)+1/math.cos(l))/math.pi)/2*2**$Z))")
fail=0
for spec in "GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2|normal|image/png" \
            "ORTHOIMAGERY.ORTHOPHOTOS|normal|image/jpeg" \
            "LANDCOVER.FORESTINVENTORY.V2|normal|image/png" \
            "CADASTRALPARCELS.PARCELLAIRE_EXPRESS|PCI vecteur|image/png" \
            "CADASTRALPARCELS.PARCELLAIRE_EXPRESS|normal|image/png"; do
  IFS='|' read -r L S F <<< "$spec"
  U="https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=$L&STYLE=${S// /%20}&TILEMATRIXSET=PM&TILEMATRIX=$Z&TILEROW=$Y&TILECOL=$X&FORMAT=$F"
  R=$(curl -sS -o /tmp/t -w "%{http_code} %{content_type} %{size_download}" "$U")
  echo "$L [$S] → $R"
  [[ "$R" == 200\ image* ]] || fail=1
done
# styles du cadastre annoncés par le service
curl -sS "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetCapabilities&VERSION=1.0.0" | tr '\n' ' ' \
  | grep -o '<Layer>[^§]*' | sed 's#</Layer>#</Layer>\n#g' | grep 'CADASTRALPARCELS.PARCELLAIRE_EXPRESS<' \
  | grep -o '<Style[^>]*>.\{0,300\}' | grep -o '<ows:Identifier>[^<]*' | head -5
exit 0
