# AI for Safari

Un panneau pour parler à Claude dans Safari, sur ton Mac, avec ton propre abonnement Claude.
Claude peut lire la page ouverte, y cliquer et y écrire quand tu le lui demandes, écouter le son des pages, et
recevoir un texte que tu sélectionnes (« Demander à Claude »).

Projet indépendant et récent. Il n'est ni fait ni approuvé par Anthropic ou par Apple. « Claude » est une marque
d'Anthropic, « Safari » une marque d'Apple. Le code a été écrit avec l'aide de Claude ; tout le code est dans le
dossier [`source/`](source/), lisible avant d'installer quoi que ce soit.

**Dernière version : [1.8](https://github.com/Fripouilledu92/ai-for-safari/releases/tag/v1.8)**
(toutes les versions : [Releases](https://github.com/Fripouilledu92/ai-for-safari/releases)).

## Ce qu'il faut

- macOS 14 ou plus récent, Safari.
- Claude Code installé et connecté à ton compte (`claude`), avec un abonnement Claude.
- Les outils de ligne de commande d'Apple (`xcode-select --install`).

## Installer en une commande

Dans l'app Terminal, colle cette ligne. Elle télécharge l'archive dans un dossier temporaire, **s'arrête si
l'empreinte de l'archive ou du script n'est pas celle du tableau plus bas**, puis lance l'installeur (lisible dans
[`source/distribution/installer.sh`](source/distribution/installer.sh)) :

```bash
mkdir -p "${TMPDIR:-/tmp}/ai-for-safari" && cd "${TMPDIR:-/tmp}/ai-for-safari" && curl -fL -o ai-for-safari.zip "https://github.com/Fripouilledu92/ai-for-safari/releases/download/v1.8/ai-for-safari-1.8.zip" && echo "a31847382fe6653a307803522abbbb7fb86f6f7810ee4a637e23d127d4e82bad  ai-for-safari.zip" | shasum -a 256 -c - && ditto -x -k ai-for-safari.zip . && echo "d216c7d8f8d27199e96019246831bcd6ea4b51f5dbdaf2caa94f97a9d9ab2a5b  ai-for-safari-1.8/distribution/installer.sh" | shasum -a 256 -c - && bash ai-for-safari-1.8/distribution/installer.sh
```

Puis, dans Safari > Réglages > Extensions : coche « AI for Safari », puis « Toujours autoriser sur tous les sites web ».

## Installer à la main (pour tout lire avant)

1. Télécharge l'archive et vérifie son empreinte :

   ```bash
   mkdir -p "${TMPDIR:-/tmp}/ai-for-safari" && cd "${TMPDIR:-/tmp}/ai-for-safari" && curl -fL -o ai-for-safari.zip "https://github.com/Fripouilledu92/ai-for-safari/releases/download/v1.8/ai-for-safari-1.8.zip" && shasum -a 256 ai-for-safari.zip
   ```

   L'empreinte affichée doit être celle du tableau plus bas. Sinon, supprime le fichier.

2. Déplie l'archive et **lis le script avant de le lancer** :

   ```bash
   cd "${TMPDIR:-/tmp}/ai-for-safari" && ditto -x -k ai-for-safari.zip . && less ai-for-safari-1.8/distribution/installer.sh
   ```

   C'est le même fichier que [`source/distribution/installer.sh`](source/distribution/installer.sh). Il ne demande aucun
   mot de passe, n'utilise pas `sudo`, ne télécharge rien et ne change aucun réglage de macOS ou de Safari.

3. Lance-le :

   ```bash
   cd "${TMPDIR:-/tmp}/ai-for-safari" && bash ai-for-safari-1.8/distribution/installer.sh
   ```

   Il vérifie l'empreinte de chaque fichier, copie tout dans `~/Library/Application Support/AI for Safari`, compile le
   pont et l'app du panneau sur ton Mac, et ajoute le connecteur `ai-for-safari` à Claude Code.

4. Dans Safari > Réglages > Extensions : coche « AI for Safari », puis « Toujours autoriser sur tous les sites web ».

Avec Claude Code : tu peux aussi lui donner [`INSTALLER.md`](INSTALLER.md). Ne le fais que si tu as lu ce README et
le script : un agent qui installe un logiciel à partir d'instructions trouvées sur Internet, c'est aussi le schéma
d'une attaque. `INSTALLER.md` demande à Claude Code de te montrer ce que fait le script et d'attendre ton accord avant
de le lancer.

## Plugin Claude Code

Une fois l'app et l'extension installées, les outils existent aussi en plugin Claude Code (dossier [`plugin/`](plugin/),
en anglais) :

```
/plugin install ai-for-safari --marketplace Fripouilledu92/ai-for-safari
```

L'installeur ajoute déjà les mêmes outils comme connecteur `ai-for-safari` : garde l'un des deux.

## Empreintes (SHA-256)

| Fichier | Empreinte |
|---|---|
| `ai-for-safari-1.8.zip` (archive de la version 1.8) | `a31847382fe6653a307803522abbbb7fb86f6f7810ee4a637e23d127d4e82bad` |
| `distribution/installer.sh` (dans l'archive et dans `source/`) | `d216c7d8f8d27199e96019246831bcd6ea4b51f5dbdaf2caa94f97a9d9ab2a5b` |

Les empreintes de tous les autres fichiers de l'archive sont dans
[`source/EMPREINTES.sha256`](source/EMPREINTES.sha256) ; l'installeur les vérifie avant de copier quoi que ce soit.

## Vérifier par toi-même

Après avoir déplié l'archive (`cd "${TMPDIR:-/tmp}/ai-for-safari/ai-for-safari-1.8"`) :

- **L'extension est signée et vérifiée par Apple** (Developer ID, notarisée) :

  ```bash
  spctl -a -vv "extension/AI for Safari.app"
  ```

  La réponse attendue : `accepted`, `source=Notarized Developer ID`. Seule l'extension est signée par ce certificat :
  l'app du panneau et le pont sont compilés sur ton Mac par l'installeur, à partir du code que tu peux lire.

- **Le code ne parle qu'à ton Mac.** Le programme local écoute seulement sur `127.0.0.1` (`panneau/discussion.py`,
  cherche `ThreadingHTTPServer`). Les seules adresses Internet du code :

  ```bash
  grep -rhoE "https?://[a-zA-Z0-9._/:-]+" serveur panneau app pont distribution | grep -v "127.0.0.1\|w3.org\|apple.com/DTDs" | sort -u
  ```

  Tu dois voir seulement la page de Claude Code (ouverte si Claude Code manque) et une adresse d'exemple.

- **Aucun identifiant n'est demandé ni lu.** Ni mot de passe, ni clé d'API, ni trousseau : ta connexion à Claude
  reste dans la commande officielle `claude`. Pour le vérifier :

  ```bash
  grep -rniE "keychain|security find|api[_ -]?key|ANTHROPIC_API" serveur panneau app pont distribution
  ```

  Tu trouves trois lignes : une masque les clés dans les adresses lues par Claude, une interdit l'envoi de fichiers
  sensibles (`.ssh`, trousseaux), et `app/construire-app.sh` liste tes certificats de signature (`security
  find-identity`, sans mot de passe), seulement si tu lances l'installeur avec l'option `CS_SIGNATURE_DEV=1` ; par
  défaut, cette ligne ne sert pas.

## Ce qui part chez Anthropic

Ce que tu écris dans le panneau, et ce que Claude lit dans une page pour te répondre (texte, captures), part chez
Anthropic par la commande officielle `claude`, comme dans l'app Claude. Rien d'autre ne sort de ton Mac. Tes
discussions sont gardées dans `~/.claude-safari`, lisible par ton compte seulement.

## Le réglage Safari « JavaScript depuis les événements Apple » : à quoi il sert, ce qu'il risque

Pour que Claude clique et écrive dans une page, deux accords sont demandés :

1. **« AI for Safari souhaite contrôler Safari »** (fenêtre de macOS). L'app peut ouvrir un onglet, changer de page,
   lire la page, cliquer et écrire.
2. **« Autoriser JavaScript depuis les événements Apple »** (Safari > Réglages > Avancées > « Afficher les
   fonctionnalités pour les développeurs web », puis onglet Développeur).

**Ce que fait ce réglage** : il permet aux apps de ton Mac que tu as autorisées à contrôler Safari (accord n° 1)
d'exécuter du JavaScript dans tes pages. C'est par là que Claude lit la page et y agit.

**Ce qu'il risque, honnêtement** : il ne concerne pas seulement AI for Safari. Toute app à qui tu as donné l'accord
« contrôler Safari » pourrait lire ou modifier les pages ouvertes, y compris celles où tu es connecté (mails,
banque). C'est pour ça que Safari demande une confirmation et le range dans les réglages pour développeurs.

**Comment limiter ce risque** :

- Regarde qui a l'accord : Réglages Système > Confidentialité et sécurité > Automatisation. Ne laisse « Safari » coché
  que pour des apps que tu connais.
- Décoche le réglage de Safari quand tu ne te sers pas de Claude dans les pages ; recoche-le quand tu veux.
- Côté AI for Safari : Claude n'agit que dans les onglets qu'il ouvre ou que tu lui confies depuis le panneau, ne tape
  jamais de mot de passe ni de carte, et te demande avant de payer, d'envoyer, de publier ou de supprimer.

Sans ces deux accords, tu peux quand même parler à Claude dans le panneau ; il ne peut juste pas agir dans la page.
Le panneau les explique et les vérifie (menu + > « Compte et autorisations »).

## Sécurité

- Politique de confidentialité : [`PRIVACY.md`](PRIVACY.md).

- Le programme local ne répond qu'à l'extension que tu as reliée (clé gardée dans l'extension, empreinte seule sur le
  disque, preuve d'identité à chaque connexion).
- Les sites où Claude agit : demandés un par un, ou tous si tu le choisis au départ.
- Un problème de sécurité ? Ouvre une issue sur ce dépôt.

## Désinstaller

```bash
claude mcp remove --scope user ai-for-safari; rm -rf ~/Library/Application\ Support/AI\ for\ Safari ~/.claude-safari
```

Puis décoche l'extension dans Safari > Réglages > Extensions, et retire l'accord dans Réglages Système >
Confidentialité et sécurité > Automatisation.

## Licence

MIT, voir [`LICENSE`](LICENSE).
