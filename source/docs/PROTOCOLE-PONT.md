# Protocole du pont (`pont/bin/pont-safari`)

Le pont est un petit programme Swift qui reste ouvert. Le serveur Python lui écrit une ligne JSON par demande
sur son entrée standard ; il répond par une ligne JSON sur sa sortie standard. Une seule demande à la fois.

Deux modes, même protocole :

- `pont-safari safari` : parle au vrai Safari par Apple Events (AppleScript compilé une fois, en mémoire).
- `pont-safari banc [--capteur chemin.js]` : remplace Safari par des `WKWebView` hors écran (le vrai moteur
  WebKit). Sert aux tests automatiques : aucun réglage de Safari n'est nécessaire, Safari n'est pas touché.
  `--capteur` : script injecté au tout début de chaque document (comme le fera l'extension Safari).

## Forme des messages

Demande : `{"id": 7, "op": "js", ...}`
Réponse : `{"id": 7, "ok": true, ...}` ou `{"id": 7, "ok": false, "code": "JS_ERREUR", "erreur": "texte lisible"}`

Tout est en UTF-8, une ligne par message, sortie vidée après chaque réponse. Rien d'autre sur la sortie
standard (les journaux vont sur la sortie d'erreur).

Codes d'erreur : `FENETRE_INTROUVABLE`, `ONGLET_INTROUVABLE`, `JS_APPLE_EVENTS_DESACTIVE` (Safari : réglage
« Autoriser JavaScript depuis les événements Apple » coupé), `AUTOMATISATION_REFUSEE` (erreur -1743),
`CAPTURE_REFUSEE` (pas de droit Enregistrement de l'écran), `AUDIO_REFUSE` (droit « Enregistrement des sons du système uniquement » absent : robinet audio refusé), `DICTEE_REFUSEE` (reconnaissance vocale non autorisée : Réglages Système > Confidentialité et sécurité > Reconnaissance vocale), `DICTEE_INDISPONIBLE` (langue ou moteur non disponible), `SAFARI_ABSENT` (Safari ne tourne pas), `JS_ERREUR`, `DELAI`, `ARGUMENT`, `INTERNE`.

## Opérations

| op | champs de la demande | champs de la réponse |
|---|---|---|
| `ping` | | `mode` (`"safari"` ou `"banc"`), `version` |
| `droits` | | `capture_ecran` (bool), `accessibilite` (bool). Ne déclenche AUCUNE fenêtre de demande (`CGPreflightScreenCaptureAccess`, `AXIsProcessTrusted`). Banc : tout `true`. |
| `fenetre_creer` | `url` | `fenetre` (entier). Safari : nouvelle fenêtre avec un onglet sur `url`, SANS mettre Safari au premier plan (pas de `activate`). |
| `onglets` | `fenetre`, `leger` (facultatif : seulement les adresses, plus rapide ; `titre` vide et `courant` à 0) | `onglets` : liste de `{"index": 1, "url": "...", "titre": "..."}` (index à partir de 1, ordre de la barre d'onglets), `courant` (index de l'onglet affiché) |
| `onglet_creer` | `fenetre`, `url` | `index` du nouvel onglet (ajouté à la fin, devient l'onglet affiché de cette fenêtre) |
| `onglet_fermer` | `fenetre`, `index` | (fermer le dernier onglet ferme la fenêtre) |
| `onglet_url` | `fenetre`, `index`, `url` | (lance la navigation, n'attend pas la fin) |
| `onglet_courant` | `fenetre`, `index` | (affiche cet onglet dans sa fenêtre, sans mettre Safari au premier plan) |
| `js` | `fenetre`, `index`, `code`, `delai_s` (défaut 30) | `resultat` : la valeur du script si c'est une chaîne, sinon sa conversion en texte (`null` si rien). Exécution synchrone dans la page, monde principal, cadre principal. |
| `devant` | | `fenetre` (id de la fenêtre Safari de devant), `index` (onglet affiché), `url`, `titre`, `x`, `y`, `largeur`, `hauteur` (bornes). `FENETRE_INTROUVABLE` si Safari n'a aucune fenêtre. Lecture seule. Banc : la première fenêtre du banc et son onglet courant. |
| `bornes` | `fenetre` | `x`, `y`, `largeur`, `hauteur` (points écran) |
| `bornes_poser` | `fenetre`, `largeur`, `hauteur` | (taille de la fenêtre ; banc : taille de la vue) |
| `calibrer` | `fenetre`, `c1` `[r,v,b]`, `c2` `[r,v,b]` | `x0`, `y0` : coin haut-gauche du pavé de couleur `c1` ; `x1`, `y1` : coin bas-droit du pavé de couleur `c2`, en points depuis le coin haut-gauche de la fenêtre ; `echelle` (pixels image par point). `trouve` (bool). Tolérance ±14 par canal. Banc : `x0=0,y0=0,x1=largeur,y1=hauteur`, `trouve=true`. |
| `capture` | `fenetre`, `zone` `[x0,y0,x1,y1]` en points depuis le coin haut-gauche de la fenêtre (facultatif : toute la fenêtre), `largeur_sortie` en pixels (facultatif : pas de mise à l'échelle au-delà de la résolution native), `format` `"jpeg"` ou `"png"`, `qualite` (0 à 1, défaut 0.8), `fichier` (facultatif : écrit aussi l'image là) | `base64`, `largeur`, `hauteur` (pixels de l'image rendue), `ms` (durée de la capture) |
| `gif` | `images` : liste de `{"fichier": "...", "duree_ms": 800, "annotations": [...]}`, `sortie`, `options` `{"barre": bool, "filigrane": "texte" ou null, "largeur": px}` | `fichier`, `octets`, `images` |
| `dialogue` | `titre`, `message`, `boutons` (liste, le premier est celui par défaut), `delai_s` | `bouton` (texte du bouton cliqué) ou `null` si personne n'a répondu. Banc : répond la variable d'environnement `PONT_BANC_DIALOGUE` si elle existe, sinon `null`, sans rien afficher. |
| `ecouter` | `duree_s` (1 à 120, défaut 15), `langue` (défaut `fr-FR`), `fichier` (facultatif : transcrit ce fichier, sans rien capturer et sans le supprimer ; obligatoire en banc, sinon `ARGUMENT`) | `texte` (vide si aucune parole), `secondes` (durée du son), `niveau_db` (RMS moyen en dBFS, arrondi), `silencieux` (bool : niveau sous -55 dBFS, pas de transcription alors), `sur_appareil` (bool), `langue`. Sans `fichier` (mode safari) : enregistre `duree_s` secondes le son des processus de Safari (identifiant de paquet `com.apple.Safari*` ou `com.apple.WebKit*`) par un robinet audio Core Audio (macOS 14.4+, `CATapDescription` + appareil agrégé privé, non muet) : pas de capture d'écran, donc pas d'indicateur de partage d'écran (macOS garde son petit indicateur d'enregistrement audio). Le droit demandé est « Enregistrement des sons du système uniquement » (`NSAudioCaptureUsageDescription`) ; refus = code `AUDIO_REFUSE`. Aucun processus audio de Safari, ou aucun échantillon : `silencieux: true`, texte vide (pas une erreur). Le robinet prend le son avant le volume de sortie. L'ancienne capture ScreenCaptureKit ne sert que de secours sous macOS 14.4. Le son est transcrit sur le Mac (reconnaissance vocale d'Apple), supprime le fichier temporaire. Peut afficher la demande macOS « reconnaissance vocale » au premier appel. |
| `quitter` | | (le programme s'arrête ; il s'arrête aussi quand son entrée se ferme) |

Annotations du GIF, en pixels de l'image : `{"type": "clic", "x": 10, "y": 20}` (cercle orange),
`{"type": "glisser", "x0":..,"y0":..,"x1":..,"y1":..}` (flèche rouge), `{"type": "texte", "texte": "..."}` (bandeau
noir en bas).

## Règles

- `capture` en mode Safari : seul l'onglet affiché d'une fenêtre est dessiné. Le serveur appelle
  `onglet_courant` avant si besoin.
- Les couleurs de `calibrer` sont lues dans une capture en sRGB.
- Le pont ne décide rien : pas de liste de sites, pas de règle de sécurité. Tout ça est dans le serveur Python.

## Mode `micros` (une ligne, puis il s'arrête)

`pont-safari micros` écrit une ligne JSON : `{"micros":[{"uid":"...","nom":"...","defaut":true|false}, ...]}`. Seuls les
périphériques ayant des canaux d'entrée y figurent (`kAudioDevicePropertyStreamConfiguration`, scope entrée) ; `defaut` est
vrai pour le périphérique d'entrée par défaut du système (un seul), `nom` vient de `kAudioObjectPropertyName`.

## Mode `dictee` (à part, reste ouvert)

`pont-safari dictee [langue] [--micro UID] [--local]` (langue par défaut `fr-FR`) n'utilise pas le protocole demande/réponse
ci-dessus : il écoute le micro du Mac (AVAudioEngine + `SFSpeechAudioBufferRecognitionRequest`, résultats partiels) et écrit
sur la sortie standard une ligne JSON par événement, vidée tout de suite. Réglages de qualité : moteur d'Apple en ligne par
défaut (`--local` force la reconnaissance sur l'appareil, plus faible), ponctuation automatique, indice « dictée », format
d'entrée natif du micro (aucune conversion), tampons de 1024 images. `--micro UID` règle le périphérique d'entrée sur cet
UID (voir `micros`) avant le démarrage du moteur ; UID inconnu : événement `erreur` `MICRO_INTROUVABLE`.

Apple coupe une requête d'environ une minute : à 55 s, le pont ouvre une nouvelle requête (l'ancienne rend son texte final),
et le texte envoyé est toujours celui des requêtes finies suivi de celui de la requête en cours (`bestTranscription.formattedString`
de chacune, séparés par une espace).

- `{"type":"pret","micro":"nom du périphérique","sur_appareil":false}` : l'écoute a démarré ;
- `{"type":"niveau","v":[a,b,c,d,e]}` : environ 20 fois par seconde, 5 valeurs entre 0 et 1 (niveau RMS des 5 derniers petits
  morceaux de 1024 échantillons, en dB : -60 dB donne 0, -10 dB donne 1) pour dessiner les barres ;
- `{"type":"texte","t":"...","final":false}` : à chaque résultat partiel, le texte complet reconnu jusque-là ; `final:true` au dernier ;
- `{"type":"erreur","code":"MICRO_INTROUVABLE"|"MICRO_REFUSE"|"DICTEE_REFUSEE"|"DICTEE_INDISPONIBLE"|"INTERNE","message":"..."}` puis le programme s'arrête ;
- `{"type":"fin"}` : arrêt propre, code de sortie 0.

Il s'arrête (texte `final:true` puis `fin`) quand son entrée standard reçoit une ligne `stop` ou se ferme, et au bout de 120 s.
Les autorisations Microphone (`NSMicrophoneUsageDescription`) et Reconnaissance vocale sont demandées si elles ne sont pas
encore décidées ; la demande doit venir de l'app « AI for Safari » qui lance le pont. Les modes `safari` et `banc` ne changent pas.
