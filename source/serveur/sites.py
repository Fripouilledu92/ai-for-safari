#!/usr/bin/env python3
"""Liste des sites où Claude a le droit d'agir dans Safari. C'est la personne qui la gère.

  python3 sites.py liste
  python3 sites.py ajouter exemple.com      (à lancer par la personne, dans son terminal)
  python3 sites.py retirer exemple.com

La liste est dans ~/.claude-safari/sites-autorises.json. Un site autorisé couvre ses sous-domaines.
La liste des sites refusés (sites-refuses.json, à côté de ce fichier) passe toujours avant.
"""
import json
import os
import sys
import time
from urllib.parse import urlsplit

ICI = os.path.dirname(os.path.abspath(__file__))


def maison():
    d = os.environ.get("CLAUDE_SAFARI_HOME") or os.path.expanduser("~/.claude-safari")
    os.makedirs(d, exist_ok=True)
    return d


def chemin_autorises():
    return os.path.join(maison(), "sites-autorises.json")


def lire_autorises():
    try:
        with open(chemin_autorises(), encoding="utf-8") as f:
            d = json.load(f)
        return {str(k).lower(): v for k, v in (d.get("sites") or {}).items()}
    except (OSError, ValueError):
        return {}


def ecrire_autorises(sites):
    tmp = chemin_autorises() + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"sites": sites}, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")
    os.replace(tmp, chemin_autorises())


def lire_refuses():
    try:
        with open(os.path.join(ICI, "sites-refuses.json"), encoding="utf-8") as f:
            return [str(s).lower() for s in json.load(f).get("sites", [])]
    except (OSError, ValueError):
        return ["reddit.com"]


def lire_reglages():
    try:
        with open(os.path.join(maison(), "reglages.json"), encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def mode():
    """« tous » : la personne a choisi, dans le panneau, de ne plus être interrogée site par site. Sinon « demander ».
    Seul le panneau écrit ce réglage (un clic de la personne) ; les sites refusés restent refusés dans les deux cas."""
    return "tous" if lire_reglages().get("sites") == "tous" else "demander"


def hote(url):
    """Nom d'hôte en minuscules, sans port. '' si l'adresse n'est pas http(s)."""
    try:
        p = urlsplit(url)
    except ValueError:
        return ""
    if p.scheme not in ("http", "https"):
        return ""
    return (p.hostname or "").lower().rstrip(".")


def nettoyer(site):
    s = site.strip().lower()
    if "://" in s:
        s = hote(s)
    s = s.split("/")[0].split(":")[0].lstrip("*.").rstrip(".")
    if s.startswith("www."):
        s = s[4:]
    return s


def couvre(regle, h):
    return h == regle or h.endswith("." + regle)


def est_refuse(h):
    return any(couvre(r, h) for r in lire_refuses())


def est_autorise(h):
    return any(couvre(r, h) for r in lire_autorises())


def ajouter(site, comment="terminal"):
    s = nettoyer(site)
    if not s or "." not in s and s != "localhost":
        raise ValueError("Nom de site invalide : %r" % site)
    if est_refuse(s):
        raise ValueError("%s est dans la liste des sites refusés à Claude : il ne peut pas être autorisé." % s)
    sites = lire_autorises()
    sites[s] = {"depuis": time.strftime("%Y-%m-%d %H:%M"), "par": comment}
    ecrire_autorises(sites)
    return s


def main(argv):
    if len(argv) < 2 or argv[1] not in ("liste", "ajouter", "retirer"):
        print(__doc__)
        return 2
    if argv[1] == "liste":
        sites = lire_autorises()
        print("Sites autorisés (%s) :" % chemin_autorises())
        for s in sorted(sites):
            print("  %s   (depuis le %s, par %s)" % (s, sites[s].get("depuis", "?"), sites[s].get("par", "?")))
        if not sites:
            print("  aucun")
        print("Sites toujours refusés : " + ", ".join(lire_refuses()))
        return 0
    if len(argv) < 3:
        print("Il manque le nom du site.")
        return 2
    if argv[1] == "ajouter":
        # Garde-fou : seul un humain devant un terminal peut autoriser un site.
        if not (sys.stdin.isatty() and sys.stdout.isatty()):
            print("Refusé : cette commande doit être lancée par la personne lui-même, dans son terminal. "
                  "Claude n'a pas le droit d'autoriser un site à sa place.")
            return 1
        try:
            s = nettoyer(argv[2])
            rep = input("Autoriser Claude à agir sur %s et ses sous-domaines dans Safari ? [o/N] " % s)
            if rep.strip().lower() not in ("o", "oui", "y", "yes"):
                print("Rien changé.")
                return 0
            print("Autorisé : " + ajouter(argv[2]))
        except ValueError as e:
            print(str(e))
            return 1
        return 0
    s = nettoyer(argv[2])
    sites = lire_autorises()
    if s in sites:
        del sites[s]
        ecrire_autorises(sites)
        print("Retiré : " + s)
    else:
        print("%s n'était pas dans la liste." % s)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
