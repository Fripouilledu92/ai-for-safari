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

## Pourquoi deux accords pour agir dans les pages

Pour que Claude clique et écrive dans une page à ta place, deux accords sont demandés. Leurs noms font technique,
voici ce qu'ils font vraiment :

- **« AI for Safari souhaite contrôler Safari »** (fenêtre de macOS) : l'app peut ouvrir un onglet, changer de page,
  cliquer et écrire. macOS pose cette question pour toute app qui pilote une autre app.
- **« Autoriser JavaScript depuis les événements Apple »** (réglage de Safari) : Safari accepte ces actions quand elles
  viennent d'une app de ton Mac. Apple le range dans les réglages pour développeurs, d'où le nom.

Ce que ça ne fait pas :

- Rien ne quitte ton Mac par ces accords : c'est un échange entre deux apps de ton Mac.
- Claude n'agit que dans les onglets qu'il ouvre ou que tu lui confies, jamais sur tes mots de passe ni tes cartes.
- Tu peux tout retirer quand tu veux : Réglages Système > Confidentialité et sécurité > Automatisation, et la case dans
  Safari.

Le panneau explique tout ça au premier lancement (menu + > « Compte et autorisations ») et vérifie les deux accords
avec le bouton « Vérifier ». Sans eux, tu peux quand même parler à Claude ; il ne peut juste pas agir dans la page.

## Désinstaller

Voir la fin de `distribution/INSTALLER.md`.

## État de cette version (1.4)

L'extension est signée (Developer ID) et vérifiée par Apple : Safari la charge normalement.

Lien à donner à Claude Code pour installer :
`https://github.com/Fripouilledu92/ai-for-safari/blob/main/INSTALLER.md`

## Licence

MIT, voir `LICENSE`.
