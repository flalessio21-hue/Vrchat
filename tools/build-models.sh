#!/usr/bin/env bash
# Rigenera i modelli 3D con Blender (modulo Python `bpy`) e li comprime.
#   Requisiti: Python 3.13 con `pip install bpy` (Blender 5.x come libreria)
#   Uso: BLENDER_PY=/percorso/python tools/build-models.sh [--fast]
set -euo pipefail
cd "$(dirname "$0")/.."
PY="${BLENDER_PY:-python3}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "→ Avatar (Blender)"
"$PY" tools/blender/avatar.py -- "$TMP/avatar.glb" | grep -E "TOTALE|ESPORTATO|Error" || true
echo "→ Oggetti dei negozi (Blender)"
"$PY" tools/blender/items.py -- "$TMP/items.glb" | grep -E "ESPORTATO|Error" || true
echo "→ Hub (Blender + occlusione ambientale con Cycles)"
"$PY" tools/blender/hub.py -- "$TMP" "$@" | grep -E "TRIANGOLI|ESPORTATO|Error" || true

mkdir -p public/models
cp "$TMP/hub.json" public/models/hub.json
for f in avatar hub items; do
  echo "→ Compressione $f.glb (meshopt)"
  npx gltf-transform optimize "$TMP/$f.glb" "public/models/$f.glb" \
    --compress meshopt --texture-compress false --simplify false --join false --instance false --flatten false --palette false
done
ls -lh public/models
