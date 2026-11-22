# AI for Safari

Un panneau pour parler à Claude dans Safari, sur ton Mac, avec ton propre abonnement Claude.
Claude peut lire la page ouverte, y cliquer et y écrire quand tu le lui demandes, écouter le son des pages, et
recevoir un texte que tu sélectionnes (« Demander à Claude »).

Projet indépendant. Il n'est ni fait ni approuvé par Anthropic ou par Apple. « Claude » est une marque d'Anthropic,
« Safari » une marque d'Apple.

## Ce qu'il faut

- macOS 14 ou plus récent, Safari.
- Claude Code installé et connecté à ton compte (`claude`), avec un abonnement Claude.
- Les outils de ligne de commande d'Apple (`xcode-select --install`).

## Installer

Le plus simple : donne à Claude Code le lien vers `INSTALLER.md` et dis-lui « installe ça ».
À la main : déplie l'archive, puis `bash distribution/installer.sh`.

## Sécurité

- Aucun identifiant ni clé n'est demandé : c'est la commande officielle `claude` qui garde ta connexion.
- Le programme local n'écoute que ton Mac (127.0.0.1) et ne répond qu'à l'extension que tu as reliée par un code.
- Tes discussions restent dans `~/.claude-safari`, lisibles par ton compte seulement.
- Claude ne tape jamais de mot de passe ni de carte bancaire, et demande avant de payer, d'envoyer, de publier ou de
  supprimer.
- L'installeur vérifie l'empreinte de chaque fichier et compile le pont et l'app sur ton Mac.

## Désinstaller

Voir la fin de `distribution/INSTALLER.md`.

## État de cette version (1.0)

L'extension de cette archive n'est pas encore vérifiée par Apple. Safari ne la charge que si tu coches
Développement > « Autoriser les extensions non signées », à refaire à chaque lancement de Safari.
Une version signée et vérifiée suivra.

Lien à donner à Claude Code pour installer :
`https://github.com/Fripouilledu92/ai-for-safari/blob/main/INSTALLER.md`

## Licence

MIT, voir `LICENSE`.
