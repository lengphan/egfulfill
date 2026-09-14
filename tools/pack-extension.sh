#!/usr/bin/env bash
#
# BUILD THE ZIP THE CHROME WEB STORE WANTS.
#
#   tools/pack-extension.sh
#   -> dist/egful-extension-0.1.7.zip
#
# manifest.json has to sit at the ROOT of the archive. Zipping the folder itself — the thing
# Finder's "Compress" does — puts it one level down at extension/manifest.json, and the
# upload is rejected with "manifest file is missing or unreadable", which reads like the file
# is broken rather than one directory deep.
#
# Only what runs ships: the manifest, the icons and src/. The README is ours, not the
# reviewer's, and macOS sprinkles .DS_Store into every folder it has ever displayed — an
# unexpected file in the package is a question at review time for no benefit.
set -euo pipefail

cd "$(dirname "$0")/.."
SRC=extension
OUT=dist

command -v zip >/dev/null || { echo "zip is not installed." >&2; exit 1; }

# A broken manifest uploads fine and fails on Google's side, hours later, by email.
node -e "JSON.parse(require('fs').readFileSync('$SRC/manifest.json','utf8'))" \
  || { echo "manifest.json does not parse — fix it before packing." >&2; exit 1; }
VER=$(node -p "require('./$SRC/manifest.json').version")
NAME=$(node -p "require('./$SRC/manifest.json').name")

# Every icon the manifest promises must actually be in the package.
node -e "
const m = require('./$SRC/manifest.json'), fs = require('fs');
const want = new Set([...Object.values(m.icons||{}), ...Object.values((m.action||{}).default_icon||{})]);
const missing = [...want].filter((p) => !fs.existsSync('$SRC/' + p));
if (missing.length) { console.error('missing icon files: ' + missing.join(', ')); process.exit(1); }
"

mkdir -p "$OUT"
ZIP="$OUT/egful-extension-$VER.zip"
rm -f "$ZIP"
( cd "$SRC" && zip -q -r -X "../$ZIP" manifest.json icons src -x '*.DS_Store' )

echo "$NAME $VER"
echo "$ZIP  ($(du -h "$ZIP" | cut -f1))"
echo
unzip -l "$ZIP" | sed -n '4,20p'
echo
echo "Upload at https://chrome.google.com/webstore/devconsole"
echo "The store REFUSES a version it has already seen — bump extension/manifest.json each time."
