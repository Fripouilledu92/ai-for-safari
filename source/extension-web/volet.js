// Dessine le panneau Claude dans la page, collé au bord droit de la fenêtre, comme le panneau latéral de Chrome.
// La page est resserrée pour lui laisser la place : la marge droite du document, plus les éléments « fixes »
// (barres collées en haut, bulles en bas à droite) qu'une simple marge ne déplace pas.
// Le panneau lui-même est une page de l'extension (dans un cadre) : la page visitée ne peut ni la lire ni lui écrire.
(function () {
  "use strict";
  if (window.top !== window) return;
  var api = typeof browser !== "undefined" ? browser : chrome;
  var LARGEUR = 400, MIN = 320, hote = null, margeAvant = null, veille = null, attente = 0, deplaces = [];

  function ajusterFixes() {
    if (!hote) return;
    var limite = window.innerWidth - LARGEUR;
    var tous = document.body ? document.body.getElementsByTagName("*") : [];
    for (var i = 0; i < tous.length; i++) {
      var el = tous[i];
      if (el.__csVolet || el === hote || el.id === "__cs_voyant") continue;
      var st = getComputedStyle(el);
      if (st.position !== "fixed" || st.display === "none") continue;
      var r = el.getBoundingClientRect();
      if (!r.width || r.right <= limite + 1) continue;
      el.__csVolet = { right: el.style.getPropertyValue("right"), rp: el.style.getPropertyPriority("right"),
        max: el.style.getPropertyValue("max-width"), mp: el.style.getPropertyPriority("max-width") };
      deplaces.push(el);
      el.style.setProperty("right", ((parseFloat(st.right) || 0) + LARGEUR) + "px", "important");
      if (el.getBoundingClientRect().right > limite + 1) el.style.setProperty("max-width", Math.max(0, limite - Math.max(0, r.left)) + "px", "important");
    }
  }
  function plusTard() { clearTimeout(attente); attente = setTimeout(ajusterFixes, 250); }
  function remettreFixes() {
    deplaces.forEach(function (el) {
      var a = el.__csVolet; if (!a) return;
      if (a.right) el.style.setProperty("right", a.right, a.rp); else el.style.removeProperty("right");
      if (a.max) el.style.setProperty("max-width", a.max, a.mp); else el.style.removeProperty("max-width");
      delete el.__csVolet;
    });
    deplaces = [];
  }

  // Place prise par le panneau : la page la lit (aura de Claude autour de la page seulement, pas du panneau).
  function placer() {
    var racine = document.documentElement;
    racine.style.setProperty("margin-right", LARGEUR + "px", "important");
    racine.style.setProperty("width", "calc(100% - " + LARGEUR + "px)", "important");
    racine.setAttribute("data-cs-volet", String(LARGEUR));
    if (hote) hote.style.width = LARGEUR + "px";
  }
  function bornes(l) { return Math.round(Math.max(MIN, Math.min(Math.min(820, window.innerWidth - 320), l))); }

  function poignee(ombre) {
    // Bord gauche du panneau : on le tire pour changer sa largeur, comme dans Chrome.
    var p = document.createElement("div");
    p.style.cssText = "position:absolute;left:-4px;top:0;bottom:0;width:9px;cursor:ew-resize;z-index:2;";
    var trait = document.createElement("div");
    trait.style.cssText = "position:absolute;left:3px;top:0;bottom:0;width:3px;border-radius:2px;background:transparent;transition:background-color .12s;";
    p.appendChild(trait);
    p.addEventListener("mouseenter", function () { trait.style.background = "rgba(217,119,87,.55)"; });
    p.addEventListener("mouseleave", function () { if (!p.tire) trait.style.background = "transparent"; });
    p.addEventListener("pointerdown", function (e) {
      e.preventDefault(); p.tire = true; p.setPointerCapture(e.pointerId);
      var voile = document.createElement("div");      // le cadre avalerait la souris pendant qu'on tire
      voile.style.cssText = "position:fixed;inset:0;cursor:ew-resize;z-index:3;";
      ombre.appendChild(voile);
      var image = 0;
      function bouge(ev) {
        var l = bornes(window.innerWidth - ev.clientX);
        if (l === LARGEUR || image) return;
        LARGEUR = l;
        image = requestAnimationFrame(function () { image = 0; placer(); remettreFixes(); ajusterFixes(); if (pilote) pilote.halo.style.right = LARGEUR + "px"; });
      }
      function fin() {
        p.tire = false; trait.style.background = "transparent"; voile.remove();
        p.removeEventListener("pointermove", bouge); p.removeEventListener("pointerup", fin); p.removeEventListener("pointercancel", fin);
        try { api.storage.local.set({ largeur: LARGEUR }); } catch (x) {}
        window.dispatchEvent(new Event("resize"));
      }
      p.addEventListener("pointermove", bouge); p.addEventListener("pointerup", fin); p.addEventListener("pointercancel", fin);
    });
    ombre.appendChild(p);
  }

  function montrer() {
    if (hote) return;
    hote = document.createElement("div");
    hote.id = "__cs_volet";
    hote.style.cssText = "all:initial;position:fixed;top:0;right:0;bottom:0;width:" + LARGEUR + "px;z-index:2147483646;";
    var ombre = hote.attachShadow({ mode: "closed" });
    var cadre = document.createElement("iframe");
    // Numéro à usage unique : déposé au fond de l'extension avant le chargement, le panneau le rend pour recevoir sa clé.
    var billet = "";
    try { var o = new Uint8Array(16); crypto.getRandomValues(o); billet = Array.prototype.map.call(o, function (x) { return ("0" + x.toString(16)).slice(-2); }).join(""); } catch (e) {}
    var adresseCadre = api.runtime.getURL("panneau.html") + "#onglet=" + encodeURIComponent(monOnglet || "") + "&n=" + billet;
    var pose = false;
    function poserCadre() { if (!pose) { pose = true; cadre.src = adresseCadre; } }
    try {
      var envoi = api.runtime.sendMessage({ claudeSafari: "billet", n: billet });
      if (envoi && typeof envoi.then === "function") envoi.then(poserCadre, poserCadre);
    } catch (e) {}
    setTimeout(poserCadre, 400);
    cadre.title = "Claude";
    cadre.setAttribute("allow", "clipboard-write; microphone");
    cadre.style.cssText = "width:100%;height:100%;border:0;border-left:1px solid rgba(0,0,0,.14);background:#fff;display:block;color-scheme:light dark;";
    ombre.appendChild(cadre);
    poignee(ombre);
    cadreActuel = cadre;
    cadre.addEventListener("load", passerCitation);
    (document.documentElement).appendChild(hote);
    // Posé dès le début du chargement : on le remet à la fin du document si la page réécrit sa racine.
    document.addEventListener("DOMContentLoaded", function () { if (hote && !hote.isConnected) document.documentElement.appendChild(hote); ajusterFixes(); });
    var racine = document.documentElement;
    margeAvant = { m: racine.style.getPropertyValue("margin-right"), mp: racine.style.getPropertyPriority("margin-right"),
      w: racine.style.getPropertyValue("width"), wp: racine.style.getPropertyPriority("width") };
    LARGEUR = bornes(LARGEUR);
    placer();
    ajusterFixes();
    setTimeout(ajusterFixes, 600); setTimeout(ajusterFixes, 2500);
    veille = new MutationObserver(plusTard);
    veille.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("resize", plusTard);
    window.addEventListener("scroll", plusTard, { passive: true });
    window.dispatchEvent(new Event("resize"));     // les pages qui calculent leur largeur se recalculent
  }
  function cacher() {
    if (!hote) return;
    hote.remove(); hote = null;
    if (veille) { veille.disconnect(); veille = null; }
    window.removeEventListener("resize", plusTard);
    window.removeEventListener("scroll", plusTard);
    clearTimeout(attente);
    var racine = document.documentElement;
    if (margeAvant.m) racine.style.setProperty("margin-right", margeAvant.m, margeAvant.mp); else racine.style.removeProperty("margin-right");
    if (margeAvant.w) racine.style.setProperty("width", margeAvant.w, margeAvant.wp); else racine.style.removeProperty("width");
    racine.removeAttribute("data-cs-volet");
    piloter(false);
    demarquer();
    remettreFixes();
    window.dispatchEvent(new Event("resize"));
  }
  function appliquer(ouvert) {
    document.documentElement.setAttribute("data-cs-ouvert", ouvert ? "1" : "0");
    try { if (ouvert) montrer(); else cacher(); }
    catch (e) { document.documentElement.setAttribute("data-cs-erreur", String(e && e.stack || e).slice(0, 300)); throw e; }
    try { api.runtime.sendMessage({ claudeSafari: "etat", ouvert: !!hote }); } catch (e) {}   // astre orange ou gris dans la barre
  }

  // --- Claude agit dans cet onglet : la page s'entoure d'un halo orange qui respire, le titre de l'onglet commence par
  // un rond orange (visible dans la barre d'onglets) et la barre de Safari prend la couleur orange quand elle affiche la
  // couleur des pages. Tout s'en va dès qu'il a fini. C'est le panneau de CET onglet qui dit s'il travaille.
  var ROND = "\uD83D\uDFE0 ", pilote = null;
  function signe() {
    if (!pilote) return;
    if (document.title.indexOf(ROND) !== 0) { pilote.titre = document.title; document.title = ROND + document.title; }
  }
  function piloter(oui) {
    if (oui && !pilote && hote) {
      pilote = { halo: document.createElement("div"), minuterie: setInterval(signe, 500) };
      var o = hote.shadowRoot || null;
      pilote.halo.style.cssText = "position:fixed;top:0;left:0;bottom:0;right:" + LARGEUR + "px;pointer-events:none;z-index:2147483645;" +
        "box-shadow:inset 0 0 0 2px rgba(217,119,87,.9),inset 0 0 36px 6px rgba(217,119,87,.45),inset 0 0 120px 12px rgba(217,119,87,.16);" +
        "border-radius:0 10px 10px 0;transition:opacity .25s;animation:__csaura 2.4s ease-in-out infinite;";
      var style = document.createElement("style");
      style.textContent = "@keyframes __csaura{50%{box-shadow:inset 0 0 0 2px rgba(217,119,87,1),inset 0 0 54px 10px rgba(217,119,87,.58),inset 0 0 150px 18px rgba(217,119,87,.24)}}" +
        "@media (prefers-reduced-motion: reduce){#__cs_halo{animation:none!important}}";
      pilote.halo.id = "__cs_halo"; pilote.style = style;
      document.documentElement.appendChild(style); document.documentElement.appendChild(pilote.halo);
      var m = document.createElement("meta"); m.name = "theme-color"; m.content = "#D97757"; m.setAttribute("data-cs-teinte", "1");
      pilote.metas = [];
      Array.prototype.forEach.call(document.querySelectorAll('meta[name="theme-color"]'), function (x) { pilote.metas.push(x); x.setAttribute("name", "cs-theme-avant"); });
      (document.head || document.documentElement).appendChild(m); pilote.meta = m;
      signe();
    } else if (!oui && pilote) {
      clearInterval(pilote.minuterie);
      pilote.halo.remove(); pilote.style.remove(); pilote.meta.remove();
      pilote.metas.forEach(function (x) { x.setAttribute("name", "theme-color"); });
      if (document.title.indexOf(ROND) === 0) document.title = document.title.slice(ROND.length);
      pilote = null;
    }
    if (pilote) pilote.halo.style.right = LARGEUR + "px";
  }

  // --- Un son joue dans cet onglet ? (vidéo, podcast) : on le dit au panneau, qui réveille l'oreille de Claude.
  // Rien ne joue : l'oreille se rendort et macOS n'affiche plus d'indicateur d'enregistrement.
  var joueAvant = false, dernierEnvoi = 0;
  setInterval(function () {
    if (!cadreActuel) return;
    var joue = false;
    try {
      var medias = document.querySelectorAll("video, audio");
      for (var i = 0; i < medias.length && !joue; i++) {
        var m = medias[i];
        if (!m.paused && !m.ended && !m.muted && m.volume > 0 && m.readyState > 2) joue = true;
      }
    } catch (e) {}
    if (joue !== joueAvant || (joue && Date.now() - dernierEnvoi > 5000)) {
      joueAvant = joue; dernierEnvoi = Date.now();
      try { cadreActuel.contentWindow.postMessage({ claudeSafari: "media", oui: joue }, "*"); } catch (e) {}
    }
  }, 1500);

  // La croix du panneau : le cadre nous demande de fermer. On n'écoute que notre propre cadre.
  var cadreActuel = null;
  window.addEventListener("message", function (e) {
    if (!hote || !cadreActuel || e.source !== cadreActuel.contentWindow) return;
    if (e.data && e.data.claudeSafari === "occupe") { piloter(!!e.data.oui); return; }
    if (e.data && e.data.claudeSafari === "fermer") {
      cacher();                                         // tout de suite, sans attendre le réglage
      demander({ claudeSafari: "fermer" });
    }
  });

  // --- Marque de l'onglet : quand Claude a travaillé dans cet onglet, son icône devient l'astre orange et son titre
  // commence par « ✳ », pour le repérer dans la barre d'onglets (Safari ne laisse pas colorer l'onglet lui-même).
  // La page de Claude pose data-cs-pilote ; la marque tient jusqu'à la fermeture du panneau, même après un changement de page.
  var marque = null, PREFIXE = "\u2733 ";
  function titre() { if (marque && document.title.indexOf(PREFIXE) !== 0) document.title = PREFIXE + document.title; }
  // Le panneau affiche le titre et l'adresse de cet onglet : on les donne au fond de l'extension, sans AppleScript.
  var infoAvant = "";
  function donnerInfo() {
    var t = document.title || "";
    if (t.indexOf(PREFIXE) === 0) t = t.slice(PREFIXE.length);
    if (t.indexOf(ROND) === 0) t = t.slice(ROND.length);
    var v = t + "\n" + location.href;
    if (v === infoAvant) return;
    infoAvant = v;
    try { api.runtime.sendMessage({ claudeSafari: "onglet-info", titre: t.slice(0, 300), url: location.href.slice(0, 2000) }); } catch (e) {}
  }
  setInterval(donnerInfo, 1500);
  function marquer() {
    if (marque || !hote) return;
    marque = { liens: [], minuterie: setInterval(titre, 800) };
    try { sessionStorage.setItem("__cs_marque", "1"); } catch (e) {}
    titre();
    var tete = document.head || document.documentElement;
    Array.prototype.forEach.call(document.querySelectorAll('link[rel~="icon"]'), function (l) { marque.liens.push([l, l.getAttribute("rel")]); l.setAttribute("rel", "cs-icone-avant"); });
    fetch(api.runtime.getURL("onglet.png")).then(function (r) { return r.blob(); }).then(function (b) {
      var lecteur = new FileReader();
      lecteur.onload = function () {
        if (!marque) return;
        var l = document.createElement("link"); l.rel = "icon"; l.type = "image/png"; l.href = lecteur.result; l.setAttribute("data-cs", "1");
        tete.appendChild(l); marque.lien = l;
      };
      lecteur.readAsDataURL(b);
    }).catch(function () {});
  }
  function demarquer() {
    try { sessionStorage.removeItem("__cs_marque"); } catch (e) {}
    if (!marque) return;
    clearInterval(marque.minuterie);
    if (marque.lien) marque.lien.remove();
    marque.liens.forEach(function (x) { x[0].setAttribute("rel", x[1]); });
    if (document.title.indexOf(PREFIXE) === 0) document.title = document.title.slice(PREFIXE.length);
    marque = null;
  }
  // Identité de l'onglet : le serveur de Claude la cherche pour agir dans le bon onglet.
  var monOnglet = "";
  try { monOnglet = sessionStorage.getItem("__cs_onglet") || ""; } catch (e) {}
  if (!monOnglet) { monOnglet = Date.now().toString(36) + Math.random().toString(36).slice(2, 8); try { sessionStorage.setItem("__cs_onglet", monOnglet); } catch (e) {} }
  document.documentElement.setAttribute("data-cs-onglet", monOnglet);

  // Raccourci de secours dans la page : ⌥⇧C ouvre ou ferme le panneau (si le bouton de la barre ne répond pas).
  window.addEventListener("keydown", function (e) {
    if (e.isTrusted && e.altKey && e.shiftKey && !e.metaKey && !e.ctrlKey && e.code === "KeyC") {
      e.preventDefault();
      demander({ claudeSafari: "basculer" });
    }
  }, true);

  function lire(defauts, fn) {
    var fini = false;
    function ok(r) { if (!fini) { fini = true; fn(r || defauts); } }
    try {
      var p = api.storage.local.get(defauts, ok);
      if (p && typeof p.then === "function") p.then(ok, function () { ok(defauts); });
    } catch (e) { ok(defauts); }
  }
  // Demande au fond de l'extension (qui connaît le numéro de l'onglet) ; applique la réponse. Safari rend une promesse,
  // d'autres navigateurs appellent une fonction : on accepte les deux, une seule fois. Erreur notée sur la page.
  function demander(message) {
    var fait = false;
    function ok(rep) {
      if (fait) return; fait = true;
      if (rep && rep.erreur) document.documentElement.setAttribute("data-cs-erreur", rep.erreur);
      if (rep && typeof rep.ouvert === "boolean") appliquer(rep.ouvert);
    }
    try {
      var p = api.runtime.sendMessage(message);
      if (p && typeof p.then === "function") p.then(ok, function (e) { document.documentElement.setAttribute("data-cs-erreur", "message : " + e); });
    } catch (e) { document.documentElement.setAttribute("data-cs-erreur", "envoi : " + e); }
  }
  // L'état ouvert/fermé est propre à CET onglet.
  lire({ largeur: 400 }, function (r) {
    LARGEUR = r.largeur || 400;
    demander({ claudeSafari: "suis-je-ouvert" });
  });
  api.runtime.onMessage.addListener(function (message) {
    if (message && message.claudeSafari === "ouvert") appliquer(!!message.oui);
    if (message && message.claudeSafari === "demander-claude") demanderClaude(choix().texte || message.texte || "", true);
  });

  // --- « Demander à Claude » sur un texte choisi : un petit bouton apparaît au bout de la sélection ; un clic ouvre le
  // panneau de cet onglet et y pose le passage, prêt pour la question. Rien n'est envoyé avant qu'la personne écrive.
  var citationEnAttente = null, bulle = null, bulleBouton = null;
  function choix() {
    var a = document.activeElement;
    if (a && (a.tagName === "TEXTAREA" || (a.tagName === "INPUT" && /^(text|search|url|email)?$/i.test(a.type || "")))) {
      try {
        var t = a.value.slice(a.selectionStart, a.selectionEnd).trim();
        if (t) return { texte: t, rect: a.getBoundingClientRect() };
      } catch (e) {}
    }
    if (a && a.type === "password") return { texte: "" };
    var s = window.getSelection && window.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) return { texte: "" };
    var texte = String(s).trim();
    if (!texte) return { texte: "" };
    var r = s.getRangeAt(s.rangeCount - 1), rects = r.getClientRects();
    return { texte: texte, rect: rects.length ? rects[rects.length - 1] : r.getBoundingClientRect() };
  }
  function creerBulle() {
    bulle = document.createElement("div");
    bulle.style.cssText = "all:initial;position:fixed;z-index:2147483647;left:0;top:0;display:none;";
    var ombre = bulle.attachShadow({ mode: "closed" });
    var style = document.createElement("style");
    style.textContent =
      "button{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:7px;height:32px;padding:0 12px 0 9px;border-radius:9px;" +
      "background:#fff;color:#1f1e1d;font:500 13px/1 -apple-system,BlinkMacSystemFont,sans-serif;cursor:pointer;white-space:nowrap;" +
      "box-shadow:0 0 0 1px rgba(0,0,0,.10),0 6px 20px rgba(0,0,0,.16);animation:v .14s cubic-bezier(.2,.8,.2,1);transition:background-color .12s,transform .08s}" +
      "button:hover{background:#f5f3ee}button:active{transform:scale(.96)}" +
      "img{width:16px;height:16px;display:block}" +
      "kbd{font:inherit;color:#8a877f;margin-left:4px;font-size:12px}" +
      "@keyframes v{from{opacity:0;transform:translateY(4px) scale(.97)}to{opacity:1;transform:none}}" +
      "@media (prefers-color-scheme:dark){button{background:#30302e;color:#f3f1ea;box-shadow:0 0 0 1px rgba(255,255,255,.12),0 6px 20px rgba(0,0,0,.4)}button:hover{background:#3a3a37}kbd{color:#9b988f}}" +
      "@media (prefers-reduced-motion:reduce){button{animation:none}}";
    bulleBouton = document.createElement("button");
    bulleBouton.type = "button";
    bulleBouton.setAttribute("aria-label", "Demander à Claude à propos du texte choisi");
    var img = document.createElement("img"); img.alt = ""; img.src = api.runtime.getURL("onglet.png");
    var mot = document.createElement("span"); mot.textContent = "Demander à Claude";
    bulleBouton.appendChild(img); bulleBouton.appendChild(mot);
    // Appuyer sur le bouton ne doit pas défaire la sélection de la page.
    bulleBouton.addEventListener("mousedown", function (e) { e.preventDefault(); e.stopPropagation(); });
    bulleBouton.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      var t = bulle.dataset.texte || choix().texte;
      cacherBulle();
      if (t) demanderClaude(t);
    });
    ombre.appendChild(style); ombre.appendChild(bulleBouton);
    document.documentElement.appendChild(bulle);
  }
  function cacherBulle() { if (bulle) { bulle.style.display = "none"; bulle.dataset.texte = ""; } }
  function montrerBulle() {
    var c = choix();
    if (!c.texte || c.texte.length < 2 || !c.rect) { cacherBulle(); return; }
    if (!bulle || !bulle.isConnected) creerBulle();
    bulle.dataset.texte = c.texte;
    bulle.style.display = "block";
    var l = bulle.offsetWidth || 170, h = bulle.offsetHeight || 32;
    var largeurPage = document.documentElement.clientWidth || window.innerWidth;
    var x = Math.max(8, Math.min(c.rect.right - l / 2, largeurPage - l - 8));
    var y = c.rect.bottom + 8;
    if (y + h > window.innerHeight - 8) y = Math.max(8, c.rect.top - h - 8);
    bulle.style.left = Math.round(x) + "px"; bulle.style.top = Math.round(y) + "px";
    // On rejoue l'apparition à chaque nouvelle sélection.
    bulleBouton.style.animation = "none"; void bulleBouton.offsetWidth; bulleBouton.style.animation = "";
  }
  document.addEventListener("mouseup", function (e) {
    if (e.button !== 0 || (bulle && e.composedPath && e.composedPath()[0] && bulle.contains(e.composedPath()[0]))) return;
    setTimeout(montrerBulle, 10);
  }, true);
  document.addEventListener("keyup", function (e) { if (e.shiftKey || e.key === "Shift" || ((e.metaKey || e.ctrlKey) && e.key === "a")) setTimeout(montrerBulle, 10); }, true);
  document.addEventListener("mousedown", function (e) { if (bulle && e.target !== bulle) cacherBulle(); }, true);
  document.addEventListener("selectionchange", function () { if (bulle && bulle.style.display !== "none" && !choix().texte) cacherBulle(); });
  window.addEventListener("scroll", cacherBulle, { passive: true, capture: true });
  window.addEventListener("keydown", function (e) { if (e.key === "Escape") cacherBulle(); }, true);

  // Le passage ne traverse pas la page : il va au fond de l'extension, où le panneau vient le chercher. Le signal
  // « relever » envoyé au cadre ne porte aucun texte, une page qui l'imiterait ne ferait rien passer.
  function demanderClaude(texte, dejaPose) {
    texte = String(texte || "").trim();
    if (!texte) return;
    var titrePage = document.title;
    if (titrePage.indexOf(PREFIXE) === 0) titrePage = titrePage.slice(PREFIXE.length);
    if (titrePage.indexOf(ROND) === 0) titrePage = titrePage.slice(ROND.length);
    function suite() {
      citationEnAttente = true;
      if (hote && cadreActuel) passerCitation();
      else demander({ claudeSafari: "ouvrir" });        // le panneau s'ouvre, puis relève le passage une fois chargé
    }
    var fait = false;
    function une() { if (!fait) { fait = true; suite(); } }
    try {
      var p = api.runtime.sendMessage({ claudeSafari: "citation-poser", texte: texte.slice(0, 8000), titre: titrePage, url: location.href });
      if (p && typeof p.then === "function") p.then(une, une); else une();
    } catch (e) { une(); }
    setTimeout(une, 300);
  }
  function passerCitation() {
    if (!citationEnAttente || !cadreActuel) return;
    try { cadreActuel.contentWindow.postMessage({ claudeSafari: "relever" }, "*"); citationEnAttente = null; } catch (e) {}
  }
})();
