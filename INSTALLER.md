# Installer « AI for Safari »

Cette page s'adresse à Claude Code. La personne te l'a donnée pour que tu installes l'outil sur son Mac.
Fais les étapes dans l'ordre. Arrête-toi et dis-le si une étape échoue : n'invente pas de contournement.

Ce que tu ne fais pas : pas de `sudo`, aucun mot de passe, aucun réglage de Safari ou de macOS à sa place, aucun
autre téléchargement que l'archive ci-dessous.

## 1. Vérifier

```bash
sw_vers -productVersion && command -v claude && command -v swiftc
```

Il faut macOS 14 ou plus, `claude` et `swiftc`. S'il manque `swiftc`, demande à la personne de lancer
`xcode-select --install`, puis reprends.

## 2. Télécharger et vérifier l'archive

Adresse de l'archive : `https://github.com/Fripouilledu92/ai-for-safari/releases/download/v1.3/ai-for-safari-1.3.zip`
Empreinte attendue (SHA-256) : `a3c707cbf1a903257c9afa46fedb2eda734c2ef90c0cac5299c535386a63292f`

```bash
mkdir -p ~/Downloads/ai-for-safari && cd ~/Downloads/ai-for-safari && curl -fL -o ai-for-safari.zip "https://github.com/Fripouilledu92/ai-for-safari/releases/download/v1.3/ai-for-safari-1.3.zip" && shasum -a 256 ai-for-safari.zip
```

Compare l'empreinte affichée à celle de cette page. Si elle diffère, supprime le fichier et arrête-toi.

## 3. Installer

```bash
cd ~/Downloads/ai-for-safari && ditto -x -k ai-for-safari.zip . && bash ai-for-safari-*/distribution/installer.sh
```

Le script vérifie les empreintes de chaque fichier, copie tout dans
`~/Library/Application Support/AI for Safari`, compile le pont et l'app sur place, branche le connecteur
`claude-safari` dans Claude Code, puis ouvre les deux apps.

## 4. Ce que la personne fait elle-même

Dans Safari, une seule fois : Réglages > Extensions, cocher « AI for Safari » puis « Toujours autoriser sur tous les
sites web ». Ensuite, le bouton boussole de la barre d'outils ouvre le panneau.

macOS ne demande un droit qu'au moment où il sert pour la première fois (micro, son des pages, pilotage de Safari).
Pour que Claude agisse dans les pages : Safari > Réglages > Avancé > « Afficher les fonctionnalités pour les
développeurs », puis Développement > Réglages pour les développeurs > « Autoriser JavaScript depuis les événements
Apple ».

## 5. Vérifier

```bash
claude mcp list | grep claude-safari
```

La ligne doit finir par « Connected ». Les outils `mcp__claude-safari__*` existent dans les nouvelles sessions.

Pour l'app Claude de bureau : ouvrir `connecteur/ai-for-safari.mcpb` de l'archive et accepter l'installation.

## Désinstaller

```bash
claude mcp remove --scope user claude-safari; rm -rf ~/Library/Application\ Support/AI\ for\ Safari
```

Puis décocher l'extension dans Safari > Réglages > Extensions.
