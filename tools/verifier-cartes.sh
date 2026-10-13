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
# Interrogation de la carte forestière en un point (GetFeatureInfo)
for P in "46.523 -0.766" "46.840 -2.135" "45.715 -1.195" "46.200 -0.820"; do
  read -r LAT LON <<< "$P"
  read -r X Y I J <<< "$(python3 -c "
import math;z=16;n=2**z;lat=math.radians($LAT)
fx=($LON+180)/360*n;fy=(1-math.log(math.tan(lat)+1/math.cos(lat))/math.pi)/2*n
print(int(fx),int(fy),int((fx%1)*256),int((fy%1)*256))")"
  U="https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetFeatureInfo&VERSION=1.0.0&LAYER=LANDCOVER.FORESTINVENTORY.V2&STYLE=normal&FORMAT=image/png&INFOFORMAT=application/json&TILEMATRIXSET=PM&TILEMATRIX=16&TILEROW=$Y&TILECOL=$X&I=$I&J=$J"
  echo "Point $LAT,$LON :"
  curl -sS -D /tmp/h "$U" | head -c 1200; echo
  grep -i 'access-control-allow-origin' /tmp/h || echo "(pas d'en-tête CORS)"
done
# Contours des bois (WFS) : nom de la couche, réponse GeoJSON, CORS, taille
echo "Couches WFS forêt :"
curl -sS "https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetCapabilities" | grep -o '<Name>[^<]*FOREST[^<]*</Name>' | sort -u | head
for BB in "46.50,-0.80,46.56,-0.72" "45.68,-1.25,45.74,-1.15"; do
  U="https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=LANDCOVER.FORESTINVENTORY.V2:formation_vegetale&SRSNAME=EPSG:4326&BBOX=$BB,EPSG:4326&COUNT=500&OUTPUTFORMAT=application/json&PROPERTYNAME=code_tfv,tfv,essence,geom"
  echo "BBOX $BB :"
  curl -sS -D /tmp/h -o /tmp/f.json -w "%{http_code} %{size_download} octets %{time_total}s\n" "$U"
  grep -i 'access-control-allow-origin' /tmp/h || echo "(pas d'en-tête CORS)"
  python3 - <<'PY'
import json, collections
try:
    d = json.load(open("/tmp/f.json"))
    f = d.get("features", [])
    print(len(f), "bois ; exemple coordonnées :", json.dumps(f[0]["geometry"]["coordinates"])[:80] if f else "-")
    c = collections.Counter((x["properties"].get("tfv"), x["properties"].get("essence")) for x in f)
    for k, v in c.most_common(12): print(f"  {v:4d}  {k[0]}  |  {k[1]}")
except Exception as e:
    print("lecture impossible :", e, open("/tmp/f.json").read()[:300])
PY
done
exit 0
