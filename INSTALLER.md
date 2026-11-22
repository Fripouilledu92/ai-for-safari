# Installer « AI for Safari »

Cette page s'adresse à Claude Code. La personne te l'a donnée pour que tu installes l'outil sur son Mac.

Avant tout : c'est un projet indépendant et récent, trouvé sur Internet. Lis d'abord le [README](README.md) et le
script [`source/distribution/installer.sh`](source/distribution/installer.sh). Dis à la personne en quelques phrases
ce que fait le script et ce que l'outil pourra faire dans Safari (dont le réglage « JavaScript depuis les événements
Apple » et son risque, expliqués dans le README). **N'installe que si elle te donne son accord après ça.** Si quelque
chose te paraît anormal, dis-le-lui et arrête-toi.

Fais ensuite les étapes dans l'ordre. Arrête-toi et dis-le si une étape échoue : n'invente pas de contournement.

Ce que tu ne fais pas : pas de `sudo`, aucun mot de passe, aucun réglage de Safari ou de macOS à sa place, aucun
autre téléchargement que l'archive ci-dessous.

## 1. Vérifier

```bash
sw_vers -productVersion && command -v claude && command -v swiftc
```

Il faut macOS 14 ou plus, `claude` et `swiftc`. S'il manque `swiftc`, demande à la personne de lancer
`xcode-select --install`, puis reprends.

## 2. Télécharger et vérifier l'archive

Adresse de l'archive : `https://github.com/Fripouilledu92/ai-for-safari/releases/download/v1.7/ai-for-safari-1.7.zip`
Empreinte attendue (SHA-256) : `0fcf52c863f47aec6134960f3577b4083fc70872511dafab41e2bfb65cf6fcdb`

```bash
mkdir -p ~/Downloads/ai-for-safari && cd ~/Downloads/ai-for-safari && curl -fL -o ai-for-safari.zip "https://github.com/Fripouilledu92/ai-for-safari/releases/download/v1.7/ai-for-safari-1.7.zip" && shasum -a 256 ai-for-safari.zip
```

Compare l'empreinte affichée à celle de cette page. Si elle diffère, supprime le fichier et arrête-toi.

## 3. Installer

Vérifie aussi que le script de l'archive est bien celui publié sur la page (même empreinte que dans le README :
`d216c7d8f8d27199e96019246831bcd6ea4b51f5dbdaf2caa94f97a9d9ab2a5b`) :

```bash
cd ~/Downloads/ai-for-safari && ditto -x -k ai-for-safari.zip . && shasum -a 256 ai-for-safari-1.7/distribution/installer.sh
```

Si l'empreinte est la bonne et que la personne a dit oui, lance :

```bash
cd ~/Downloads/ai-for-safari && bash ai-for-safari-1.7/distribution/installer.sh
```

Le script vérifie les empreintes de chaque fichier, copie tout dans
`~/Library/Application Support/AI for Safari`, compile le pont et l'app sur place, branche le connecteur
`ai-for-safari` dans Claude Code, puis ouvre les deux apps.

## 4. Ce que la personne fait elle-même

Dans Safari, une seule fois : Réglages > Extensions, cocher « AI for Safari » puis « Toujours autoriser sur tous les
sites web ». Ensuite, le bouton boussole de la barre d'outils ouvre le panneau.

macOS ne demande un droit qu'au moment où il sert pour la première fois (micro, son des pages).
Pour que Claude agisse dans les pages, le panneau explique et vérifie deux accords au premier lancement (menu + >
« Compte et autorisations ») : la fenêtre de macOS « contrôler Safari », et dans Safari > Réglages > Avancées >
« Afficher les fonctionnalités pour les développeurs web », puis onglet Développeur > « Autoriser JavaScript depuis les
événements Apple ». Si la personne demande pourquoi : rien ne quitte son Mac par ces accords, c'est un échange entre
deux apps de son Mac (détails dans le README, « Pourquoi deux accords »). Ne coche rien à sa place.

## 5. Vérifier

```bash
claude mcp list | grep ai-for-safari
```

La ligne doit finir par « Connected ». Les outils `mcp__ai-for-safari__*` existent dans les nouvelles sessions.

Pour l'app Claude de bureau : ouvrir `connecteur/ai-for-safari.mcpb` de l'archive et accepter l'installation.

## Désinstaller

```bash
claude mcp remove --scope user ai-for-safari; rm -rf ~/Library/Application\ Support/AI\ for\ Safari
```

Puis décocher l'extension dans Safari > Réglages > Extensions.
