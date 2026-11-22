#!/bin/bash
# Fabrique "AI for Safari.app" (un seul fichier Swift, paquet assemble a la main, signature ad hoc).
# Marche depuis n'importe quel dossier.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RACINE="$(cd "$DIR/.." && pwd)"
APP="$DIR/AI for Safari.app"

# Disque : on s arrete sous 1 Go libre (l app compilee pese moins de 1 Mo, la compilation environ 200 Mo).
LIBRE_KO=$(df -k / | awk 'NR==2 {print $4}')
if [ "$LIBRE_KO" -lt 1048576 ]; then
  echo "Disque trop plein : $((LIBRE_KO / 1024)) Mo libres (moins de 1 Go). Compilation annulee." >&2
  exit 1
fi

rm -rf "${APP:?}"
mkdir -p "$APP/Contents/MacOS"

swiftc -O -swift-version 5 "$DIR/panneau.swift" -o "$APP/Contents/MacOS/ClaudeSafari" \
  -framework Cocoa -framework WebKit

PL="$APP/Contents/Info.plist"
PB=/usr/libexec/PlistBuddy
"$PB" -c "Add :CFBundleIdentifier string fr.antoinetollu.ai-for-safari.panneau" "$PL"
"$PB" -c "Add :CFBundleName string AI for Safari" "$PL"
"$PB" -c "Add :CFBundleDisplayName string AI for Safari" "$PL"
"$PB" -c "Add :CFBundleExecutable string ClaudeSafari" "$PL"
"$PB" -c "Add :CFBundlePackageType string APPL" "$PL"
"$PB" -c "Add :CFBundleInfoDictionaryVersion string 6.0" "$PL"
"$PB" -c "Add :CFBundleShortVersionString string 1.0" "$PL"
"$PB" -c "Add :CFBundleVersion string 1" "$PL"
"$PB" -c "Add :LSMinimumSystemVersion string 14.0" "$PL"
"$PB" -c "Add :LSUIElement bool true" "$PL"
"$PB" -c "Add :NSHighResolutionCapable bool true" "$PL"
"$PB" -c "Add :NSPrincipalClass string NSApplication" "$PL"
"$PB" -c "Add :NSAppleEventsUsageDescription string Accepter : Claude pourra ouvrir des onglets, cliquer et écrire dans Safari quand tu le lui demandes. Rien ne quitte ton Mac par cet accord, et tu peux le retirer dans les Réglages." "$PL"
"$PB" -c "Add :NSSpeechRecognitionUsageDescription string Accepter : ce que tu dis au micro et le son des pages sont changes en texte pour Claude." "$PL"
"$PB" -c "Add :NSAudioCaptureUsageDescription string Accepter : Claude entend le son des pages Safari (videos, audios) pour t en parler." "$PL"
"$PB" -c "Add :NSMicrophoneUsageDescription string Accepter : Claude entend ton micro, seulement pendant que tu dictes un message." "$PL"
"$PB" -c "Add :CSRacine string $RACINE" "$PL"
plutil -lint "$PL" >/dev/null

# Signée avec le certificat de développeur de la personne quand il existe : macOS garde alors ses autorisations
# (Automatisation, Enregistrement de l'écran, Reconnaissance vocale) d'une recompilation à l'autre.
# Avec une signature « ad hoc », chaque recompilation les remet à zéro.
if [ "${CS_SIGNATURE_DEV:-}" = "1" ] && security find-identity -v -p codesigning 2>/dev/null | grep -q "Apple Development"; then
  codesign -s "Apple Development" --force --deep "$APP"
else
  codesign -s - --force --deep "$APP"
fi

# Menage : aucun fichier intermediaire ne doit rester.
rm -rf "${DIR:?}/.build"
find "$DIR" -maxdepth 1 \( -name '*.o' -o -name '*.dSYM' \) -exec rm -rf {} +
find "$APP/Contents/MacOS" -maxdepth 1 -name '*.dSYM' -exec rm -rf {} +

echo "OK : $APP ($(du -sh "$APP" | awk '{print $1}'))"
