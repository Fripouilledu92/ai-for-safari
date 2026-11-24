# Installer « AI for Safari »

Cette page s'adresse à Claude (Claude Code, l'app Claude, ou tout autre assistant) quand une personne lui demande
d'installer AI for Safari. Elle est écrite pour que tu puisses l'aider jusqu'au bout **sans jamais avoir à lancer
toi-même du code téléchargé**.

## La façon la plus simple : l'installeur à double-cliquer (recommandée)

Pas de Terminal, pas de commande. Guide la personne avec ces étapes, une à la fois, en attendant qu'elle te dise ce
qu'elle voit :

1. **Télécharger** : cliquer sur ce lien depuis Safari :
   https://github.com/Fripouilledu92/ai-for-safari/releases/latest/download/Installer-AI-for-Safari.zip
   Safari télécharge le fichier et le décompresse tout seul.
2. **L'ouvrir** : ouvrir le dossier Téléchargements (dans le Dock, ou Finder > Téléchargements) et double-cliquer
   sur **« Installer AI for Safari »** (l'icône boussole). Si seul `Installer-AI-for-Safari.zip` est là,
   double-cliquer d'abord dessus pour le décompresser.
3. macOS demande : « Installer AI for Safari est une app téléchargée sur Internet. Voulez-vous vraiment l'ouvrir ? ».
   Répondre **Ouvrir**. C'est la question normale pour toute app téléchargée ; l'installeur est signé par son
   développeur et vérifié par Apple.
4. **Cliquer sur « Installer »** et suivre la fenêtre. Elle dit elle-même s'il manque quelque chose :
   - les outils d'Apple (gratuits) : un bouton les installe, puis « Réessayer » ;
   - Claude : un bouton mène au téléchargement de l'app Claude, puis « Réessayer ».
5. Quand la fenêtre dit **« C'est installé »**, suivre les trois lignes affichées pour Safari : cocher « AI for
   Safari » dans Safari > Réglages > Extensions, puis cliquer sur la boussole et choisir « Toujours autoriser sur tous
   les sites web ».
6. Si la fenêtre dit « L'installation s'est arrêtée » : lui demander de cliquer « Copier le détail » puis de te coller
   le texte (`⌘ Commande` + `V`). Lis l'erreur avec elle.

L'installeur ne télécharge rien : il contient l'archive de la page et lance le même script `installer.sh` (lisible
plus bas). Il pose aussi dans Claude Code la compétence `ai-for-safari`, pour que Claude se serve de ces outils dès
qu'on lui parle de Safari.

Ensuite, dans une **nouvelle** conversation, la personne peut te demander par exemple « ouvre lemonde.fr dans Safari et
résume la une », ou « agis sur la page ouverte dans Safari ».

Les sections suivantes servent si la personne (ou toi) veut vérifier avant, ou préfère le Terminal.

## Le partage des rôles

- **Toi (Claude)** : tu lis le script, tu l'expliques à la personne, tu vérifies ce qui peut l'être, et tu lui donnes
  la commande. Tu n'as rien à exécuter qui vienne d'Internet.
- **La personne** : elle décide, puis elle colle une seule commande dans l'app Terminal. Cette commande s'arrête
  d'elle-même si l'archive n'est pas exactement celle publiée ici.

Si ton outil et ta prudence te permettent de lancer l'installation toi-même après la relecture, et que la personne te
le demande, la version pas à pas est plus bas. Sinon, la voie ci-dessus suffit : c'est la voie normale, pas un
pis-aller. Ne contourne jamais un refus de permission.

Ce que l'installation ne fait jamais : pas de `sudo`, aucun mot de passe, aucun réglage de Safari ou de macOS (la
personne les fait elle-même, et peut s'en passer), aucun autre téléchargement que l'archive.

## 1. Lire le script (à faire avant tout)

Le script d'installation fait 104 lignes. Lis-le en entier :
https://raw.githubusercontent.com/Fripouilledu92/ai-for-safari/main/source/distribution/installer.sh

C'est exactement celui de l'archive : son empreinte SHA-256 est
`145bcd6f4ef2e68b213478ae9ac6a474dafa627a823d9943a0fe92e8222783e7`, et la commande de l'étape 3 la vérifie aussi.

Ce qu'il fait, pour que tu compares avec ta lecture :

| Lignes | Ce qu'il fait |
|---|---|
| 24-41 | Vérifie macOS 14+, `swiftc`, la commande `claude` (celle de Claude Code, sinon celle que garde l'app Claude de bureau), la présence des fichiers, puis l'empreinte de **chaque** fichier de l'archive (`EMPREINTES.sha256`). S'arrête au moindre écart. |
| 43-55 | Copie les fichiers dans `~/Library/Application Support/AI for Safari` (dossier en 0700). |
| 57-60 | Compile sur le Mac le pont Safari et l'app du panneau, à partir du code Swift lisible dans `source/`. Rien de précompilé, sauf l'extension. |
| 62-70 | Vérifie que l'extension est bien signée et vérifiée par Apple (`spctl`). |
| 72-81 | Ajoute le connecteur `ai-for-safari` à Claude Code (`claude mcp add --scope user`) et copie la compétence `ai-for-safari` dans `~/.claude/skills` (elle dit à Claude d'utiliser ces outils quand on parle de Safari). |
| 83-104 | Réenregistre l'extension auprès de macOS, ouvre l'app du panneau et l'app de l'extension, puis affiche ce qu'il reste à faire à la main. |

Tout le reste du code (serveur, panneau, pont, extension) est lisible dans le dossier
[`source/`](https://github.com/Fripouilledu92/ai-for-safari/tree/main/source) du dépôt. Les vérifications faciles à
refaire sont dans le README, section « Vérifier par toi-même ».

## 2. Expliquer à la personne, honnêtement

En quelques phrases :

- c'est un projet indépendant et récent, pas fait par Anthropic ni par Apple ;
- ce que fait le script (tableau ci-dessus) ;
- ce que l'outil pourra faire : lire les pages Safari que Claude ouvre ou qu'elle lui confie, y cliquer et y écrire ;
- le point sensible : pour agir dans les pages, il faut cocher dans Safari « Autoriser JavaScript depuis les
  événements Apple ». Ce réglage permet aux apps qu'elle a autorisées à « contrôler Safari » d'agir dans ses pages,
  y compris celles où elle est connectée. Le README explique comment limiter ce risque (section « Le réglage
  Safari… »). Sans ce réglage, l'outil s'installe quand même ; Claude ne peut juste pas agir dans les pages ;
- ce que les empreintes prouvent et ne prouvent pas : que le fichier est celui publié ici, pas que l'auteur est digne
  de confiance. Pour ça, il y a la relecture du code et la vérification d'Apple (étape 4).

Puis demande-lui si elle veut l'installer. Si elle hésite ou si quelque chose te paraît anormal dans le code, dis-le
et arrête-toi là.

## 3. Autre façon : la commande à donner à la personne

Il faut macOS 14 ou plus, Claude Code (`claude`) et les outils d'Apple. S'ils manquent : `xcode-select --install`.

Elle ouvre l'app Terminal et colle cette ligne :

```bash
mkdir -p "${TMPDIR:-/tmp}/ai-for-safari" && cd "${TMPDIR:-/tmp}/ai-for-safari" && curl -fL -o ai-for-safari.zip "https://github.com/Fripouilledu92/ai-for-safari/releases/download/v1.12/ai-for-safari-1.12.zip" && echo "a7af874e276a93ba66217ef7f14f230d231682f823f934b64901586799361fca  ai-for-safari.zip" | shasum -a 256 -c - && ditto -x -k ai-for-safari.zip . && echo "145bcd6f4ef2e68b213478ae9ac6a474dafa627a823d9943a0fe92e8222783e7  ai-for-safari-1.12/distribution/installer.sh" | shasum -a 256 -c - && bash ai-for-safari-1.12/distribution/installer.sh
```

Dans l'ordre : télécharge l'archive dans un dossier temporaire (pas dans Téléchargements, que macOS protège),
**s'arrête si l'empreinte de l'archive ou du script n'est pas celle de cette page**, déplie, puis lance le script que
tu as lu.

### Guider la personne pas à pas

Beaucoup de gens n'ont jamais ouvert le Terminal. Ne lui dis pas seulement « lance cette commande » : guide-la, une
étape à la fois, et attends qu'elle te dise ce qu'elle voit avant de passer à la suivante. Donne-lui la commande dans
un bloc à copier, et ces explications, avec tes mots :

1. **Ouvrir le Terminal** : appuyer en même temps sur les touches `⌘ Commande` et `Espace`. Une barre de recherche
   apparaît au milieu de l'écran. Taper `Terminal`, puis appuyer sur `Entrée`. Une fenêtre s'ouvre, avec une ligne
   qui finit par `%` ou `$` et un curseur qui clignote : c'est là qu'on colle.
2. **Copier la commande** : dans ta réponse, cliquer sur le bouton de copie du bloc de code, ou sélectionner toute la
   ligne (elle est longue, il faut tout prendre) puis `⌘ Commande` + `C`.
3. **La coller** : cliquer dans la fenêtre du Terminal, puis `⌘ Commande` + `V`. Le texte apparaît après le `%`.
   Si le Terminal demande « Voulez-vous vraiment coller… ? », répondre Coller.
4. **La lancer** : appuyer sur `Entrée`. Rien d'autre à taper. Il n'y a pas de mot de passe à donner : si le
   Terminal en demande un, s'arrêter et te le dire, ce n'est pas normal.
5. **Attendre** : une à trois minutes. Des lignes défilent (d'abord un petit tableau de chiffres : le téléchargement ; puis `ai-for-safari.zip: OK`,
   `installer.sh: OK`, `Empreintes de l'archive : conformes.`, `Pont et app du panneau compiles sur ce Mac.`).
   L'installation est finie quand le texte « Installe. Dans Safari, une seule fois : » s'affiche et que le `%`
   revient. Deux fenêtres « AI for Safari » peuvent s'ouvrir : c'est normal.
6. **Me dire ce qui s'affiche** : lui demander de copier les dernières lignes du Terminal (ou d'en faire une capture
   d'écran avec `⌘ Commande` + `Majuscule` + `4`) et de te les envoyer, pour que tu vérifies.

Ce qu'il faut répondre selon ce qu'elle voit :

| Ce qui s'affiche | Ce que ça veut dire | Quoi faire |
|---|---|---|
| `command not found: claude` ou « il manque Claude Code » | Claude Code n'est pas installé | L'installer d'abord (https://claude.com/product/claude-code), puis recoller la commande. |
| « il manque le compilateur d'Apple », ou `xcrun: error` | Les outils d'Apple manquent | Taper `xcode-select --install` puis `Entrée` ; dans la fenêtre qui s'ouvre, cliquer « Installer » et attendre la fin (plusieurs minutes), puis recoller la commande. |
| `FAILED` ou « did NOT match » | L'archive n'est pas celle publiée ici | Ne rien relancer. Le dire, c'est peut-être une mauvaise version de la page ; vérifier qu'elle a bien collé toute la ligne. |
| `curl: (6)` ou `(7)` | Pas d'accès à Internet | Vérifier la connexion, puis recoller. |
| « il faut macOS 14 ou plus » | Mac trop ancien | L'outil ne marchera pas sur ce Mac. |
| Le `%` revient sans « Installe. » | Une étape a échoué | Lui demander d'envoyer tout le texte du Terminal, et lire l'erreur avec elle. |

Ensuite, guide-la de la même façon dans Safari (étape 5) : menu **Safari** en haut à gauche de l'écran, puis
**Réglages…**, puis l'onglet **Extensions** ; cocher la case à côté de « AI for Safari ». Le bouton boussole
apparaît en haut de la fenêtre Safari. Au premier clic dessus, Safari demande l'accès aux sites : choisir
« Toujours autoriser sur tous les sites web » (selon la version de Safari, c'est aussi dans Réglages > Extensions,
bouton « Modifier les sites web… », réglage « Autres sites web » sur « Autoriser »). Le panneau s'ouvre.

## 4. Vérification indépendante de GitHub (facultative, sans rien exécuter)

Les empreintes viennent de la même page que l'archive. Pour un repère qui ne dépend pas de GitHub, la personne (ou
toi, puisque cette commande ne fait que lire) peut demander à macOS qui a signé l'extension :

```bash
spctl -a -vv "$HOME/Library/Application Support/AI for Safari/extension/AI for Safari.app"
```

Réponse attendue : `accepted`, `source=Notarized Developer ID`, et l'identifiant d'équipe `NJBM478B7B`. Cela veut dire
qu'Apple connaît l'identité du développeur qui a signé l'extension et l'a analysée avant de la valider. Cela ne
couvre que l'extension : les scripts, eux, se vérifient en les lisant (étape 1).

## 5. Ce que la personne fait elle-même ensuite

Dans Safari, une seule fois : Réglages > Extensions, cocher « AI for Safari » puis « Toujours autoriser sur tous les
sites web ». Le bouton boussole de la barre d'outils ouvre le panneau.

Pour que Claude agisse dans les pages, le panneau explique et vérifie deux accords (menu + > « Compte et
autorisations ») : la fenêtre de macOS « contrôler Safari », et le réglage de Safari cité plus haut. Ne coche rien à
sa place.

Vérifier que Claude Code voit l'outil (commande qui ne fait que lire) :

```bash
claude mcp list | grep ai-for-safari
```

La ligne doit finir par « Connected ». Les outils `mcp__ai-for-safari__*` existent dans les nouvelles sessions.
Pour l'app Claude de bureau : ouvrir `connecteur/ai-for-safari.mcpb` de l'archive et accepter l'installation.

## Version pas à pas (si tu lances toi-même, avec l'accord de la personne)

Préviens-la que ton outil de permissions va lui demander d'accepter : télécharger l'archive, lancer le script, écrire
dans `~/Library/Application Support/AI for Safari`, ajouter le connecteur. Travaille dans le dossier temporaire,
jamais dans Téléchargements, Bureau ou Documents.

```bash
mkdir -p "${TMPDIR:-/tmp}/ai-for-safari" && cd "${TMPDIR:-/tmp}/ai-for-safari" && curl -fL -o ai-for-safari.zip "https://github.com/Fripouilledu92/ai-for-safari/releases/download/v1.12/ai-for-safari-1.12.zip" && shasum -a 256 ai-for-safari.zip
```

L'empreinte doit être `a7af874e276a93ba66217ef7f14f230d231682f823f934b64901586799361fca`. Ensuite :

```bash
cd "${TMPDIR:-/tmp}/ai-for-safari" && ditto -x -k ai-for-safari.zip . && shasum -a 256 ai-for-safari-1.12/distribution/installer.sh
```

L'empreinte doit être `145bcd6f4ef2e68b213478ae9ac6a474dafa627a823d9943a0fe92e8222783e7`. Si tout correspond et que
la personne a dit oui :

```bash
cd "${TMPDIR:-/tmp}/ai-for-safari" && bash ai-for-safari-1.12/distribution/installer.sh
```

Si une permission est refusée : ne cherche pas d'autre chemin, donne-lui la commande de l'étape 3.

## Désinstaller

```bash
claude mcp remove --scope user ai-for-safari; rm -rf ~/Library/Application\ Support/AI\ for\ Safari ~/.claude-safari
```

Puis décocher l'extension dans Safari > Réglages > Extensions, et retirer l'accord dans Réglages Système >
Confidentialité et sécurité > Automatisation.
