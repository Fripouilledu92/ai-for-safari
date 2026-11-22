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

Adresse de l'archive : `https://github.com/Fripouilledu92/ai-for-safari/releases/download/v1.0/ai-for-safari-1.0.zip`
Empreinte attendue (SHA-256) : `66d99146c79278a3f0d141c7bc1116cbc537a710fdd6abc82d8cfebeb81a0321`

```bash
mkdir -p ~/Downloads/ai-for-safari && cd ~/Downloads/ai-for-safari && curl -fL -o ai-for-safari.zip "https://github.com/Fripouilledu92/ai-for-safari/releases/download/v1.0/ai-for-safari-1.0.zip" && shasum -a 256 ai-for-safari.zip
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

Lis-lui la liste que le script affiche à la fin. Ce sont ses réglages et ses accords :

1. Safari > Réglages > Extensions : cocher « Claude », puis « Toujours autoriser sur tous les sites web ».
2. Safari > Réglages > Avancé : fonctionnalités pour les développeurs, puis « Autoriser JavaScript depuis les
   événements Apple ».
3. Ouvrir le panneau : relier l'extension (même code à 4 chiffres dans le panneau et dans la fenêtre de macOS), se
   connecter à son compte Claude, choisir les sites.
4. Accepter les demandes de macOS dont elle se sert (Automatisation, Microphone, Reconnaissance vocale, son).

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
