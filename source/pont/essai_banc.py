#!/usr/bin/env python3
"""Essai complet du pont en mode banc (WKWebView hors ecran). Affiche BANC OK ou l'echec exact."""
import base64
import http.server
import json
import os
import struct
import subprocess
import sys
import tempfile
import wave
import threading
import time
import zlib

DIR = os.path.dirname(os.path.abspath(__file__))
PONT = os.path.join(DIR, "bin", "pont-safari")

PAGE_A = """<!doctype html><html><head><meta charset="utf-8"><title>Page A</title>
<script>window.__vuAvant = (window.__vu === 1);</script></head>
<body style="margin:0;background:#00AA00">
<div style="position:absolute;left:0;top:0;width:120px;height:120px;background:#FF0000"></div>
<h1 style="margin-left:200px">Bonjour</h1></body></html>"""
PAGE_B = '<!doctype html><html><head><meta charset="utf-8"><title>Page B éàü</title></head><body>B</body></html>'
PAGE_C = '<!doctype html><html><head><meta charset="utf-8"><title>Page C</title></head><body>C</body></html>'
PAGES = {"/": PAGE_A, "/b": PAGE_B, "/c": PAGE_C}


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        corps = PAGES.get(self.path.split("?")[0])
        if corps is None:
            self.send_response(404)
            self.end_headers()
            return
        data = corps.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):
        pass


class Echec(Exception):
    pass


def verifier(cond, msg):
    if not cond:
        raise Echec(msg)


class Pont:
    def __init__(self, args, env_extra=None, delai=90):
        env = dict(os.environ)
        env.pop("PONT_BANC_DIALOGUE", None)
        if env_extra:
            env.update(env_extra)
        self.p = subprocess.Popen([PONT] + args, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, env=env)
        self.n = 0
        self.delai = delai

    def req(self, op, **kw):
        self.n += 1
        d = {"id": self.n, "op": op}
        d.update(kw)
        tueur = threading.Timer(self.delai, self.p.kill)
        tueur.start()
        try:
            self.p.stdin.write((json.dumps(d) + "\n").encode("utf-8"))
            self.p.stdin.flush()
            ligne = self.p.stdout.readline()
        finally:
            tueur.cancel()
        if not ligne:
            err = self.p.stderr.read().decode("utf-8", "replace")
            raise Echec("le pont s'est arrete pendant '%s' (code %s). stderr : %s" % (op, self.p.poll(), err[-500:]))
        r = json.loads(ligne.decode("utf-8"))
        verifier(r.get("id") == self.n, "id de reponse inattendu pour %s : %r" % (op, r))
        return r

    def ok(self, op, **kw):
        r = self.req(op, **kw)
        verifier(r.get("ok") is True, "%s a echoue : %r" % (op, r))
        return r

    def erreur(self, op, code_attendu, **kw):
        r = self.req(op, **kw)
        verifier(r.get("ok") is False and r.get("code") == code_attendu, "%s : code %s attendu, recu %r" % (op, code_attendu, r))
        return r

    def attendre_js(self, fen, idx, code, attendu, delai=15):
        fin = time.time() + delai
        dernier = None
        while time.time() < fin:
            r = self.req("js", fenetre=fen, index=idx, code=code)
            dernier = r
            if r.get("ok") and r.get("resultat") == attendu:
                return r
            time.sleep(0.1)
        raise Echec("js %r : %r attendu, dernier resultat %r" % (code, attendu, dernier))

    def fermer(self):
        try:
            self.req("quitter")
        except Exception:
            pass
        try:
            return self.p.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.p.kill()
            return None


def dimensions_jpeg(b):
    i = 2
    while i < len(b):
        verifier(b[i] == 0xFF, "JPEG mal forme")
        m = b[i + 1]
        if m in (0xC0, 0xC1, 0xC2):
            h, w = struct.unpack(">HH", b[i + 5:i + 9])
            return w, h
        i += 2 + struct.unpack(">H", b[i + 2:i + 4])[0]
    raise Echec("SOF du JPEG introuvable")


def decoder_png(b):
    """Decodeur PNG minimal (8 bits, RGB ou RGBA, non entrelace). Renvoie (w, h, lignes de pixels)."""
    verifier(b[:8] == b"\x89PNG\r\n\x1a\n", "en-tete PNG absent")
    pos, idat, w, h, ct = 8, b"", 0, 0, 0
    while pos < len(b):
        ln, typ = struct.unpack(">I4s", b[pos:pos + 8])
        data = b[pos + 8:pos + 8 + ln]
        if typ == b"IHDR":
            w, h, depth, ct = struct.unpack(">IIBB", data[:10])
            verifier(depth == 8 and ct in (2, 6), "PNG non gere : profondeur %d type %d" % (depth, ct))
        elif typ == b"IDAT":
            idat += data
        pos += 12 + ln
    bpp = 3 if ct == 2 else 4
    raw = zlib.decompress(idat)
    stride = w * bpp
    lignes, prec = [], bytearray(stride)
    p = 0
    for _ in range(h):
        f = raw[p]
        cur = bytearray(raw[p + 1:p + 1 + stride])
        p += 1 + stride
        for i in range(stride):
            a = cur[i - bpp] if i >= bpp else 0
            up = prec[i]
            c = prec[i - bpp] if i >= bpp else 0
            if f == 1:
                cur[i] = (cur[i] + a) & 255
            elif f == 2:
                cur[i] = (cur[i] + up) & 255
            elif f == 3:
                cur[i] = (cur[i] + ((a + up) >> 1)) & 255
            elif f == 4:
                pa, pb, pc = abs(up - c), abs(a - c), abs(a + up - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (up if pb <= pc else c)
                cur[i] = (cur[i] + pr) & 255
        lignes.append(cur)
        prec = cur
    return w, h, lignes, bpp


def pixel(png, x, y):
    w, h, lignes, bpp = png
    return tuple(lignes[y][x * bpp:x * bpp + 3])


def proche(a, b, tol=40):
    return all(abs(i - j) <= tol for i, j in zip(a, b))


def essai_principal(base):
    tmp = tempfile.mkdtemp(prefix="pont-essai-")
    a_supprimer = []
    pont = Pont(["banc"], {"PONT_BANC_DIALOGUE": "Oui"})
    try:
        r = pont.ok("ping")
        verifier(r["mode"] == "banc" and r.get("version"), "ping : %r" % r)
        print("ping ok :", r)
        r = pont.ok("droits")
        verifier(r["capture_ecran"] is True and r["accessibilite"] is True, "droits : %r" % r)
        print("droits ok")

        fen = pont.ok("fenetre_creer", url=base + "/")["fenetre"]
        verifier(isinstance(fen, int), "fenetre_creer : pas un entier")
        pont.attendre_js(fen, 1, "document.readyState", "complete")
        r = pont.ok("onglets", fenetre=fen)
        verifier(len(r["onglets"]) == 1 and r["courant"] == 1, "onglets : %r" % r)
        verifier(r["onglets"][0]["index"] == 1 and r["onglets"][0]["url"].endswith("/"), "onglets[0] : %r" % r)
        pont.attendre_js(fen, 1, "document.title", "Page A")
        print("fenetre_creer + onglets ok")

        # Sans capteur, __vu n'est pas pose
        pont.attendre_js(fen, 1, "String(window.__vuAvant)", "false")

        r = pont.ok("onglet_creer", fenetre=fen, url=base + "/b")
        verifier(r["index"] == 2, "onglet_creer : %r" % r)
        r = pont.ok("onglets", fenetre=fen)
        verifier(len(r["onglets"]) == 2 and r["courant"] == 2, "onglets apres creation : %r" % r)
        pont.attendre_js(fen, 2, "document.title", "Page B éàü")
        print("onglet_creer ok (titre accentue lu)")

        pont.ok("onglet_url", fenetre=fen, index=2, url=base + "/c")
        pont.attendre_js(fen, 2, "document.title", "Page C")
        print("onglet_url ok (nouveau titre : Page C)")

        attendu = 'Été "guillemets" l\'apostrophe \\ ✓ 日本'
        r = pont.ok("js", fenetre=fen, index=1,
                    code="'Été \"guillemets\" l\\'apostrophe \\\\ ✓ 日本'")
        verifier(r["resultat"] == attendu, "js accents : %r != %r" % (r["resultat"], attendu))
        r = pont.ok("js", fenetre=fen, index=1, code="1+1")
        verifier(r["resultat"] == "2", "js nombre : %r" % r)
        r = pont.ok("js", fenetre=fen, index=1, code="undefined")
        verifier(r["resultat"] is None, "js undefined : %r" % r)
        pont.erreur("js", "JS_ERREUR", fenetre=fen, index=1, code="throw new Error('boum')")
        pont.erreur("js", "ONGLET_INTROUVABLE", fenetre=fen, index=9, code="1")
        pont.erreur("js", "FENETRE_INTROUVABLE", fenetre=424242, index=1, code="1")
        print("js ok (accents, guillemets, erreur JS_ERREUR)")

        pont.ok("onglet_courant", fenetre=fen, index=1)
        r = pont.ok("onglets", fenetre=fen)
        verifier(r["courant"] == 1, "onglet_courant : %r" % r)
        print("onglet_courant ok")

        r = pont.ok("devant")
        verifier(r["fenetre"] == fen and r["index"] == 1 and r["url"].endswith("/") and r["titre"] == "Page A"
                 and (r["x"], r["y"], r["largeur"], r["hauteur"]) == (0, 0, 1280, 800), "devant : %r" % r)
        pont.ok("onglet_courant", fenetre=fen, index=2)
        r = pont.ok("devant")
        verifier(r["index"] == 2 and r["url"].endswith("/c") and r["titre"] == "Page C", "devant onglet 2 : %r" % r)
        pont.ok("onglet_courant", fenetre=fen, index=1)
        print("devant ok :", r)

        r = pont.ok("bornes", fenetre=fen)
        verifier((r["largeur"], r["hauteur"]) == (1280, 800), "bornes par defaut : %r" % r)
        pont.ok("bornes_poser", fenetre=fen, largeur=900, hauteur=600)
        pont.attendre_js(fen, 1, "String(window.innerWidth)", "900")
        r = pont.ok("bornes", fenetre=fen)
        verifier((r["largeur"], r["hauteur"]) == (900, 600), "bornes apres pose : %r" % r)
        print("bornes + bornes_poser ok (innerWidth = 900)")

        r = pont.ok("calibrer", fenetre=fen, c1=[255, 0, 0], c2=[0, 170, 0])
        verifier(r["trouve"] is True and (r["x0"], r["y0"], r["x1"], r["y1"]) == (0, 0, 900, 600)
                 and r["echelle"] >= 1, "calibrer : %r" % r)
        print("calibrer ok :", r)

        # Captures
        r = pont.ok("capture", fenetre=fen, format="jpeg", largeur_sortie=400, qualite=0.7)
        jb = base64.b64decode(r["base64"])
        verifier(jb[:3] == b"\xff\xd8\xff", "JPEG : en-tete %r" % jb[:4])
        verifier(r["largeur"] == 400 and dimensions_jpeg(jb)[0] == 400, "JPEG : largeur %r" % r["largeur"])
        verifier(dimensions_jpeg(jb)[1] == r["hauteur"] and r["ms"] >= 0, "JPEG : hauteur %r" % r)
        print("capture jpeg ok : %dx%d, %d octets" % (r["largeur"], r["hauteur"], len(jb)))

        r = pont.ok("capture", fenetre=fen, format="png", largeur_sortie=300)
        pb = base64.b64decode(r["base64"])
        verifier(pb[:8] == b"\x89PNG\r\n\x1a\n", "PNG : en-tete")
        png = decoder_png(pb)
        verifier(png[0] == 300 and r["largeur"] == 300 and png[1] == r["hauteur"], "PNG : dimensions %r" % r)
        print("capture png ok : %dx%d" % (r["largeur"], r["hauteur"]))

        # Zone : le coin haut-gauche de la page est un carre rouge de 120 pt ; la page est verte
        f1 = os.path.join(tmp, "zone.png")
        a_supprimer.append(f1)
        r = pont.ok("capture", fenetre=fen, zone=[0, 0, 200, 100], largeur_sortie=100, format="png", fichier=f1)
        verifier(r["largeur"] == 100 and r["hauteur"] == 50, "zone : %dx%d au lieu de 100x50" % (r["largeur"], r["hauteur"]))
        verifier(os.path.exists(f1) and open(f1, "rb").read() == base64.b64decode(r["base64"]), "fichier de capture")
        png = decoder_png(base64.b64decode(r["base64"]))
        p1, p2 = pixel(png, 10, 10), pixel(png, 90, 40)
        verifier(proche(p1, (255, 0, 0)), "zone : pixel (10,10) = %r, rouge attendu (capture vide ?)" % (p1,))
        verifier(proche(p2, (0, 170, 0)), "zone : pixel (90,40) = %r, vert attendu" % (p2,))
        print("capture zone ok (pixels rouge puis vert lus)")
        pont.erreur("capture", "ARGUMENT", fenetre=fen, zone=[5000, 5000, 6000, 6000])

        # GIF : 3 images, une annotation de chaque type
        fichiers = []
        for i in range(3):
            f = os.path.join(tmp, "img%d.jpg" % i)
            a_supprimer.append(f)
            pont.ok("capture", fenetre=fen, format="jpeg", largeur_sortie=600, fichier=f)
            fichiers.append(f)
        sortie = os.path.join(tmp, "essai.gif")
        a_supprimer.append(sortie)
        r = pont.ok("gif", images=[
            {"fichier": fichiers[0], "duree_ms": 500, "annotations": [{"type": "clic", "x": 100, "y": 80}]},
            {"fichier": fichiers[1], "duree_ms": 600,
             "annotations": [{"type": "glisser", "x0": 50, "y0": 50, "x1": 300, "y1": 200}]},
            {"fichier": fichiers[2], "duree_ms": 700, "annotations": [{"type": "texte", "texte": "Etape é trois"}]},
        ], sortie=sortie, options={"barre": True, "filigrane": "claude-safari", "largeur": 300})
        verifier(r["images"] == 3 and r["fichier"] == sortie, "gif : %r" % r)
        data = open(sortie, "rb").read()
        verifier(data[:6] == b"GIF89a", "gif : en-tete %r" % data[:6])
        verifier(r["octets"] == len(data) and len(data) > 500, "gif : octets %r / %d" % (r["octets"], len(data)))
        verifier(data.count(b"\x2c") >= 3 and b"NETSCAPE2.0" in data, "gif : images ou boucle absentes")
        print("gif ok : %d octets, en-tete GIF89a, boucle presente" % len(data))
        pont.erreur("gif", "ARGUMENT", images=[{"fichier": "/inexistant.png", "duree_ms": 100}], sortie=sortie)

        r = pont.ok("dialogue", titre="t", message="m", boutons=["Oui", "Non"], delai_s=1)
        verifier(r["bouton"] == "Oui", "dialogue : %r" % r)
        print("dialogue ok (banc : Oui)")

        pont.ok("onglet_fermer", fenetre=fen, index=2)
        r = pont.ok("onglets", fenetre=fen)
        verifier(len(r["onglets"]) == 1 and r["courant"] == 1, "apres fermeture : %r" % r)
        pont.ok("onglet_fermer", fenetre=fen, index=1)
        pont.erreur("onglets", "FENETRE_INTROUVABLE", fenetre=fen)
        pont.erreur("devant", "FENETRE_INTROUVABLE")
        pont.erreur("onglets", "FENETRE_INTROUVABLE", fenetre=424242)
        pont.erreur("nimporte_quoi", "ARGUMENT")
        pont.erreur("onglets", "ARGUMENT")
        print("onglet_fermer ok (dernier onglet : fenetre fermee), erreurs ok")

        code = pont.fermer()
        verifier(code == 0, "quitter : code de sortie %r" % code)
    finally:
        if pont.p.poll() is None:
            pont.p.kill()
        for f in a_supprimer:
            if os.path.exists(f):
                os.remove(f)
        os.rmdir(tmp)


def essai_sans_dialogue():
    pont = Pont(["banc"])
    try:
        r = pont.ok("dialogue", titre="t", message="m", boutons=["Oui"], delai_s=1)
        verifier(r["bouton"] is None, "dialogue sans variable : %r" % r)
        print("dialogue sans PONT_BANC_DIALOGUE ok (null)")
        verifier(pont.fermer() == 0, "sortie propre")
    finally:
        if pont.p.poll() is None:
            pont.p.kill()


def essai_capteur(base):
    tmp = tempfile.mkdtemp(prefix="pont-capteur-")
    chemin = os.path.join(tmp, "capteur.js")
    with open(chemin, "w", encoding="utf-8") as f:
        f.write("window.__vu = 1;")
    pont = Pont(["banc", "--capteur", chemin])
    try:
        fen = pont.ok("fenetre_creer", url=base + "/")["fenetre"]
        pont.attendre_js(fen, 1, "document.readyState", "complete")
        pont.attendre_js(fen, 1, "document.title", "Page A")
        r = pont.ok("js", fenetre=fen, index=1, code="String(window.__vuAvant)")
        verifier(r["resultat"] == "true", "capteur absent avant les scripts de la page : %r" % r)
        # onglets crees ensuite : le capteur y est aussi
        pont.ok("onglet_creer", fenetre=fen, url=base + "/")
        pont.attendre_js(fen, 2, "String(window.__vuAvant)", "true")
        print("capteur ok : window.__vu = 1 present avant les scripts de la page")
        verifier(pont.fermer() == 0, "sortie propre")
    finally:
        if pont.p.poll() is None:
            pont.p.kill()
        os.remove(chemin)
        os.rmdir(tmp)


def voix_francaise():
    if subprocess.run(["say", "-v", "Thomas", "-o", os.devnull, "x"], capture_output=True).returncode == 0:
        return "Thomas"
    sortie = subprocess.run(["say", "-v", "?"], capture_output=True, text=True).stdout
    for ligne in sortie.splitlines():
        if "fr_" in ligne:
            return ligne.split("  ")[0].strip()
    raise Echec("aucune voix francaise pour say")


def essai_ecouter():
    tmp = tempfile.mkdtemp(prefix="pont-ecoute-")
    parole = os.path.join(tmp, "parole.aiff")
    silence = os.path.join(tmp, "silence.wav")
    pont = Pont(["banc"], delai=120)
    non_verifie = []
    try:
        r = subprocess.run(["say", "-v", voix_francaise(), "-o", parole, "Bonjour, ceci est un essai de AI for Safari."],
                           capture_output=True)
        verifier(r.returncode == 0 and os.path.exists(parole), "say a echoue : %r" % r.stderr)
        with wave.open(silence, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(16000)
            w.writeframes(b"\x00\x00" * 16000 * 3)

        pont.erreur("ecouter", "ARGUMENT", duree_s=3)
        pont.erreur("ecouter", "ARGUMENT", fichier=parole, duree_s=500)
        print("ecouter : banc sans fichier -> ARGUMENT ok")

        r = pont.req("ecouter", fichier=parole, langue="fr-FR")
        if r.get("ok") is False and r.get("code") in ("DICTEE_REFUSEE", "DELAI"):
            non_verifie.append("parole")
            print("ecouter : NON VÉRIFIÉ (reconnaissance vocale pas autorisée) [%s : %s]" % (r["code"], r.get("erreur")))
        else:
            verifier(r.get("ok") is True, "ecouter parole : %r" % r)
            t = r["texte"].lower()
            verifier("bonjour" in t and "essai" in t, "ecouter parole : texte inattendu %r" % r)
            verifier(r["silencieux"] is False and r["secondes"] > 1 and r["langue"] == "fr-FR"
                     and isinstance(r["sur_appareil"], bool) and isinstance(r["niveau_db"], int), "ecouter parole : %r" % r)
            print("ecouter parole ok :", r)
            r = pont.ok("ecouter", fichier=silence)
            verifier(r["silencieux"] is True and r["texte"] == "", "ecouter silence : %r" % r)
            print("ecouter silence ok :", r)
        verifier(os.path.exists(parole) and os.path.exists(silence), "ecouter ne doit pas supprimer le fichier donne")
        verifier(pont.fermer() == 0, "sortie propre")
    finally:
        if pont.p.poll() is None:
            pont.p.kill()
        for f in (parole, silence):
            if os.path.exists(f):
                os.remove(f)
        os.rmdir(tmp)


def essai_safari():
    """Seulement ping, droits, et onglets sur une fenetre inexistante. Aucune fenetre creee."""
    pont = Pont(["safari"], delai=150)
    try:
        r = pont.ok("ping")
        verifier(r["mode"] == "safari", "ping safari : %r" % r)
        r = pont.ok("droits")
        verifier(isinstance(r["capture_ecran"], bool) and isinstance(r["accessibilite"], bool), "droits safari : %r" % r)
        print("safari ping/droits ok :", r)
        r = pont.req("onglets", fenetre=999999)
        verifier(r.get("ok") is False and r.get("code") in
                 ("FENETRE_INTROUVABLE", "AUTOMATISATION_REFUSEE", "JS_APPLE_EVENTS_DESACTIVE"),
                 "onglets 999999 : code inattendu %r" % r)
        print("safari onglets(999999) :", r.get("code"), "-", r.get("erreur"))
        verifier(pont.fermer() == 0, "sortie propre")
    finally:
        if pont.p.poll() is None:
            pont.p.kill()


def essai_micros_dictee():
    """Liste des micros, et dictee avec un micro inconnu : erreur claire, vite, sans plantage."""
    r = subprocess.run([PONT, "micros"], capture_output=True, timeout=15)
    verifier(r.returncode == 0, "micros : code %d %r" % (r.returncode, r.stderr))
    lignes = r.stdout.decode().strip().splitlines()
    verifier(len(lignes) == 1, "micros : une seule ligne attendue, recu %r" % lignes)
    liste = json.loads(lignes[0])["micros"]
    verifier(len(liste) >= 1, "micros : aucun micro")
    verifier(all(set(m) == {"uid", "nom", "defaut"} and m["uid"] and m["nom"] for m in liste), "micros : forme %r" % liste)
    verifier(sum(1 for m in liste if m["defaut"] is True) == 1, "micros : un seul defaut attendu : %r" % liste)
    print("micros ok :", [m["nom"] for m in liste])
    t0 = time.time()
    r = subprocess.run("printf 'stop\\n' | (sleep 2; cat) | '%s' dictee fr-FR --micro INCONNU" % PONT,
                       shell=True, capture_output=True, timeout=10)
    duree = time.time() - t0
    evts = [json.loads(l) for l in r.stdout.decode().splitlines() if l.strip()]
    err = [e for e in evts if e.get("type") == "erreur"]
    verifier(err and duree < 5, "dictee micro inconnu : %r en %.1f s (%r)" % (evts, duree, r.stderr))
    verifier(err[0]["code"] in ("MICRO_INTROUVABLE", "MICRO_REFUSE", "DICTEE_REFUSEE"), "dictee : code %r" % err[0])
    verifier(r.returncode == 0, "dictee : plantage, code %d" % r.returncode)
    print("dictee micro inconnu ok : %s en %.1f s" % (err[0]["code"], duree))


def main():
    if not os.path.exists(PONT):
        print("ECHEC : %s absent (lancer pont/construire.sh)" % PONT)
        return 1
    serveur = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    base = "http://127.0.0.1:%d" % serveur.server_address[1]
    threading.Thread(target=serveur.serve_forever, daemon=True).start()
    try:
        essai_principal(base)
        essai_sans_dialogue()
        essai_capteur(base)
        essai_ecouter()
        essai_safari()
        essai_micros_dictee()
    except Echec as e:
        print("ECHEC :", e)
        return 1
    except Exception as e:  # noqa
        print("ECHEC (imprevu) : %s: %s" % (type(e).__name__, e))
        return 1
    finally:
        serveur.shutdown()
    print("BANC OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
