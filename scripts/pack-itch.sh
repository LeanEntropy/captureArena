#!/usr/bin/env bash
#
# Build a clean ZIP of the prototype/ folder for itch.io upload.
# The prototype is fully static (Three.js via importmap from CDN), so no
# build step is needed — we just exclude dev artifacts (debug PNGs, JSON
# dumps, screenshots).
#
# Usage:  bash scripts/pack-itch.sh
# Output: dist-itch/landcapture-itch.zip
#
# When loaded under itch.io's *.itch.zone iframe, the client auto-detects
# and routes multiplayer + telemetry to the canonical Railway URL
# (see prototype/multiplayer.js and prototype/telemetry.js).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO_ROOT/prototype"
OUT_DIR="$REPO_ROOT/dist-itch"
OUT_ZIP="$OUT_DIR/landcapture-itch.zip"

mkdir -p "$OUT_DIR"
rm -f "$OUT_ZIP"

# Use Python's zipfile (stdlib) so we don't depend on the `zip` binary.
python3 - "$SRC" "$OUT_ZIP" <<'PY'
import os, sys, zipfile, fnmatch

src, out = sys.argv[1], sys.argv[2]
EXCLUDE_GLOBS = ["*.png", "*debug*", "test_*", "*screenshot*", "*.json", "*test*.js"]

def excluded(rel):
    base = os.path.basename(rel)
    return any(fnmatch.fnmatch(base, g) or fnmatch.fnmatch(rel, g) for g in EXCLUDE_GLOBS)

count = 0
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
    for root, _dirs, files in os.walk(src):
        for f in files:
            full = os.path.join(root, f)
            rel = os.path.relpath(full, src)
            if excluded(rel):
                continue
            zf.write(full, rel)
            count += 1
print(f"packed {count} files")
PY

SIZE="$(du -h "$OUT_ZIP" | cut -f1)"
echo
echo "Wrote $OUT_ZIP ($SIZE)"
echo "Upload this ZIP at https://itch.io/game/new (HTML5 game)."
