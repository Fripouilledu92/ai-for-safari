#!/bin/bash
# Compile le pont Safari (un seul fichier Swift, aucune dependance). Marche depuis n'importe quel dossier.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Disque : on s'arrete sous 1 Go libre (la compilation ecrit moins de 100 Mo).
LIBRE_KO=$(df -k / | awk 'NR==2 {print $4}')
if [ "$LIBRE_KO" -lt 1048576 ]; then
  echo "Disque trop plein : $((LIBRE_KO / 1024)) Mo libres (moins de 1 Go). Compilation annulee." >&2
  exit 1
fi

mkdir -p "$DIR/bin"
rm -f "$DIR/bin/pont-safari"

swiftc -O -swift-version 5 "$DIR/pont-safari.swift" -o "$DIR/bin/pont-safari" \
  -framework Cocoa -framework WebKit -framework ScreenCaptureKit -framework ImageIO \
  -framework CoreText -framework UniformTypeIdentifiers -framework Speech -framework AVFoundation -framework CoreAudio \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "$DIR/Info-pont.plist"

codesign -s - --force "$DIR/bin/pont-safari"

# Menage : aucun fichier intermediaire ne doit rester.
rm -rf "$DIR/bin/pont-safari.dSYM" "$DIR/.build" "$DIR"/*.o "$DIR/bin"/*.o

echo "OK : $DIR/bin/pont-safari ($(du -h "$DIR/bin/pont-safari" | awk '{print $1}'))"
