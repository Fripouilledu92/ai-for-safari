#!/bin/bash
# Installe « AI for Safari » sur ce Mac, depuis le dossier où se trouve ce script (une archive dépliée).
#
#   bash distribution/installer.sh
#
# Ce qu'il fait, dans l'ordre :
#   1. vérifie macOS 14+, la commande `claude` (Claude Code) et le compilateur d'Apple (swiftc) ;
#   2. copie les fichiers dans ~/Library/Application Support/AI for Safari ;
#   3. compile sur place le pont et l'app du panneau (rien de précompilé à croire sur parole) ;
#   4. branche le connecteur Safari dans Claude Code ;
#   5. ouvre l'app du panneau et l'app qui porte l'extension Safari.
# Il ne demande aucun mot de passe, n'utilise pas sudo, n'envoie rien sur Internet et ne touche à aucun réglage
# de Safari ni de macOS : ces réglages-là restent à faire à la main (il les liste à la fin).
#
# Essais : CS_PREFIXE=/tmp/x change le dossier d'installation ; CS_SANS_BRANCHER=1 ne branche rien et n'ouvre rien.
set -euo pipefail

ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE="$(cd "$ICI/.." && pwd)"
CIBLE="${CS_PREFIXE:-$HOME/Library/Application Support/AI for Safari}"
dire() { printf '%s\n' "$*"; }
arret() { printf 'Installation arretee : %s\n' "$*" >&2; exit 1; }

# 1. Ce qu'il faut sur le Mac
[ "$(uname -s)" = "Darwin" ] || arret "ce programme ne marche que sur un Mac."
MAJEUR="$(sw_vers -productVersion | cut -d. -f1)"
[ "$MAJEUR" -ge 14 ] || arret "il faut macOS 14 ou plus recent (ici : $(sw_vers -productVersion))."
command -v swiftc >/dev/null 2>&1 || arret "il manque le compilateur d'Apple. Lance : xcode-select --install   puis relance ce script."
CLAUDE="$(command -v claude || true)"
[ -n "$CLAUDE" ] || [ ! -x "$HOME/.local/bin/claude" ] || CLAUDE="$HOME/.local/bin/claude"
[ -n "$CLAUDE" ] || arret "il manque Claude Code (la commande claude). Installe-le depuis https://claude.com/product/claude-code puis relance ce script."
for f in serveur/serveur.py serveur/sites.py serveur/page.js panneau/discussion.py panneau/panneau.html pont/pont-safari.swift pont/construire.sh app/panneau.swift app/construire-app.sh; do
  [ -f "$SOURCE/$f" ] || arret "fichier manquant dans l'archive : $f"
done
# L'archive annonce ses empreintes : on les verifie avant de rien copier.
if [ -f "$SOURCE/EMPREINTES.sha256" ]; then
  (cd "$SOURCE" && shasum -a 256 -c EMPREINTES.sha256 --quiet) || arret "un fichier de l'archive ne correspond pas a son empreinte. Ne l'installe pas."
  dire "Empreintes de l'archive : conformes."
fi

# 2. Copie
mkdir -p "$CIBLE"
chmod 700 "$CIBLE"
for d in serveur panneau pont app docs; do
  [ -d "$SOURCE/$d" ] || continue
  mkdir -p "$CIBLE/$d"
  rsync -a --delete --exclude 'bin' --exclude '*.app' --exclude '__pycache__' "$SOURCE/$d/" "$CIBLE/$d/"
done
if [ -d "$SOURCE/extension/AI for Safari.app" ]; then
  mkdir -p "$CIBLE/extension"
  rsync -a --delete "$SOURCE/extension/AI for Safari.app" "$CIBLE/extension/"
fi
dire "Fichiers copies dans : $CIBLE"

# 3. Compilation sur place
bash "$CIBLE/pont/construire.sh" >/dev/null 2>&1 || arret "le pont Safari n'a pas compile (bash \"$CIBLE/pont/construire.sh\" pour voir l'erreur)."
bash "$CIBLE/app/construire-app.sh" >/dev/null 2>&1 || arret "l'app du panneau n'a pas compile (bash \"$CIBLE/app/construire-app.sh\" pour voir l'erreur)."
dire "Pont et app du panneau compiles sur ce Mac."

# L'extension, elle, doit etre signee par son editeur et verifiee par Apple, sinon Safari ne la charge pas.
EXT="$CIBLE/extension/AI for Safari.app"
EXT_OK=non
if [ -d "$EXT" ] && spctl -a -t exec "$EXT" >/dev/null 2>&1; then EXT_OK=oui; fi

if [ "${CS_SANS_BRANCHER:-}" = "1" ]; then
  dire "Essai : rien n'est branche ni ouvert. Extension verifiee par Apple : $EXT_OK"
  exit 0
fi

# 4. Connecteur dans Claude Code
"$CLAUDE" mcp remove --scope user claude-safari >/dev/null 2>&1 || true
"$CLAUDE" mcp add --scope user claude-safari -- /usr/bin/python3 "$CIBLE/serveur/serveur.py" >/dev/null
dire "Connecteur « claude-safari » branche dans Claude Code (nouvelles sessions)."

# 5. Ouverture
open "$CIBLE/app/AI for Safari.app"
[ -d "$EXT" ] && open "$EXT"

dire ""
dire "Installe. Dans Safari, une seule fois :"
dire "  1. Reglages > Extensions : cocher l'extension, puis « Toujours autoriser sur tous les sites web »."
dire "  2. Cliquer le bouton de l'extension dans la barre d'outils : le panneau s'ouvre, c'est pret."
dire ""
dire "Plus tard, macOS ne demandera un droit qu'au moment ou tu t'en sers pour la premiere fois :"
dire "  le micro quand tu dictes, le son quand Claude ecoute une video, Safari quand Claude agit dans une page."
dire "  Pour que Claude agisse dans les pages, il faut aussi : Reglages > Avance > « Afficher les fonctionnalites"
dire "  pour les developpeurs », puis Developpement > Reglages pour les developpeurs > « Autoriser JavaScript"
dire "  depuis les evenements Apple »."
if [ "$EXT_OK" != "oui" ]; then
  dire ""
  dire "Attention : l'extension de cette archive n'est pas verifiee par Apple. Safari ne la chargera que si tu coches"
  dire "Developpement > « Autoriser les extensions non signees », a refaire a chaque lancement de Safari."
fi
