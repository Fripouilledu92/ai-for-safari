(function () {
  "use strict";
  var BASE = window.CS_BASE || "";            // vide dans l'app ; adresse du programme local dans l'extension Safari
  var EXT = !!window.CS_EXTENSION;
  var ext = (typeof browser !== "undefined" && browser.runtime) ? browser : (typeof chrome !== "undefined" && chrome.runtime ? chrome : null);
  // Message au fond de l'extension ; Safari rend une promesse, d'autres appellent une fonction : on accepte les deux.
  function auFond(message) {
    return new Promise(function (ok) {
      var fait = false;
      function fin(r) { if (!fait) { fait = true; ok(r || {}); } }
      try {
        var p = ext.runtime.sendMessage(message);            // sans fonction de retour : Safari rend une promesse
        if (p && typeof p.then === "function") p.then(fin, function () { fin({}); });
      } catch (e) { fin({}); }
      setTimeout(fin, 4000);
    });
  }
  function avis(texte) {
    var a = document.getElementById("relier");
    if (!texte) { if (a) a.remove(); return; }
    if (!a) {
      a = document.createElement("div"); a.id = "relier";
      a.style.cssText = "position:fixed;inset:0;z-index:80;background:var(--fond);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:28px;text-align:center;font-size:15px;line-height:1.5;white-space:pre-line";
      document.body.appendChild(a);
    }
    a.textContent = texte;
  }
  if (!EXT) { demarrerPanneau(""); return; }
  // Dans l'extension : le panneau reçoit la clé de l'extension contre son numéro à usage unique, puis vérifie que le
  // programme local l'accepte. La première fois, macOS montre une fenêtre avec le même code que ci-dessous.
  var billet = (location.hash.match(/[#&]n=([0-9a-f]{16,64})/) || [])[1] || "";
  // Avant de montrer la clé à qui que ce soit, on vérifie que c'est bien l'app qui répond sur le port : elle prouve
  // qu'elle connaît le secret reçu le jour où l'extension a été reliée (HMAC d'un nombre tiré ici, lié au port).
  function hex(tampon) { return Array.prototype.map.call(new Uint8Array(tampon), function (x) { return ("0" + x.toString(16)).slice(-2); }).join(""); }
  function prouver(secret) {
    if (!secret) return Promise.resolve("premier");                 // pas encore reliée : rien à comparer
    var o = new Uint8Array(16); crypto.getRandomValues(o);
    var n = hex(o), port = (BASE.match(/:(\d+)$/) || [])[1] || "";
    return fetch(BASE + "/preuve?n=" + n).then(function (rep) { return rep.json(); }).then(function (d) {
      var enc = new TextEncoder();
      return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
        .then(function (k) { return crypto.subtle.sign("HMAC", k, enc.encode(n + ":" + port)); })
        .then(function (sig) { return hex(sig) === d.h ? "bon" : "faux"; });
    }, function () { return "eteint"; });
  }
  auFond({ claudeSafari: "cle", n: billet }).then(function (r) {
    var cleExt = r.cle || "";
    if (!cleExt) { avis("Ce panneau ne s'ouvre que depuis le bouton AI for Safari."); return; }
    (function verifier() {
      prouver(r.preuve || "").then(function (verdict) {
        if (verdict === "faux") {
          avis("Le programme qui répond sur ce Mac n'est pas l'app AI for Safari.\n\nRien ne lui est envoyé.\nRelance l'app AI for Safari, puis rouvre ce panneau.");
          setTimeout(verifier, 8000); return;
        }
        if (verdict === "eteint") { avis(""); demarrerPanneau(cleExt); return; }      // app éteinte : le panneau le dit lui-même
        return suite(verdict === "premier");
      });
    })();
    function suite(premier) {
      return fetch(BASE + "/compte?cle=" + encodeURIComponent(cleExt)).then(function (rep) {
        if (rep.status !== 403) {
          avis("");
          if (premier) fetch(BASE + "/secret?cle=" + encodeURIComponent(cleExt)).then(function (x) { return x.json(); })
            .then(function (d) { if (d.secret) auFond({ claudeSafari: "preuve-poser", s: d.secret, suite: r.suite }); }).catch(function () {});
          demarrerPanneau(cleExt); return;
        }
        return rep.json().then(function (d) {
          if (d.appairage === "attente") avis("Relier Safari à Claude\n\n" + d.code + "\n\nUne fenêtre vient de s'ouvrir sur ton Mac.\nSi elle montre ce même code, clique « Relier ».\nC'est demandé une seule fois.");
          else avis("Safari n'est pas relié à Claude.\n\nLa fenêtre a été refusée, ou personne n'a répondu.\nPour réessayer tout de suite : quitte puis rouvre l'app AI for Safari.");
          setTimeout(function () { suite(premier); }, d.appairage === "attente" ? 1500 : 8000);
        });
      }).catch(function () { avis(""); demarrerPanneau(cleExt); });
    }
  });

  function demarrerPanneau(cleExt) {
  var jeton = new URLSearchParams(location.search).get("jeton") || "";
  var api = (typeof browser !== "undefined" && browser.storage) ? browser : (typeof chrome !== "undefined" ? chrome : null);
  var ONGLET = (location.hash.match(/onglet=([A-Za-z0-9_-]{1,40})/) || [])[1] || "";
  function adresse(chemin, plus) { return BASE + chemin + "?jeton=" + encodeURIComponent(jeton) + "&onglet=" + ONGLET + (cleExt ? "&cle=" + encodeURIComponent(cleExt) : "") + (plus || ""); }
  function cle(nom) { return nom + (ONGLET ? "_" + ONGLET : ""); }
  var q = function (id) { return document.getElementById(id); };
  var vrai = q("fil"), fil = vrai, saisie = q("saisie"), envoi = q("envoi"), accueil = q("accueil");
  var occupe = false, bulle = null, brut = "", pense = null, outils = {}, images = [], vus = 0, groupe = null, rendu = 0;
  var NOMS = { "claude-fable-5-2": "Fable 5.2", "claude-opus-5-5": "Opus 5.5", "claude-sonnet-5-5": "Sonnet 5.5", "claude-haiku-5-5": "Haiku 5.5",
    "claude-fable-5-1": "Fable 5.1", "claude-fable-5": "Fable 5", "claude-opus-5": "Opus 5", "claude-opus-4-8": "Opus 4.8", "claude-opus-4-7": "Opus 4.7",
    "claude-opus-4-6": "Opus 4.6", "claude-sonnet-5": "Sonnet 5" };
  var EFFORTS = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra", max: "Max" };
  var modele = "claude-sonnet-5-5", effort = "low";
  function reglage(m, e) {
    if (NOMS[m]) modele = m; if (EFFORTS[e]) effort = e;
    q("modele").innerHTML = ""; q("modele").appendChild(document.createTextNode(NOMS[modele] + " "));
    var e2 = document.createElement("span"); e2.className = "effort"; e2.textContent = EFFORTS[effort]; q("modele").appendChild(e2);
    Array.prototype.forEach.call(q("menu").querySelectorAll("button"), function (b) {
      b.classList.toggle("choisi", b.dataset.modele === modele || b.dataset.effort === effort);
    });
  }

  function app(message) {
    if (EXT) {
      if (message.type === "fermer") {
        // Deux voies, parce que Safari ne donne pas toujours l'accès au réglage de l'extension à une page dans un cadre :
        // on prévient la page qui nous porte (c'est elle qui retire le panneau), et on essaie aussi directement.
        try { window.parent.postMessage({ claudeSafari: "fermer" }, "*"); } catch (e) {}

      }
      if (message.type === "ouvrir") window.open(message.url, "_blank", "noopener");
      return;
    }
    try { window.webkit.messageHandlers.cs.postMessage(message); } catch (e) {}
  }
  function appel(chemin, corps) {
    return fetch(adresse(chemin), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps || {}) })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.erreur || "Erreur"); return d; }); });
  }

  // --- rendu du texte de Claude (petit Markdown, tout est échappé d'abord)
  function echapper(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function enLigne(s) {
    return echapper(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }
  function rendre(texte) {
    var html = "", lignes = texte.split("\n"), i = 0;
    while (i < lignes.length) {
      var l = lignes[i];
      if (/^```/.test(l)) {
        var code = []; i++;
        while (i < lignes.length && !/^```/.test(lignes[i])) code.push(lignes[i++]);
        i++; html += "<pre><code>" + echapper(code.join("\n")) + "</code></pre>"; continue;
      }
      if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) {
        var ordonnee = /^\s*\d+[.)]\s+/.test(l), items = [];
        while (i < lignes.length && /^\s*([-*•]|\d+[.)])\s+/.test(lignes[i])) items.push("<li>" + enLigne(lignes[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, "")) + "</li>");
        html += (ordonnee ? "<ol>" : "<ul>") + items.join("") + (ordonnee ? "</ol>" : "</ul>"); continue;
      }
      if (/^#{1,6}\s+/.test(l)) { html += "<h3>" + enLigne(l.replace(/^#{1,6}\s+/, "")) + "</h3>"; i++; continue; }
      if (!l.trim()) { i++; continue; }
      var para = [];
      while (i < lignes.length && lignes[i].trim() && !/^```/.test(lignes[i]) && !/^\s*([-*•]|\d+[.)])\s+/.test(lignes[i]) && !/^#{1,6}\s+/.test(lignes[i])) para.push(enLigne(lignes[i++]));
      html += "<p>" + para.join("<br>") + "</p>";
    }
    return html;
  }

  // --- fil
  function enBas() { return vrai.scrollHeight - vrai.scrollTop - vrai.clientHeight < 80; }
  function descendre(force) { if (fil === vrai && (force || descendre.colle)) vrai.scrollTop = vrai.scrollHeight; }
  descendre.colle = true;
  vrai.addEventListener("scroll", function () { if (fil === vrai) descendre.colle = enBas(); }, { passive: true });
  function ajouter(el) {
    if (accueil.parentNode) { accueil.remove(); var sous = fil.querySelector(".sous"); if (sous) sous.remove(); }
    if (pense && pense.parentNode) fil.insertBefore(el, pense); else fil.appendChild(el);
    descendre();
    return el;
  }
  var COPIE = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><rect x="4.5" y="4.5" width="7.5" height="7.5" rx="1.6"/><path d="M9.5 4.5V3.2A1.2 1.2 0 0 0 8.3 2H3.2A1.2 1.2 0 0 0 2 3.2v5.1a1.2 1.2 0 0 0 1.2 1.2h1.3"/></svg>';
  function copiable(el, lire) {
    var b = document.createElement("button"); b.type = "button"; b.className = "copier"; b.innerHTML = COPIE;
    b.dataset.bulle = "Copier"; b.setAttribute("aria-label", "Copier ce message");
    b.onclick = function () {
      var t = lire();
      function ok() { b.classList.add("fait"); b.dataset.bulle = "Copié"; setTimeout(function () { b.classList.remove("fait"); b.dataset.bulle = "Copier"; }, 1200); }
      function secours() {
        var z = document.createElement("textarea"); z.value = t; z.style.cssText = "position:fixed;opacity:0"; document.body.appendChild(z); z.select();
        try { document.execCommand("copy"); ok(); } catch (e) {} z.remove();
      }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, secours); else secours();
    };
    el.appendChild(b);
    return el;
  }
  function bloc(classe, texte) { var d = document.createElement("div"); d.className = classe; if (texte != null) d.textContent = texte; return d; }
  function montrerPense(oui) {
    if (oui && !pense) {
      pense = document.createElement("span");
      pense.className = "astre pense"; pense.setAttribute("aria-hidden", "true");
      if (accueil.parentNode) accueil.remove();
      fil.appendChild(pense); descendre();
    } else if (!oui && pense) { pense.remove(); pense = null; }
  }
  var FLECHE = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14.5v-11M4.5 8L9 3.5 13.5 8"/></svg>';
  var CARRE = '<svg width="14" height="14" viewBox="0 0 14 14"><rect x="2" y="2" width="10" height="10" rx="2" fill="currentColor"/></svg>';
  var boutonActuel = "";
  var signale = null;
  function etat(travaille) {
    occupe = travaille;
    if (EXT && signale !== travaille && !document.body.classList.contains("rejoue")) {
      signale = travaille;
      try { window.parent.postMessage({ claudeSafari: "occupe", oui: travaille }, "*"); } catch (e) {}
    }
    montrerPense(travaille);
    var aEnvoyer = !!(saisie.value.trim() || images.length || citation);
    // Pendant que Claude travaille : s'il y a du texte, le bouton l'envoie (correction en route) ; sinon il arrête.
    var mode = travaille && !aEnvoyer ? "stop" : aEnvoyer ? "pret" : "";
    if (mode !== boutonActuel) {
      boutonActuel = mode;
      envoi.className = mode;
      envoi.dataset.bulle = mode === "stop" ? "Arrêter Claude" : travaille ? "Mettre en attente" : "Envoyer";
      envoi.setAttribute("aria-label", envoi.dataset.bulle);
      envoi.innerHTML = mode === "stop" ? CARRE : FLECHE;
    }
    saisie.placeholder = travaille ? "Écris ton prochain message (il attendra la fin)" : "Comment puis-je t'aider ?";
  }

  function sousTitre(t) {
    var ancien = fil.querySelector(".sous"); if (ancien) ancien.remove();
    if (!accueil.parentNode) return;
    var p = bloc("sous", t); fil.appendChild(p);
  }
  function peindre(el, texte) {
    el.brut = texte; el.innerHTML = rendre(texte);
    copiable(el, function () { return el.brut || ""; });
  }
  function finGroupe() { if (groupe) { groupe.classList.add("fini"); if (groupe.querySelector("li.rate")) groupe.classList.add("rate"); groupe = null; } }
  function recevoir(e) {
    vus = e.n || vus;
    switch (e.type) {
      case "vide":
        fil.innerHTML = ""; fil.appendChild(accueil); pense = null; bulle = null; outils = {}; groupe = null; descendre.colle = true; etat(false);
        reglage(e.modele, e.effort); if (e.options) montrerOptions(e.options); voirListe(false); sousTitre("Nouvelle discussion · " + NOMS[modele] + " " + EFFORTS[effort]); break;
      case "reglage": if (e.options) montrerOptions(e.options); reglage(e.modele, e.effort); if (accueil.parentNode) sousTitre(NOMS[modele] + " " + EFFORTS[effort]); break;
      case "pret": break;
      case "moi":
        var mienne = ajouter(bloc("moi", e.texte + (e.images ? "\n[" + e.images + " image" + (e.images > 1 ? "s" : "") + "]" : "")));
        (function (t) { copiable(mienne, function () { return t; }); })(e.texte);
        if (e.en_route) { var sm = document.createElement("small"); sm.textContent = "envoyé pendant que Claude travaille"; mienne.appendChild(sm); }
        finGroupe(); bulle = null; descendre.colle = true; etat(true); descendre(true); break;
      case "travaille": etat(true); break;
      case "texte_debut": finGroupe(); bulle = ajouter(bloc("claude")); brut = ""; break;
      case "texte":
        if (!bulle) { bulle = ajouter(bloc("claude")); brut = ""; }
        bulle.brut = brut + e.t;
        brut += e.t;
        // Un seul rendu par image affichée : le texte arrive par petits bouts, on ne redessine pas à chacun.
        if (!rendu) rendu = requestAnimationFrame(function () { rendu = 0; if (bulle) { peindre(bulle, brut); descendre(); } });
        break;
      case "outil":
        bulle = null;
        if (!groupe) {
          groupe = ajouter(document.createElement("details")); groupe.className = "etapes";
          groupe.innerHTML = '<summary><span class="rond"></span><span class="quoi"></span><span class="nb"></span></summary><ol></ol>';
        }
        if (!outils[e.id]) { outils[e.id] = document.createElement("li"); groupe.lastChild.appendChild(outils[e.id]); outils[e.id].groupe = groupe; }
        outils[e.id].textContent = e.texte;
        var g = outils[e.id].groupe, n = g.lastChild.children.length;
        g.classList.remove("fini");
        g.querySelector(".quoi").textContent = e.texte;
        g.querySelector(".nb").textContent = n > 1 ? n + " étapes" : "";
        descendre(); break;
      case "outil_fin":
        if (outils[e.id] && e.erreur) {
          outils[e.id].className = "rate";
          if (e.detail && e.detail.indexOf("[ACCORD_SAFARI]") >= 0) {
            outils[e.id].textContent += " : il manque un accord pour agir dans Safari.";
            if (!window.agirMontre) { window.agirMontre = true; window.montrerAgir(); }
          } else if (e.detail) outils[e.id].textContent += " : " + e.detail;
        } break;
      case "erreur": ajouter(bloc("note rouge", e.texte)); break;
      case "arrete": ajouter(bloc("note", "Arrêté.")); break;
      case "fin":
        if (rendu) { cancelAnimationFrame(rendu); rendu = 0; }
        if (bulle) peindre(bulle, brut);
        finGroupe(); bulle = null; etat(false); descendre(); setTimeout(videFile, 60); break;
    }
  }

  var rates = 0, avis = null;
  function hors(oui) {
    // Le programme local ne répond pas : on le dit clairement au lieu de laisser un panneau muet.
    if (!oui) { rates = 0; if (avis) { avis.remove(); avis = null; } return; }
    if (avis) return;
    basculer();
    avis = bloc("note rouge", "Claude n'est pas joignable. Ouvre l'app « AI for Safari » (elle fait le lien avec ton Claude), le panneau se reconnecte tout seul.");
    fil.appendChild(avis);
  }
  // Dans Safari le panneau se recharge à chaque changement de page. Pour que ça ne se voie pas : on montre tout de
  // suite la dernière image du fil (gardée sur ce Mac), et le vrai fil se reconstruit hors de la vue, puis prend sa place
  // d'un coup. Pas d'écran vide, pas d'astre qui tourne, pas de saut.
  var photo = null;
  try { photo = JSON.parse(localStorage.getItem(cle("cs_photo")) || "null"); } catch (e) {}
  if (photo && photo.html) {
    vrai.innerHTML = photo.html;
    Array.prototype.forEach.call(vrai.children, function (el) { el.classList.add("pose"); });
    accueil = vrai.querySelector("#accueil") || accueil;
    requestAnimationFrame(function () { vrai.scrollTop = photo.bas ? vrai.scrollHeight : photo.haut; });
  }
  fil = document.createElement("div");           // le fil se reconstruit ici, hors de la vue
  fil.className = "hors-vue";
  var accueilVrai = accueil; accueil = accueil.cloneNode(true); fil.appendChild(accueil);
  function basculer() {
    if (fil === vrai) return;
    var bas = photo ? photo.bas : true, haut = vrai.scrollTop;
    vrai.textContent = "";
    while (fil.firstChild) { var el = fil.firstChild; if (el.nodeType === 1) el.classList.add("pose"); vrai.appendChild(el); }
    fil = vrai;
    if (pense && !pense.isConnected) pense = null;
    vrai.scrollTop = bas ? vrai.scrollHeight : haut;
    descendre.colle = bas;
  }
  var photographe = 0;
  function photographier() {
    clearTimeout(photographe);
    photographe = setTimeout(function () {
      if (fil !== vrai) return;
      try { localStorage.setItem(cle("cs_photo"), JSON.stringify({ html: vrai.innerHTML.slice(-400000), bas: enBas(), haut: vrai.scrollTop })); } catch (e) {}
    }, 250);
  }
  new MutationObserver(photographier).observe(vrai, { childList: true, subtree: true, characterData: true });
  vrai.addEventListener("scroll", photographier, { passive: true });
  document.body.classList.add("rejoue");      // au chargement, l'historique s'affiche d'un coup, sans animation
  function brancher() {
    var flux = new EventSource(adresse("/flux", "&depuis=" + vus));
    flux.onopen = function () { hors(false); };
    flux.onmessage = function (m) {
      hors(false);
      try { recevoir(JSON.parse(m.data)); } catch (e) {}
      clearTimeout(brancher.calme);
      brancher.calme = setTimeout(function () { basculer(); document.body.classList.remove("rejoue"); signale = null; etat(occupe); videFile(); }, 120);
    };
    flux.onerror = function () { flux.close(); rates++; if (rates > 2) hors(true); setTimeout(brancher, 1500); };
  }

  // --- envoi
  // --- File d'attente, comme dans Claude Code : un message écrit pendant que Claude travaille attend la fin de son
  // tour. On peut l'envoyer tout de suite (Claude le reçoit en route), le modifier ou le retirer.
  var file = [];
  try { file = JSON.parse(localStorage.getItem(cle("cs_file")) || "[]"); } catch (e) { file = []; }
  function garderFile() { try { localStorage.setItem(cle("cs_file"), JSON.stringify(file)); } catch (e) {} }
  function dessinerFile() {
    var z = q("attente"); z.textContent = "";
    file.forEach(function (m, i) {
      var l = bloc("file"), t = document.createElement("span"), now = document.createElement("button"), x = document.createElement("button");
      t.className = "txt"; t.textContent = m.texte; t.dataset.bulle = "Cliquer pour modifier";
      t.onclick = function () { file.splice(i, 1); garderFile(); dessinerFile(); saisie.value = m.texte; hauteur(); saisie.focus(); };
      now.type = x.type = "button"; now.className = "maintenant"; now.textContent = "Envoyer maintenant";
      now.dataset.bulle = "Claude le reçoit tout de suite, en plein travail";
      now.onclick = function () { file.splice(i, 1); garderFile(); dessinerFile(); partir(m.texte, m.images || []); };
      x.className = "retirer"; x.textContent = "×"; x.dataset.bulle = "Retirer"; x.setAttribute("aria-label", "Retirer ce message");
      x.onclick = function () { file.splice(i, 1); garderFile(); dessinerFile(); };
      l.appendChild(t); l.appendChild(now); l.appendChild(x); z.appendChild(l);
    });
    descendre();
  }
  function videFile() {
    if (occupe || !file.length || document.body.classList.contains("rejoue")) return;
    var lot = file.splice(0, file.length); garderFile(); dessinerFile();
    partir(lot.map(function (m) { return m.texte; }).join("\n\n"), [].concat.apply([], lot.map(function (m) { return m.images || []; })));
  }
  function partir(texte, lot) {
    etat(true);
    lot = lot || [];
    appel("/message", { texte: texte, images: lot.filter(function (i) { return !i.pdf; }), documents: lot.filter(function (i) { return i.pdf; }).map(function (d) { return { nom: d.nom, data: d.data }; }) }).catch(function (err) { ajouter(bloc("note rouge", err.message)); saisie.value = texte; hauteur(); });
  }
  // --- passage choisi sur la page (« Demander à Claude ») : montré au-dessus de la saisie, joint à la question.
  var citation = null;
  try { citation = JSON.parse(localStorage.getItem(cle("cs_citation")) || "null"); } catch (e) {}
  function dessinerCitation() {
    var z = q("citation"), t = z.querySelector(".txt");
    z.hidden = !citation; t.textContent = "";
    try { if (citation) localStorage.setItem(cle("cs_citation"), JSON.stringify(citation)); else localStorage.removeItem(cle("cs_citation")); } catch (e) {}
    if (!citation) return;
    var d = document.createElement("small"); d.textContent = citation.titre ? "Passage de « " + citation.titre + " »" : "Passage de la page";
    t.appendChild(d); t.appendChild(document.createTextNode(citation.texte));
    t.title = citation.texte;
  }
  q("citation").querySelector("button").onclick = function () { citation = null; dessinerCitation(); saisie.focus(); };
  function avecCitation(texte) {
    if (!citation) return texte;
    var c = citation; citation = null; dessinerCitation();
    var cite = c.texte.split("\n").map(function (l) { return "> " + l; }).join("\n");
    return "Passage choisi sur la page" + (c.titre ? " « " + c.titre + " »" : "") + (c.url ? " (" + c.url + ")" : "") + " :\n" + cite + "\n\n" + (texte || "Explique-moi ce passage.");
  }
  // Le passage vient du fond de l'extension, jamais de la page : le signal « relever » ne porte aucun texte.
  function sansRetour(t) { return String(t || "").replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").trim(); }
  function relever() {
    if (!EXT || !ext) return;
    auFond({ claudeSafari: "citation-prendre" }).then(function (r) {
      var c = r.citation;
      if (!c || !c.texte) return;
      citation = { texte: String(c.texte).slice(0, 8000), titre: sansRetour(c.titre).slice(0, 200), url: /^https?:\/\//.test(c.url || "") ? sansRetour(c.url).slice(0, 500) : "" };
      dessinerCitation(); hauteur(); saisie.focus();
    });
  }
  window.addEventListener("message", function (e) {
    if (e.source === window.parent && e.data && e.data.claudeSafari === "relever") relever();
  });
  dessinerCitation(); relever();

  function envoyer() {
    var texte = saisie.value.trim();
    if (!texte && !images.length && !citation) { if (occupe) appel("/arreter"); return; }
    texte = avecCitation(texte);
    if (occupe) {
      file.push({ texte: texte, images: images.map(function (i) { return { type: i.type, data: i.data, nom: i.nom, pdf: i.pdf }; }) });
      garderFile(); dessinerFile();
      saisie.value = ""; images = []; q("vignettes").innerHTML = ""; brouillon(); hauteur();
      return;
    }
    var lot = images.map(function (i) { return { type: i.type, data: i.data, nom: i.nom, pdf: i.pdf }; });
    saisie.value = ""; images = []; q("vignettes").innerHTML = ""; brouillon(); hauteur();
    partir(texte, lot);
  }
  function hauteur() { saisie.style.height = "auto"; saisie.style.height = Math.min(180, saisie.scrollHeight) + "px"; etat(occupe); }
  // Le texte en cours de frappe est gardé : dans Safari, le panneau se recharge quand la page change.
  function brouillon() { try { if (saisie.value) localStorage.setItem(cle("cs_brouillon"), saisie.value); else localStorage.removeItem(cle("cs_brouillon")); } catch (e) {} }
  try { saisie.value = localStorage.getItem(cle("cs_brouillon")) || ""; } catch (e) {}
  q("formulaire").addEventListener("submit", function (e) { e.preventDefault(); envoyer(); });
  saisie.addEventListener("input", function () { hauteur(); brouillon(); });
  saisie.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (saisie.value.trim() || images.length || citation) envoyer(); }
  });

  // --- images jointes
  function joindre(fichiers) {
    Array.prototype.slice.call(fichiers, 0, 8 - images.length).forEach(function (f) {
      var pdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
      var image = /^image\/(png|jpeg|gif|webp)$/.test(f.type);
      if (!pdf && !image) {
        if (f.size > 400 * 1024) { ajouter(bloc("note rouge", f.name + " : fichier texte trop gros (400 Ko au plus).")); return; }
        f.text().then(function (t) {
          saisie.value = (saisie.value ? saisie.value.replace(/\s*$/, "\n\n") : "") + "Fichier « " + f.name + " » :\n```\n" + t + "\n```\n";
          hauteur(); brouillon();
        });
        return;
      }
      if (f.size > (pdf ? 20 : 5) * 1024 * 1024) { ajouter(bloc("note rouge", f.name + " : " + (pdf ? "PDF de 20 Mo" : "image de 5 Mo") + " au plus.")); return; }
      var lecteur = new FileReader();
      lecteur.onload = function () {
        var image = { type: pdf ? "application/pdf" : f.type, data: String(lecteur.result).split(",")[1], nom: f.name, pdf: pdf };
        images.push(image);
        var v = bloc("vignette"), img = document.createElement("img"), x = document.createElement("button");
        if (pdf) { img = document.createElement("span"); img.className = "doc"; img.textContent = "PDF"; img.title = f.name; }
        else { img.src = lecteur.result; img.alt = f.name; } x.type = "button"; x.textContent = "×"; x.setAttribute("aria-label", "Retirer " + f.name);
        x.onclick = function () { images.splice(images.indexOf(image), 1); v.remove(); hauteur(); };
        v.appendChild(img); v.appendChild(x); q("vignettes").appendChild(v); hauteur();
      };
      lecteur.readAsDataURL(f);
    });
  }
  q("joindre").onclick = function (e) {
    e.stopPropagation(); var m = q("menuplus"); m.hidden = !m.hidden; q("menu").hidden = true;
    q("joindre").setAttribute("aria-expanded", String(!m.hidden)); q("listeconnecteurs").hidden = true;
  };
  q("fichier").onchange = function (e) { joindre(e.target.files); e.target.value = ""; };
  saisie.addEventListener("paste", function (e) {
    var f = Array.prototype.filter.call(e.clipboardData.files || [], function (x) { return /^image\//.test(x.type); });
    if (f.length) { e.preventDefault(); joindre(f); }
  });

  // --- boutons
  q("fermer").onclick = function () { app({ type: "fermer" }); };
  q("place").onclick = function () { app({ type: "faire_place" }); };
  q("nouvelle").onclick = function () { appel("/nouvelle"); saisie.focus(); };
  q("modele").onclick = function () { var m = q("menu"); m.hidden = !m.hidden; q("modele").setAttribute("aria-expanded", String(!m.hidden)); };
  q("menu").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-modele], button[data-effort]"); if (!b) return;
    q("menu").hidden = true;
    appel("/modele", { modele: b.dataset.modele || modele, effort: b.dataset.effort || effort })
      .catch(function (err) { ajouter(bloc("note", err.message)); });
  });

  // --- historique
  function quand(t) {
    var d = new Date(t * 1000), auj = new Date();
    var heure = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    return d.toDateString() === auj.toDateString() ? "Aujourd'hui, " + heure : d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) + ", " + heure;
  }
  function jour(t) {
    var d = new Date(t * 1000), auj = new Date(), hier = new Date(Date.now() - 86400000);
    if (d.toDateString() === auj.toDateString()) return "Aujourd'hui";
    if (d.toDateString() === hier.toDateString()) return "Hier";
    if (Date.now() - d.getTime() < 7 * 86400000) return "Cette semaine";
    return "Plus ancien";
  }
  function voirListe(oui) {
    document.querySelector("main").classList.toggle("liste", oui);
    q("historique").classList.toggle("actif", oui);
    if (!oui) return;
    var h = q("histoire"); h.textContent = "";
    fetch(adresse("/historique")).then(function (r) { return r.json(); }).then(function (d) {
      var champ = document.createElement("input"); champ.id = "cherche"; champ.type = "search"; champ.placeholder = "Chercher dans tes discussions"; champ.setAttribute("aria-label", champ.placeholder);
      var zone = document.createElement("div");
      h.appendChild(champ); h.appendChild(zone);
      function dessiner() {
        var mot = champ.value.trim().toLowerCase(), groupeJour = "", n = 0;
        zone.textContent = "";
        d.discussions.forEach(function (x) {
          if (mot && (x.titre + " " + x.apercu).toLowerCase().indexOf(mot) < 0) return;
          n++;
          var j = jour(x.date);
          if (j !== groupeJour) { groupeJour = j; var t = document.createElement("h2"); t.textContent = j; zone.appendChild(t); }
          var l = bloc("ligne" + (x.ici ? " ici" : "")), o = document.createElement("button"), b = document.createElement("b"), ap = document.createElement("i"), sm = document.createElement("small"), ot = document.createElement("button");
          o.type = ot.type = "button"; b.textContent = x.titre; ap.textContent = x.apercu || "";
          sm.textContent = new Date(x.date * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) + (x.messages ? " · " + x.messages + " message" + (x.messages > 1 ? "s" : "") : "") + (x.ici ? " · en cours" : "");
          o.appendChild(b); if (x.apercu) o.appendChild(ap); o.appendChild(sm);
          o.onclick = function () { appel("/reprendre", { id: x.id }).catch(function (err) { zone.textContent = err.message; }); };
          ot.className = "oter"; ot.textContent = "×"; ot.dataset.bulle = "Supprimer"; ot.setAttribute("aria-label", "Supprimer « " + x.titre + " »");
          ot.onclick = function () { appel("/supprimer", { id: x.id }).then(function () { voirListe(true); }); };
          l.appendChild(o); l.appendChild(ot); zone.appendChild(l);
        });
        if (!n) { var v = document.createElement("h2"); v.textContent = mot ? "Rien trouvé pour « " + champ.value + " »." : "Aucune discussion pour l'instant."; zone.appendChild(v); }
      }
      champ.addEventListener("input", dessiner); dessiner(); champ.focus();
    }).catch(function () { h.textContent = "Historique illisible."; });
  }
  q("historique").onclick = function () { voirListe(!document.querySelector("main").classList.contains("liste")); };

  // --- oreille : Claude entend le son de Safari en continu (réponse immédiate)
  var oreilleToujours = true;
  function oreille() {
    fetch(adresse("/oreille")).then(function (r) { return r.json(); }).then(function (d) {
      var b = q("oreille") || document.createElement("i"), panne = d.erreur && d.active; oreilleToujours = d.toujours;
      b.className = "icone" + (panne ? " panne" : d.active ? " reveillee" : "");
      b.setAttribute("aria-pressed", String(d.toujours));
      b.dataset.bulle = panne ? "Claude n'entend pas le son : une autorisation manque" : d.active ? "Claude écoute : un son joue dans Safari. Clique pour couper l'écoute."
        : d.toujours ? "Écoute automatique : Claude écoute dès qu'une vidéo ou un son joue. Clique pour la couper."
        : "Écoute coupée. Clique pour que Claude écoute dès qu'un son joue.";
      var avis = q("avis");
      avis.classList.toggle("vu", !!panne);
      if (panne) {
        avis.firstChild.textContent = "Claude n'entend pas le son des pages. " + d.erreur;
        avis.dataset.volet = /reconnaissance vocale/i.test(d.erreur) ? "voix" : "son";
      }
    }).catch(function () {});
  }
  window.addEventListener("message", function (e) {
    if (e.source !== window.parent || !e.data || e.data.claudeSafari !== "media") return;
    appel("/media", { oui: !!e.data.oui }).then(function () { if (e.data.oui) setTimeout(oreille, 1500); }).catch(function () {});
  });

  q("avis").querySelector("button").onclick = function () { appel("/reglages", { volet: q("avis").dataset.volet }); };
  oreille(); setInterval(oreille, 4000);

  // --- écran de départ : compte Claude, accord, choix des sites
  function dessinerCompte(c) {
    var z = q("etatcompte"), t = z.querySelector("span"), b = q("connexion");
    z.classList.toggle("oui", !!c.connecte);
    if (!c.installe) { t.textContent = "Claude Code n'est pas installé sur ce Mac."; b.textContent = "Installer"; b.hidden = false; }
    else if (!c.connecte) { t.textContent = "Pas encore connecté à ton abonnement Claude."; b.textContent = "Se connecter"; b.hidden = false; }
    else { t.textContent = "Connecté" + (c.email ? " : " + c.email : "") + (c.abonnement ? " (" + c.abonnement + ")" : ""); b.hidden = true; }
    q("accord").disabled = !c.connecte;
    Array.prototype.forEach.call(document.getElementsByName("modesites"), function (r) { r.checked = r.value === c.sites; });
  }
  var veilleCompte = 0;
  function lireCompte(frais) {
    return fetch(adresse("/compte", frais ? "&frais=1" : "")).then(function (r) { return r.json(); });
  }
  function montrerDepart(c) {
    dessinerCompte(c); q("depart").hidden = false;
    lireAgir(false).catch(function () {});
    clearInterval(veilleCompte);
    // Pendant la connexion (elle se fait dans le Terminal et le navigateur), on regarde si elle a abouti.
    veilleCompte = setInterval(function () {
      if (q("depart").hidden) { clearInterval(veilleCompte); return; }
      if (!q("etatcompte").classList.contains("oui")) lireCompte(true).then(function (n) { var s = sitesChoisis(); n.sites = s; dessinerCompte(n); }).catch(function () {});
    }, 3000);
  }
  function sitesChoisis() {
    var v = "demander";
    Array.prototype.forEach.call(document.getElementsByName("modesites"), function (r) { if (r.checked) v = r.value; });
    return v;
  }
  q("connexion").onclick = function () { appel("/connexion").catch(function () {}); };
  q("accord").onclick = function () {
    appel("/accord", { accord: true, sites: sitesChoisis() }).then(function () { q("depart").hidden = true; saisie.focus(); })
      .catch(function (err) { ajouter(bloc("note rouge", err.message)); });
  };
  // --- les deux accords pour agir dans les pages (macOS « contrôler Safari » et le réglage de Safari)
  var veilleAgir = 0;
  function dessinerAgir(p) {
    var z = q("etatagir"), t = z.querySelector("span"), b = q("verifieragir");
    z.classList.toggle("oui", p.etat === "ok"); z.classList.toggle("non", p.etat === "reglage" || p.etat === "refuse");
    t.textContent = p.en_cours ? "Vérification… (réponds à la fenêtre de macOS si elle s'affiche)"
      : { ok: "C'est bon : Claude peut agir dans les pages.", reglage: "macOS a dit oui. Il reste le réglage de Safari (étapes ci-dessous).",
          refuse: "macOS a refusé. Rouvre l'accord dans Réglages Système > Confidentialité > Automatisation.", inconnu: "Pas encore vérifié." }[p.etat] || "Pas encore vérifié.";
    q("etapesreglage").hidden = p.etat !== "reglage";
    q("aviswindow").hidden = p.etat === "ok" || p.etat === "reglage";
    q("reglagesagir").hidden = p.etat !== "refuse";
    b.disabled = !!p.en_cours; b.textContent = p.etat === "ok" ? "Vérifier encore" : "Vérifier";
    if (!p.en_cours) clearInterval(veilleAgir);
  }
  function lireAgir(verifier) {
    return fetch(adresse("/pilotage", verifier ? "&verifier=1" : "")).then(function (r) { return r.json(); }).then(function (p) { dessinerAgir(p); return p; });
  }
  q("verifieragir").onclick = function () {
    lireAgir(true).then(function () {
      clearInterval(veilleAgir);
      veilleAgir = setInterval(function () { lireAgir(false).catch(function () {}); }, 1500);
    }).catch(function () {});
  };
  q("reglagesagir").onclick = function () { appel("/reglages", { volet: "safari" }).catch(function () {}); };
  window.montrerAgir = function () { lireCompte(true).then(montrerDepart).then(function () { q("agir").scrollIntoView({ block: "center" }); }).catch(function () {}); };
  q("ouvrirdepart").onclick = function () { q("menuplus").hidden = true; lireCompte(true).then(montrerDepart).catch(function () {}); };
  lireCompte(false).then(function (c) { if (!c.accord || !c.connecte) montrerDepart(c); }).catch(function () {});

  // --- options de la discussion (▷▷, recherche, mémoire, connecteurs)
  var options = { auto: true, recherche: false, memoire: true, connecteurs: [], dispo: [] };
  function montrerOptions(o) {
    if (o) options = o;
    q("recherche").classList.toggle("actif", !!options.recherche);
    q("memoire").classList.toggle("actif", !!options.memoire);
    var l = q("listeconnecteurs"); l.textContent = "";
    if (!options.dispo || !options.dispo.length) { var p = document.createElement("p"); p.textContent = "Aucun connecteur dans ta configuration Claude Code."; l.appendChild(p); }
    (options.dispo || []).forEach(function (nom) {
      var b = document.createElement("button"); b.type = "button"; b.className = "ligne-menu bascule" + (options.connecteurs.indexOf(nom) >= 0 ? " actif" : "");
      b.textContent = nom; var c = document.createElement("span"); c.className = "coche"; c.textContent = "✓"; b.appendChild(c);
      b.onclick = function (e) {
        e.stopPropagation();
        var liste = options.connecteurs.slice(), i = liste.indexOf(nom);
        if (i >= 0) liste.splice(i, 1); else liste.push(nom);
        changer({ connecteurs: liste });
      };
      l.appendChild(b);
    });
  }
  function changer(o) {
    for (var k in o) options[k] = o[k];
    montrerOptions();
    appel("/modele", { options: o }).catch(function (err) { ajouter(bloc("note", err.message)); });
  }
  q("recherche").onclick = function (e) { e.stopPropagation(); changer({ recherche: !options.recherche }); };
  q("memoire").onclick = function (e) { e.stopPropagation(); changer({ memoire: !options.memoire }); };
  q("connecteurs").onclick = function (e) { e.stopPropagation(); var l = q("listeconnecteurs"); l.hidden = !l.hidden; };
  q("ajouter").onclick = function () { q("menuplus").hidden = true; q("fichier").click(); };
  document.addEventListener("keydown", function (e) { if (e.metaKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "u") { e.preventDefault(); q("fichier").click(); } });

  // --- dictée comme dans Claude in Chrome : micro du Mac, texte en direct dans le champ, onde de points, ✕ / ✓
  var LANGUES = [["fr-FR", "Français"], ["en-US", "English (US)"], ["en-GB", "English (UK)"], ["es-ES", "Español"], ["de-DE", "Deutsch"], ["it-IT", "Italiano"], ["pt-PT", "Português"]];
  var prefs = { langue: "fr-FR", micro: "", maintenir: false };
  try { var pr = JSON.parse(localStorage.getItem("cs_dictee") || "{}"); for (var k in pr) prefs[k] = pr[k]; } catch (e) {}
  function garderPrefs() { try { localStorage.setItem("cs_dictee", JSON.stringify(prefs)); } catch (e) {} }
  var dicte = null, POINTS = 46;
  // L'onde avance doucement, comme dans l'app Claude : une barre toutes les 90 ms (et non une par mesure du micro,
  // qui en envoie cent par seconde), un glissement continu entre deux barres, et une hauteur lissée.
  var rail = document.createElement("span"); rail.className = "rail";
  (function () { for (var i = 0; i < POINTS; i++) rail.appendChild(document.createElement("i")); q("onde").appendChild(rail); })();
  var PAS = 90, PITCH = 6, ondeRecu = [], ondeLisse = 0, ondeDernier = 0;
  function onde(valeurs) {
    Array.prototype.push.apply(ondeRecu, valeurs);
    var maintenant = performance.now();
    if (maintenant - ondeDernier < PAS) return;
    ondeDernier = maintenant;
    var somme = 0, haut = 0;
    ondeRecu.forEach(function (v) { somme += v; if (v > haut) haut = v; });
    var v = ondeRecu.length ? (somme / ondeRecu.length) * 0.6 + haut * 0.4 : 0;
    ondeRecu = [];
    ondeLisse = v > ondeLisse ? ondeLisse + (v - ondeLisse) * 0.7 : ondeLisse + (v - ondeLisse) * 0.35;   // monte vite, retombe doucement
    var t = rail.firstChild; rail.appendChild(t);
    var h = ondeLisse < 0.08 ? 2 : Math.round(4 + Math.min(1, ondeLisse) * 22);
    t.style.height = h + "px"; t.classList.toggle("fort", h > 2);
    rail.style.transition = "none"; rail.style.transform = "translateX(" + PITCH + "px)";
    void rail.offsetWidth;
    rail.style.transition = "transform " + PAS + "ms linear"; rail.style.transform = "translateX(0)";
  }
  function montrerDictee(oui) {
    q("rangeedictee").hidden = !oui;
    document.querySelector(".rangee").hidden = oui;
    if (!oui) { ondeRecu = []; ondeLisse = 0; Array.prototype.forEach.call(rail.children, function (t) { t.style.height = "2px"; t.classList.remove("fort"); }); }
  }
  function finDictee(garder) {
    if (!dicte) return;
    var d = dicte; dicte = null;
    try { d.flux.close(); } catch (e) {}
    if (!garder) saisie.value = d.avant.replace(/\s+$/, "");
    montrerDictee(false); q("micro").classList.remove("ecoute");
    saisie.focus(); hauteur(); brouillon();
  }
  function arreterDictee(garder) {
    if (!dicte) return;
    dicte.garder = garder;
    appel("/micro", { action: "stop" }).catch(function () {});
    setTimeout(function () { finDictee(garder); }, garder ? 1800 : 0);   // on laisse au texte final le temps d'arriver
  }
  function lancerDictee() {
    if (dicte) return;
    var avant = saisie.value ? saisie.value.replace(/\s*$/, " ") : "";
    dicte = { flux: new EventSource(adresse("/dictee")), avant: avant, garder: true };
    montrerDictee(true); q("micro").classList.add("ecoute");
    var d = dicte;
    d.flux.onmessage = function (m) {
      var e; try { e = JSON.parse(m.data); } catch (x) { return; }
      if (dicte !== d) return;
      if (e.type === "niveau") onde(e.v || []);
      else if (e.type === "texte") { if (d.garder) { saisie.value = d.avant + (e.t || ""); hauteur(); saisie.scrollTop = saisie.scrollHeight; } }
      else if (e.type === "erreur") { ajouter(bloc("note rouge", e.message || "La dictée n'a pas pu démarrer.")); finDictee(true); }
      else if (e.type === "fin") finDictee(d.garder);
    };
    d.flux.onopen = function () {
      appel("/micro", { action: "start", langue: prefs.langue, micro: prefs.micro }).catch(function (err) { ajouter(bloc("note rouge", err.message)); finDictee(true); });
    };
  }
  q("micro").hidden = false;
  q("micro").onclick = function () { if (prefs.maintenir) return; if (dicte) arreterDictee(true); else lancerDictee(); };
  q("micro").addEventListener("pointerdown", function (e) { if (!prefs.maintenir) return; e.preventDefault(); lancerDictee(); });
  ["pointerup", "pointerleave", "pointercancel"].forEach(function (t) {
    q("micro").addEventListener(t, function () { if (prefs.maintenir && dicte) arreterDictee(true); });
  });
  q("dicteevalider").onclick = function () { arreterDictee(true); };
  q("dicteeannuler").onclick = function () { arreterDictee(false); };
  document.addEventListener("keydown", function (e) {
    if (!dicte) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); arreterDictee(false); }
    else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); arreterDictee(true); }
  }, true);

  // Menu à côté du micro : quel micro, quelle langue, maintenir pour enregistrer
  function dessinerMenuMicro() {
    var nom = LANGUES.filter(function (l) { return l[0] === prefs.langue; })[0];
    q("languenom").textContent = nom ? nom[1] : prefs.langue;
    q("maintenir").classList.toggle("actif", !!prefs.maintenir);
    var l = q("listelangues"); l.textContent = "";
    LANGUES.forEach(function (x) {
      var b = document.createElement("button"); b.type = "button"; b.className = "ligne-menu" + (x[0] === prefs.langue ? " choisi" : ""); b.textContent = x[1];
      b.onclick = function (e) { e.stopPropagation(); prefs.langue = x[0]; garderPrefs(); l.hidden = true; dessinerMenuMicro(); };
      l.appendChild(b);
    });
    var m = q("listemicros"); m.textContent = "";
    var p = document.createElement("p"); p.textContent = "Recherche des micros…"; m.appendChild(p);
    fetch(adresse("/micros")).then(function (r) { return r.json(); }).then(function (d) {
      m.textContent = "";
      var liste = d.micros || [];
      if (!liste.length) { var v = document.createElement("p"); v.textContent = "Micro par défaut du Mac"; m.appendChild(v); return; }
      liste.forEach(function (x) {
        var b = document.createElement("button"); b.type = "button";
        var choisi = prefs.micro ? prefs.micro === x.uid : x.defaut;
        b.className = "ligne-menu" + (choisi ? " choisi" : "");
        b.textContent = (x.defaut ? "Par défaut - " : "") + x.nom;
        b.onclick = function (e) { e.stopPropagation(); prefs.micro = x.defaut ? "" : x.uid; garderPrefs(); dessinerMenuMicro(); };
        m.appendChild(b);
      });
    }).catch(function () { m.textContent = ""; });
  }
  q("microchoix").onclick = function (e) {
    e.stopPropagation(); var menu = q("menumicro"); menu.hidden = !menu.hidden;
    q("menu").hidden = true; q("menuplus").hidden = true;
    q("microchoix").setAttribute("aria-expanded", String(!menu.hidden));
    if (!menu.hidden) dessinerMenuMicro();
  };
  q("langue").onclick = function (e) { e.stopPropagation(); var l = q("listelangues"); l.hidden = !l.hidden; };
  q("maintenir").onclick = function (e) { e.stopPropagation(); prefs.maintenir = !prefs.maintenir; garderPrefs(); dessinerMenuMicro(); };
  document.addEventListener("click", function (e) { if (!e.target.closest(".micro-groupe")) q("menumicro").hidden = true; });

  // --- ancienne dictée du navigateur (plus utilisée)
  var Dictee = null, ecoute = null;
  if (Dictee) {
    q("micro").hidden = false;
    q("micro").onclick = function () {
      if (ecoute) { ecoute.stop(); return; }
      var avant = saisie.value ? saisie.value.replace(/\s*$/, " ") : "";
      ecoute = new Dictee(); ecoute.lang = "fr-FR"; ecoute.interimResults = true; ecoute.continuous = true;
      ecoute.onresult = function (e) {
        var dit = ""; for (var i = 0; i < e.results.length; i++) dit += e.results[i][0].transcript;
        saisie.value = avant + dit; hauteur();
      };
      ecoute.onerror = function (e) {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") ajouter(bloc("note rouge", "Safari n'a pas le droit d'utiliser le micro ici. Autorise le micro pour ce site (Safari > Réglages > Sites web > Microphone), ou utilise la dictée du clavier."));
      };
      ecoute.onend = function () { ecoute = null; q("micro").classList.remove("ecoute"); saisie.focus(); };
      try { ecoute.start(); q("micro").classList.add("ecoute"); } catch (err) { ecoute = null; }
    };
  }
  document.addEventListener("click", function (e) {
    if (!e.target.closest(".modele")) q("menu").hidden = true;
    if (!e.target.closest(".plus")) q("menuplus").hidden = true;
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") { q("menu").hidden = true; if (occupe) appel("/arreter"); } });
  vrai.addEventListener("click", function (e) { var a = e.target.closest("a[href]"); if (a) { e.preventDefault(); app({ type: "ouvrir", url: a.href }); } });

  // --- onglet regardé
  function onglet() {
    (EXT && ext ? auFond({ claudeSafari: "onglet-info-lire" }) : fetch(adresse("/onglet")).then(function (r) { return r.json(); })).then(function (d) {
      var el = q("onglet"), hote = ""; try { hote = new URL(d.url).hostname; } catch (e) {}
      el.textContent = ""; el.title = d.url || "";
      if (!d.titre && !hote) { el.textContent = "Aucun onglet Safari"; return; }
      var b = document.createElement("b"); b.textContent = d.titre || hote;
      el.appendChild(b); if (hote && d.titre) el.appendChild(document.createTextNode(" · " + hote));
    }).catch(function () {});
  }
  if (EXT) q("place").style.display = "none";
  onglet(); setInterval(onglet, 2500);
  fetch(adresse("/historique")).then(function (r) { return r.json(); }).then(function (d) { reglage(d.modele, d.effort); if (d.options) montrerOptions(d.options); }).catch(function () {});
  Array.prototype.forEach.call(document.querySelectorAll("button[title]"), function (b) { b.dataset.bulle = b.title; b.removeAttribute("title"); });
  dessinerFile();
  reglage(); brancher(); etat(false); hauteur(); saisie.focus();
  }
})();
