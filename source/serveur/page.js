// Bibliothèque de « AI for Safari » qui tourne DANS la page.
// Le serveur l'injecte une fois par document, puis appelle window.__cs.appel(op, args), qui renvoie du JSON.
// Tout est synchrone : « do JavaScript » de Safari ne sait pas attendre une promesse.
(function () {
  "use strict";
  var VERSION = 5;
  if (window.__cs && window.__cs.version === VERSION) return;

  var cs = { version: VERSION, arrete: false, survole: null, tampons: {}, promesses: {}, voyantCache: false };
  try { Object.defineProperty(window, "__cs", { value: cs, enumerable: false, configurable: true }); }
  catch (e) { window.__cs = cs; }
  try { if (sessionStorage.getItem("__cs_arrete") === "1") cs.arrete = true; } catch (e) {}

  function Refus(code, message) { this.code = code; this.message = message; }

  // Heure du dernier changement de la page : le serveur attend qu'elle se calme après un clic, puis renvoie son
  // nouvel état. Claude n'a plus besoin d'attendre ni de relire la page lui-même.
  cs.mutT = Date.now();
  try {
    new MutationObserver(function () { cs.mutT = Date.now(); }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  } catch (e) {}

  // ------------------------------------------------------------------ références
  var REF = { n: 0, parRef: new Map(), parEl: new WeakMap() };
  function refDe(el) {
    var r = REF.parEl.get(el);
    if (!r) { r = "ref_" + (++REF.n); REF.parEl.set(el, r); REF.parRef.set(r, new WeakRef(el)); }
    return r;
  }
  function elDe(ref) {
    var w = REF.parRef.get(String(ref));
    var el = w && w.deref();
    if (!el || !el.isConnected) throw new Refus("REF_INCONNUE", "Référence " + ref + " introuvable (la page a changé ?). Relis la page avec read_page ou find.");
    return el;
  }

  // ------------------------------------------------------------------ rôle, nom, visibilité
  var ROLES = { a: "link", button: "button", select: "combobox", textarea: "textbox", h1: "heading", h2: "heading", h3: "heading",
    h4: "heading", h5: "heading", h6: "heading", img: "image", nav: "navigation", main: "main", header: "banner", footer: "contentinfo",
    section: "region", article: "article", aside: "complementary", form: "form", table: "table", ul: "list", ol: "list", li: "listitem",
    label: "label", iframe: "iframe", summary: "button", dialog: "dialog", option: "option", video: "video", audio: "audio",
    tr: "row", td: "cell", th: "columnheader", p: "paragraph", svg: "image", details: "group", fieldset: "group", progress: "progressbar" };
  var TYPES_INPUT = { button: "button", submit: "button", reset: "button", image: "button", file: "button", checkbox: "checkbox",
    radio: "radio", range: "slider", search: "searchbox", number: "spinbutton", hidden: "hidden" };
  var IGNORES = { script: 1, style: 1, meta: 1, link: 1, noscript: 1, template: 1, head: 1, title: 1, base: 1, br: 1, wbr: 1 };

  function tag(el) { return el.tagName ? el.tagName.toLowerCase() : ""; }
  function role(el) {
    var r = el.getAttribute("role");
    if (r) return r.trim().split(/\s+/)[0];
    var t = tag(el);
    if (t === "input") return TYPES_INPUT[(el.getAttribute("type") || "text").toLowerCase()] || "textbox";
    if (t === "a") return el.hasAttribute("href") ? "link" : "generic";
    if (el.isContentEditable && (!el.parentElement || !el.parentElement.isContentEditable)) return "textbox";
    return ROLES[t] || "generic";
  }
  function propre(s, max) {
    s = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
  }
  function texteDirect(el) {
    var s = "";
    for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) s += n.nodeValue;
    return propre(s, 200);
  }
  function nom(el) {
    var t = tag(el), v;
    v = el.getAttribute("aria-labelledby");
    if (v) {
      var morceaux = v.split(/\s+/).map(function (id) { var e = el.ownerDocument.getElementById(id); return e ? e.textContent : ""; });
      if (propre(morceaux.join(" "), 100)) return propre(morceaux.join(" "), 100);
    }
    v = el.getAttribute("aria-label"); if (v && v.trim()) return propre(v, 100);
    if (t === "select") { var o = el.options && el.options[el.selectedIndex]; var et = etiquette(el); return propre((et ? et + " : " : "") + (o ? o.textContent : ""), 100); }
    if (t === "input" || t === "textarea") {
      var type = (el.getAttribute("type") || "").toLowerCase();
      if (type === "submit" || type === "button" || type === "reset") return propre(el.value || type, 100);
      var e2 = etiquette(el); if (e2) return e2;
      v = el.getAttribute("placeholder"); if (v) return propre(v, 100);
      v = el.getAttribute("title"); if (v) return propre(v, 100);
      v = el.getAttribute("name"); if (v) return propre(v, 100);
      return "";
    }
    v = el.getAttribute("alt"); if (v && v.trim()) return propre(v, 100);
    if (t === "a" || t === "button" || t === "summary" || t === "label" || t === "option" || t === "li" || t === "th" || t === "td" ||
        /^h[1-6]$/.test(t) || el.getAttribute("role")) {
      var txt = propre(el.textContent, 100); if (txt) return txt;
    }
    v = el.getAttribute("title"); if (v && v.trim()) return propre(v, 100);
    if (t === "iframe") return propre(el.getAttribute("src") || "", 100);
    return texteDirect(el).slice(0, 100);
  }
  function etiquette(el) {
    try { if (el.labels && el.labels.length) return propre(el.labels[0].textContent, 100); } catch (e) {}
    return "";
  }
  function visible(el) {
    if (!el.getClientRects().length && tag(el) !== "option") return false;
    var st = getComputedStyle(el);
    return st.visibility !== "hidden" && st.visibility !== "collapse" && st.display !== "none" && parseFloat(st.opacity || "1") > 0.01;
  }
  function dansLaVue(el) {
    var r = el.getBoundingClientRect();
    return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && r.width > 0 && r.height > 0;
  }
  var FOCALISABLES = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex], [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';
  var ROLES_ACTIFS = { button: 1, link: 1, checkbox: 1, radio: 1, tab: 1, menuitem: 1, menuitemcheckbox: 1, menuitemradio: 1, option: 1,
    switch: 1, textbox: 1, combobox: 1, searchbox: 1, slider: 1, spinbutton: 1, treeitem: 1, listbox: 1 };
  function interactif(el) {
    var t = tag(el);
    if (t === "a") return el.hasAttribute("href");
    if (t === "input") return (el.getAttribute("type") || "").toLowerCase() !== "hidden";
    if (t === "button" || t === "select" || t === "textarea" || t === "summary" || t === "video" || t === "audio") return true;
    if (el.isContentEditable && (!el.parentElement || !el.parentElement.isContentEditable)) return true;
    var r = el.getAttribute("role"); if (r && ROLES_ACTIFS[r.trim().split(/\s+/)[0]]) return true;
    if (el.hasAttribute("onclick")) return true;
    var ti = el.getAttribute("tabindex"); if (ti !== null && ti !== "-1") return true;
    return false;
  }
  function decrire(el) {
    var r = role(el), n = nom(el);
    return r + (n ? ' "' + n + '"' : "") + " [" + refDe(el) + "]";
  }
  function centre(el) {
    var r = el.getBoundingClientRect();
    return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)];
  }

  // ------------------------------------------------------------------ garde-fous dans la page
  var MOTIF_SENSIBLE = /(card.?num|cardnumber|cc.?num|ccnum|\bcvv\b|\bcvc\b|\bcsc\b|\biban\b|\bbic\b|swift|num[eé]ro.?de.?carte|code.?secret|cryptogramme|\bssn\b|social.?security|passport|passeport|s[eé]curit[eé].?sociale|routing.?num|account.?num|num[eé]ro.?de.?compte|mot.?de.?passe|motdepasse|password|passwd|\bpin\b|code.?pin|one.?time|\botp\b|code.?de.?v[eé]rification|verification.?code)/i;
  function sensible(el) {
    if (!el || el.nodeType !== 1) return null;
    var t = tag(el);
    if (t !== "input" && t !== "textarea" && !el.isContentEditable) return null;
    var type = (el.getAttribute("type") || "").toLowerCase();
    if (type === "password") return "c'est un champ de mot de passe";
    var ac = (el.getAttribute("autocomplete") || "").toLowerCase();
    if (/(^|\s)(current-password|new-password|one-time-code|cc-[a-z-]+)(\s|$)/.test(ac)) return "c'est un champ de mot de passe, de code ou de carte bancaire (" + ac + ")";
    var indices = [el.getAttribute("name"), el.id, el.getAttribute("placeholder"), el.getAttribute("aria-label"), etiquette(el)].join(" ");
    if (MOTIF_SENSIBLE.test(indices)) return "ce champ ressemble à un mot de passe, un code ou une donnée bancaire";
    return null;
  }
  function luhn(chiffres) {
    var s = 0, pair = false;
    for (var i = chiffres.length - 1; i >= 0; i--) {
      var c = chiffres.charCodeAt(i) - 48;
      if (pair) { c *= 2; if (c > 9) c -= 9; }
      s += c; pair = !pair;
    }
    return s % 10 === 0;
  }
  function texteSensible(txt) {
    var groupes = String(txt).match(/(?:\d[ -]?){13,19}/g) || [];
    for (var i = 0; i < groupes.length; i++) {
      var ch = groupes[i].replace(/\D/g, "");
      if (ch.length >= 13 && ch.length <= 19 && luhn(ch)) return "ce texte ressemble à un numéro de carte bancaire";
    }
    if (/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b/.test(String(txt)) && String(txt).replace(/\s/g, "").length >= 18) return "ce texte ressemble à un IBAN";
    return null;
  }
  function refuserSiSensible(el, txt) {
    var raison = sensible(el) || (txt != null ? texteSensible(txt) : null);
    if (raison) throw new Refus("SENSIBLE", "Refusé : " + raison + ". Claude ne saisit jamais de mot de passe, de code ni de donnée bancaire. C'est à la personne de le taper lui-même dans l'onglet.");
  }
  var SEL_CAPTCHA = 'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"], iframe[src*="arkoselabs"], iframe[src*="funcaptcha"], iframe[src*="captcha"], iframe[title*="captcha" i], .g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey], [id*="captcha" i], [class*="captcha" i]';
  function captcha(el) {
    try { return !!(el && el.closest && el.closest(SEL_CAPTCHA)); } catch (e) { return false; }
  }
  function refuserSiCaptcha(el) {
    if (captcha(el)) throw new Refus("ANTI_ROBOT", "Refusé : c'est une protection anti-robots (captcha). Claude ne la passe pas et ne la contourne pas. Demande à la personne de la passer lui-même dans l'onglet, ou utilise une autre source.");
  }
  function pageACaptcha() {
    try { return !!document.querySelector(SEL_CAPTCHA); } catch (e) { return false; }
  }

  // ------------------------------------------------------------------ arbre d'accessibilité (read_page)
  var LANDMARKS = { navigation: 1, main: 1, banner: 1, contentinfo: 1, region: 1, article: 1, complementary: 1, form: 1, dialog: 1, search: 1 };
  function garder(el, filtre) {
    var t = tag(el);
    if (IGNORES[t]) return false;
    if (el.id === "__cs_voyant") return false;
    if (filtre === "interactive") return interactif(el) && visible(el);
    if (interactif(el)) return true;
    var r = role(el);
    if (LANDMARKS[r]) return true;
    if (r !== "generic" && r !== "paragraph" && r !== "group" && r !== "hidden") return true;
    return texteDirect(el).length > 0;
  }
  function ligne(el, profondeur) {
    var t = tag(el), r = role(el), n = nom(el), s = new Array(profondeur + 1).join(" ") + r;
    if (n) s += ' "' + n.replace(/"/g, '\\"') + '"';
    s += " [" + refDe(el) + "]";
    var v;
    if ((v = el.getAttribute("href"))) s += ' href="' + propre(v, 200) + '"';
    if ((v = el.getAttribute("type")) && t !== "button") s += ' type="' + v + '"';
    if ((v = el.getAttribute("placeholder"))) s += ' placeholder="' + propre(v, 80) + '"';
    if (t === "input" || t === "textarea") {
      var type = (el.getAttribute("type") || "").toLowerCase();
      if (type === "checkbox" || type === "radio") s += el.checked ? " checked" : "";
      else if (type === "password") s += el.value ? ' value="•••"' : "";
      else if (type !== "file" && el.value && !sensible(el)) s += ' value="' + propre(el.value, 80).replace(/"/g, '\\"') + '"';
    }
    if (t === "select") s += ' options="' + propre(Array.prototype.map.call(el.options, function (o) { return o.textContent.trim(); }).join(" | "), 200) + '"';
    if (el.disabled) s += " disabled";
    if ((v = el.getAttribute("aria-expanded"))) s += ' expanded="' + v + '"';
    if ((v = el.getAttribute("aria-selected")) === "true") s += " selected";
    if (el.getAttribute("aria-checked") === "true") s += " checked";
    if (/^h[1-6]$/.test(t)) s += " level=" + t.charAt(1);
    if (captcha(el)) s += " (protection anti-robots : ne pas y toucher)";
    return s;
  }
  function arbre(args) {
    var filtre = args.filter === "interactive" ? "interactive" : "all";
    var profondeurMax = args.depth > 0 ? args.depth : 15;
    var max = args.max_chars > 0 ? args.max_chars : 50000;
    var racine = args.ref_id ? elDe(args.ref_id) : document.body || document.documentElement;
    var lignes = [], taille = 0, coupe = false, total = 0;
    function visiter(el, prof) {
      if (el.nodeType !== 1) return;
      var t = tag(el);
      if (IGNORES[t] || el.id === "__cs_voyant") return;
      if (filtre === "interactive" && !visible(el) && t !== "option" && getComputedStyle(el).display === "none") return;
      var inclus = garder(el, filtre), suite = prof;
      if (inclus) {
        var l = ligne(el, prof);
        total += l.length + 1;
        if (!coupe) { if (taille + l.length + 1 > max) coupe = true; else { lignes.push(l); taille += l.length + 1; } }
        suite = prof + 1;
      }
      if (suite > profondeurMax) return;
      if (t === "select") return;
      var enfants = el.shadowRoot ? el.shadowRoot.children : el.children;
      for (var i = 0; i < enfants.length; i++) visiter(enfants[i], suite);
      if (el.shadowRoot && el.children.length) for (var j = 0; j < el.children.length; j++) visiter(el.children[j], suite);
      if (t === "iframe") {
        var d = null; try { d = el.contentDocument; } catch (e) {}
        if (d && d.body) visiter(d.body, suite);
      }
    }
    visiter(racine, 0);
    var texte = lignes.join("\n");
    if (!lignes.length) texte = filtre === "interactive" ? "(aucun élément interactif visible)" : "(page vide)";
    if (coupe) texte += "\n[Sortie coupée à " + max + " caractères sur " + total + ". Passe un max_chars plus grand, ou depth / ref_id pour viser une partie de la page.]";
    return { texte: texte, url: location.href, titre: document.title, vue: innerWidth + "x" + innerHeight, captcha: pageACaptcha() };
  }

  // ------------------------------------------------------------------ find
  var MOTS_VIDES = { the: 1, a: 1, an: 1, le: 1, la: 1, les: 1, un: 1, une: 1, de: 1, du: 1, des: 1, "for": 1, to: 1, of: 1, "in": 1, on: 1,
    "with": 1, containing: 1, contenant: 1, qui: 1, avec: 1, pour: 1, dans: 1, element: 1, "élément": 1, that: 1, says: 1, and: 1, et: 1, au: 1, aux: 1, sur: 1 };
  var SYNONYMES = {
    button: ["button", "bouton", "btn", "boutons", "buttons"],
    link: ["link", "lien", "liens", "links"],
    textbox: ["input", "field", "champ", "textbox", "box", "bar", "barre", "zone", "saisie", "text", "texte", "champs", "fields"],
    searchbox: ["search", "recherche", "chercher", "rechercher"],
    checkbox: ["checkbox", "case", "cocher", "coche"],
    radio: ["radio"],
    image: ["image", "img", "photo", "picture", "logo", "icone", "icône", "icon"],
    heading: ["title", "titre", "heading", "header", "entête", "en-tête"],
    combobox: ["select", "dropdown", "menu", "liste", "combobox", "déroulant", "deroulant"],
    navigation: ["nav", "navigation", "menu"],
    form: ["form", "formulaire"]
  };
  var IDEES = {
    login: ["login", "log in", "sign in", "signin", "connexion", "connecter", "se connecter", "identifier"],
    signup: ["sign up", "signup", "inscription", "inscrire", "créer un compte", "register"],
    submit: ["submit", "envoyer", "valider", "send", "confirmer", "ok"],
    search: ["search", "recherche", "rechercher", "chercher"],
    cart: ["cart", "panier", "basket"],
    close: ["close", "fermer", "×", "dismiss"],
    next: ["next", "suivant", "continuer", "continue"]
  };
  function sansAccent(s) { return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function trouver(args) {
    var q = sansAccent(args.query || "");
    var mots = q.split(/[^a-z0-9×]+/).filter(function (m) { return m && !MOTS_VIDES[m]; });
    if (!mots.length) throw new Refus("ARGUMENT", "Requête vide.");
    var candidats = [];
    function parcourir(racine) {
      var tous = racine.querySelectorAll("*");
      for (var i = 0; i < tous.length; i++) {
        var el = tous[i];
        if (el.shadowRoot) parcourir(el.shadowRoot);
        if (!garder(el, "all") || !visible(el)) continue;
        var r = role(el), n = sansAccent(nom(el));
        var autres = sansAccent([el.id, el.getAttribute("name"), el.getAttribute("placeholder"), el.getAttribute("title"), el.getAttribute("type"),
          el.getAttribute("href"), typeof el.className === "string" ? el.className : "", el.getAttribute("value"), el.getAttribute("data-testid")].join(" "));
        var score = 0, touches = 0;
        for (var j = 0; j < mots.length; j++) {
          var m = mots[j], pts = 0;
          if (n && n.indexOf(m) >= 0) pts += n === m ? 5 : 3;
          if (SYNONYMES[r] && SYNONYMES[r].indexOf(m) >= 0) pts += 2;
          else if (r.indexOf(m) >= 0) pts += 2;
          if (autres.indexOf(m) >= 0) pts += 1;
          for (var idee in IDEES) {
            if (IDEES[idee].indexOf(m) >= 0) {
              for (var k = 0; k < IDEES[idee].length; k++) if (n.indexOf(sansAccent(IDEES[idee][k])) >= 0 || autres.indexOf(sansAccent(IDEES[idee][k])) >= 0) { pts += 2; break; }
            }
          }
          if (pts) touches++;
          score += pts;
        }
        if (!score) continue;
        score += touches === mots.length ? 4 : 0;
        if (interactif(el)) score += 1;
        if (dansLaVue(el)) score += 0.5;
        candidats.push({ el: el, score: score });
      }
    }
    parcourir(document);
    candidats.sort(function (a, b) { return b.score - a.score; });
    // On retire un parent quand un de ses enfants a un aussi bon score (le lien plutôt que son paragraphe).
    var gardes = [];
    for (var i = 0; i < candidats.length && gardes.length < 60; i++) {
      var c = candidats[i], doublon = false;
      for (var j = 0; j < gardes.length; j++) if (c.el.contains(gardes[j].el) && c.el !== gardes[j].el && !interactif(c.el)) { doublon = true; break; }
      if (!doublon) gardes.push(c);
    }
    var total = gardes.length;
    var lignes = gardes.slice(0, 20).map(function (c) {
      var p = centre(c.el);
      return "- " + ligne(c.el, 0) + " — centre (" + p[0] + ", " + p[1] + ")" + (dansLaVue(c.el) ? "" : " hors de la vue");
    });
    return { lignes: lignes, total: total, captcha: pageACaptcha() };
  }

  // ------------------------------------------------------------------ texte de la page
  function texte(args) {
    var max = args.max_chars > 0 ? args.max_chars : 100000;
    var corps = document.body ? document.body.innerText || "" : "";
    var meilleur = null, taille = 0;
    var candidats = document.querySelectorAll('article, main, [role="main"], [role="article"], #content, #main, .article, .post, .entry-content');
    for (var i = 0; i < candidats.length; i++) {
      var t = (candidats[i].innerText || "").length;
      if (t > taille) { taille = t; meilleur = candidats[i]; }
    }
    var source = "body", contenu = corps;
    if (meilleur && taille >= 500 && taille >= corps.length * 0.4) { source = tag(meilleur); contenu = meilleur.innerText; }
    contenu = contenu.replace(/\n{3,}/g, "\n\n").trim();
    var coupe = contenu.length > max;
    return { titre: document.title, url: location.href, source: source, texte: coupe ? contenu.slice(0, max) : contenu, coupe: coupe, total: contenu.length, captcha: pageACaptcha() };
  }

  // ------------------------------------------------------------------ voyant (bordure visible quand Claude pilote)
  var voyant = null;
  function poserVoyant() {
    if (voyant && voyant.hote.isConnected) return voyant;
    var hote = document.createElement("div");
    hote.id = "__cs_voyant";
    hote.setAttribute("aria-hidden", "true");
    hote.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
    var ombre = hote.attachShadow({ mode: "closed" });
    ombre.innerHTML =
      '<style>' +
      '.cadre{position:fixed;inset:0;border:2px solid rgba(217,119,87,.95);box-shadow:inset 0 0 0 1px rgba(217,119,87,.35),inset 0 0 38px 6px rgba(217,119,87,.42),inset 0 0 110px 10px rgba(217,119,87,.16);pointer-events:none;box-sizing:border-box;animation:aura 2.6s ease-in-out infinite}' +
      '@keyframes aura{50%{box-shadow:inset 0 0 0 1px rgba(217,119,87,.35),inset 0 0 52px 10px rgba(217,119,87,.55),inset 0 0 140px 16px rgba(217,119,87,.22)}}' +
      '@media (prefers-reduced-motion: reduce){.cadre{animation:none}}' +
      '.pastille{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);background:#1f1e1d;color:#fff;font:500 13px/1 -apple-system,system-ui,sans-serif;padding:8px 8px 8px 14px;border-radius:999px;display:flex;gap:10px;align-items:center;pointer-events:auto;box-shadow:0 4px 18px rgba(0,0,0,.3)}' +
      '.point{width:8px;height:8px;border-radius:50%;background:#D97757}' +
      'button{all:unset;cursor:pointer;background:#fff;color:#1f1e1d;padding:6px 12px;border-radius:999px;font:600 12px/1 -apple-system,system-ui,sans-serif}' +
      '.rond{position:fixed;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;border:3px solid #D97757;background:rgba(217,119,87,.3);pointer-events:none;transition:transform .45s ease-out,opacity .45s ease-out}' +
      '.marque{position:fixed;width:8px;height:8px;pointer-events:none}' +
      '.souris{position:fixed;left:0;top:0;width:22px;height:22px;pointer-events:none;transition:transform .22s cubic-bezier(.2,.8,.2,1);filter:drop-shadow(0 1px 2px rgba(0,0,0,.35));display:none}' +
      '@media (prefers-reduced-motion: reduce){.souris{transition:none}}' +
      '</style><svg class="souris" viewBox="0 0 22 22" aria-hidden="true"><path d="M3 2l14 8.2-6.3 1.5L7.6 18z" fill="#D97757" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg><div class="cadre"></div><div class="pastille"><span class="point"></span><span class="mot">Claude pilote cet onglet</span><button type="button">Arrêter</button></div>';
    var bouton = ombre.querySelector("button"), mot = ombre.querySelector(".mot");
    bouton.addEventListener("click", function (e) {
      if (!e.isTrusted) return;   // seul un vrai clic de la personne compte
      cs.arrete = true;
      try { sessionStorage.setItem("__cs_arrete", "1"); } catch (x) {}
      mot.textContent = "Arrêté. Claude ne touche plus à cet onglet.";
      bouton.style.display = "none";
      hote.style.display = "block";
    }, true);
    (document.documentElement || document.body).appendChild(hote);
    voyant = { hote: hote, ombre: ombre, minuterie: 0, mot: mot, bouton: bouton };
    try { new MutationObserver(function () { caler(voyant); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-cs-volet"] }); } catch (e) {}
    if (cs.arrete) { mot.textContent = "Arrêté. Claude ne touche plus à cet onglet."; bouton.style.display = "none"; }
    return voyant;
  }
  // La barre de Safari prend la couleur de la page quand elle en déclare une : on la teinte en orange pendant que
  // Claude travaille dans l'onglet, puis on remet ce qu'il y avait.
  function teinte(oui) {
    try {
      var m = document.querySelector('meta[name="theme-color"][data-cs]');
      if (oui && !m) {
        var autres = document.querySelectorAll('meta[name="theme-color"]');
        for (var i = 0; i < autres.length; i++) { autres[i].setAttribute("data-cs-nom", "1"); autres[i].setAttribute("name", "theme-color-avant"); }
        m = document.createElement("meta"); m.name = "theme-color"; m.content = "#D97757"; m.setAttribute("data-cs", "1");
        (document.head || document.documentElement).appendChild(m);
      } else if (!oui && m) {
        m.remove();
        var avant = document.querySelectorAll('meta[data-cs-nom]');
        for (var j = 0; j < avant.length; j++) { avant[j].setAttribute("name", "theme-color"); avant[j].removeAttribute("data-cs-nom"); }
      }
    } catch (e) {}
  }
  // Le panneau de l'extension occupe le bord droit (data-cs-volet) : l'aura et la pastille restent sur la page.
  function caler(v) {
    var l = parseInt(document.documentElement.getAttribute("data-cs-volet") || "0", 10) || 0;
    v.ombre.querySelector(".cadre").style.right = l + "px";
    v.ombre.querySelector(".cadre").style.visibility = l ? "hidden" : "";     // le panneau dessine son propre halo
    v.ombre.querySelector(".pastille").style.left = "calc((100% - " + l + "px) / 2)";
  }
  function montrerVoyant() {
    try {
      var v = poserVoyant();
      caler(v);
      document.documentElement.setAttribute("data-cs-pilote", "1");
      if (!cs.voyantCache) v.hote.style.display = "block";
      teinte(true);
      clearTimeout(v.minuterie);
      v.minuterie = setTimeout(function () { if (!cs.arrete) { v.hote.style.display = "none"; teinte(false); } }, 20000);
    } catch (e) {}
  }
  function cacherVoyant(cache) {
    cs.voyantCache = !!cache;
    if (voyant) voyant.hote.style.display = cache ? "none" : "block";
    return true;
  }
  // La petite souris de Claude : elle glisse jusqu'à l'endroit où il agit, pour qu'la personne suive.
  function souriceau(x, y) {
    try {
      var v = poserVoyant(), s = v.ombre.querySelector(".souris");
      if (s.style.display !== "block") { s.style.transition = "none"; s.style.transform = "translate(" + (x + 60) + "px," + (y + 40) + "px)"; s.style.display = "block"; s.getBoundingClientRect(); s.style.transition = ""; }
      s.style.transform = "translate(" + (x - 3) + "px," + (y - 2) + "px)";
    } catch (e) {}
  }
  function rond(x, y) {
    souriceau(x, y);
    try {
      var v = poserVoyant(), d = document.createElement("div");
      d.className = "rond"; d.style.left = x + "px"; d.style.top = y + "px";
      v.ombre.appendChild(d);
      setTimeout(function () { d.style.transform = "scale(2)"; d.style.opacity = "0"; }, 16);
      setTimeout(function () { d.remove(); }, 600);
    } catch (e) {}
  }
  // Deux petits carrés de couleur aux coins de la zone web : le pont les cherche dans la capture
  // de la fenêtre pour savoir où est la page (barre d'onglets, barre latérale, inspecteur…).
  function marques(args) {
    var v = poserVoyant();
    var anciennes = v.ombre.querySelectorAll(".marque");
    for (var i = 0; i < anciennes.length; i++) anciennes[i].remove();
    if (!args.poser) { if (!cs.voyantCache && !args.garderCache) v.hote.style.display = "block"; return { fait: true }; }
    var cw = document.documentElement.clientWidth, ch = document.documentElement.clientHeight;
    var a = document.createElement("div"), b = document.createElement("div");
    a.className = b.className = "marque";
    a.style.cssText = "left:0;top:0;background:rgb(" + args.c1.join(",") + ")";
    b.style.cssText = "left:" + (cw - 8) + "px;top:" + (ch - 8) + "px;background:rgb(" + args.c2.join(",") + ")";
    v.ombre.appendChild(a); v.ombre.appendChild(b);
    v.ombre.querySelector(".cadre").style.display = "none";
    v.ombre.querySelector(".pastille").style.display = "none";
    v.ombre.querySelector(".souris").style.visibility = "hidden";
    v.hote.style.display = "block";
    return { cw: cw, ch: ch, lw: innerWidth, lh: innerHeight };
  }
  function finMarques() {
    if (!voyant) return true;
    var anciennes = voyant.ombre.querySelectorAll(".marque");
    for (var i = 0; i < anciennes.length; i++) anciennes[i].remove();
    voyant.ombre.querySelector(".cadre").style.display = "";
    voyant.ombre.querySelector(".pastille").style.display = "";
    voyant.ombre.querySelector(".souris").style.visibility = "";
    voyant.hote.style.display = cs.voyantCache ? "none" : "block";
    return true;
  }

  // ------------------------------------------------------------------ cible d'un point
  function ciblePoint(x, y) {
    var doc = document, el = doc.elementFromPoint(x, y), ox = 0, oy = 0;
    for (var i = 0; i < 12 && el; i++) {
      if (el.id === "__cs_voyant") throw new Refus("VOYANT", "Ce point est sur le bouton « Arrêter » du voyant de Claude : seul la personne peut cliquer dessus.");
      if (el.shadowRoot) {
        var e2 = el.shadowRoot.elementFromPoint(x - ox, y - oy);
        if (e2 && e2 !== el) { el = e2; continue; }
      }
      if (tag(el) === "iframe" || tag(el) === "frame") {
        refuserSiCaptcha(el);
        var d = null; try { d = el.contentDocument; } catch (e) {}
        if (!d) break;
        var r = el.getBoundingClientRect();
        ox += r.left + el.clientLeft; oy += r.top + el.clientTop;
        var e3 = d.elementFromPoint(x - ox, y - oy);
        if (!e3) break;
        el = e3; continue;
      }
      break;
    }
    if (!el) throw new Refus("HORS_PAGE", "Aucun élément au point (" + x + ", " + y + "). La vue fait " + innerWidth + "×" + innerHeight + ".");
    return { el: el, x: x - ox, y: y - oy };
  }
  function viser(args) {
    // Rend {el, x, y} : par référence (on fait défiler si besoin) ou par coordonnées.
    if (args.ref) {
      var el = elDe(args.ref);
      if (!dansLaVue(el)) el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      var r = el.getBoundingClientRect();
      var x = r.left + r.width / 2, y = r.top + r.height / 2;
      // On vise l'élément lui-même, même si autre chose le recouvre au centre.
      var dessus = null; try { dessus = ciblePoint(x, y).el; } catch (e) {}
      if (dessus && (el.contains(dessus) || (dessus.getRootNode() === el.shadowRoot))) return { el: dessus, x: x, y: y, parRef: el };
      return { el: el, x: x, y: y, parRef: el };
    }
    if (!args.coordinate || args.coordinate.length !== 2) throw new Refus("ARGUMENT", "Il faut `coordinate` [x, y] ou `ref`.");
    var c = ciblePoint(Number(args.coordinate[0]), Number(args.coordinate[1]));
    return { el: c.el, x: Number(args.coordinate[0]), y: Number(args.coordinate[1]), dx: c.x, dy: c.y };
  }

  // ------------------------------------------------------------------ événements de souris
  function modifs(args) {
    var m = String(args.modifiers || "").toLowerCase().split("+");
    return { ctrlKey: m.indexOf("ctrl") >= 0 || m.indexOf("control") >= 0, shiftKey: m.indexOf("shift") >= 0, altKey: m.indexOf("alt") >= 0 || m.indexOf("option") >= 0,
      metaKey: m.indexOf("cmd") >= 0 || m.indexOf("meta") >= 0 || m.indexOf("command") >= 0 || m.indexOf("win") >= 0 || m.indexOf("windows") >= 0 };
  }
  function souris(el, type, x, y, plus) {
    var vue = el.ownerDocument.defaultView || window;
    var init = { bubbles: type !== "mouseenter" && type !== "mouseleave" && type !== "pointerenter" && type !== "pointerleave", cancelable: true, composed: true,
      view: vue, clientX: x, clientY: y, screenX: x + (window.screenX || 0), screenY: y + (window.screenY || 0), button: 0, buttons: 0, detail: 0 };
    for (var k in plus) init[k] = plus[k];
    var ev;
    if (type.indexOf("pointer") === 0 && vue.PointerEvent) { init.pointerId = 1; init.pointerType = "mouse"; init.isPrimary = true; ev = new vue.PointerEvent(type, init); }
    else if (type === "wheel") ev = new vue.WheelEvent(type, init);
    else ev = new vue.MouseEvent(type, init);
    return el.dispatchEvent(ev);
  }
  function entrer(el, x, y, m) {
    if (cs.survole && cs.survole !== el && cs.survole.isConnected) {
      souris(cs.survole, "pointerout", x, y, m); souris(cs.survole, "mouseout", x, y, m);
      if (!cs.survole.contains(el)) { souris(cs.survole, "pointerleave", x, y, m); souris(cs.survole, "mouseleave", x, y, m); }
    }
    if (cs.survole !== el) {
      souris(el, "pointerover", x, y, m); souris(el, "pointerenter", x, y, m);
      souris(el, "mouseover", x, y, m); souris(el, "mouseenter", x, y, m);
    }
    souris(el, "pointermove", x, y, m); souris(el, "mousemove", x, y, m);
    cs.survole = el;
  }
  function focaliser(el, x, y) {
    var f = el.closest ? el.closest(FOCALISABLES) : null;
    if (!f && el.getRootNode && el.getRootNode().host) f = el.getRootNode().host.closest(FOCALISABLES);
    var doc = el.ownerDocument;
    if (f) {
      try { f.focus({ preventScroll: true }); } catch (e) {}
      var t = tag(f);
      if ((t === "input" || t === "textarea") && typeof f.value === "string") {
        try { f.setSelectionRange(f.value.length, f.value.length); } catch (e) {}
      } else if (f.isContentEditable && doc.caretRangeFromPoint) {
        try { var rg = doc.caretRangeFromPoint(x, y); if (rg) { var s = doc.getSelection(); s.removeAllRanges(); s.addRange(rg); } } catch (e) {}
      }
    } else if (doc.activeElement && doc.activeElement !== doc.body) {
      try { doc.activeElement.blur(); } catch (e) {}
    }
    return f;
  }
  function cliquer(args) {
    var v = viser(args), el = v.el, x = v.dx != null ? v.dx : v.x, y = v.dy != null ? v.dy : v.y;
    refuserSiCaptcha(el);
    var m = modifs(args), action = args.action || "left_click";
    var droit = action === "right_click", fois = action === "double_click" ? 2 : action === "triple_click" ? 3 : 1;
    var bouton = droit ? 2 : 0, appuye = droit ? 2 : 1;
    var note = "", suite = {};
    montrerVoyant(); rond(v.x, v.y);
    var t = tag(el);
    var fichier = el.closest && el.closest('input[type="file"]');
    if (fichier) return { texte: "Rien fait : c'est un champ de fichier. Un clic ouvrirait la fenêtre de choix de fichier, que Claude ne voit pas. Utilise file_upload avec la référence " + refDe(fichier) + "." };
    entrer(el, x, y, m);
    for (var i = 1; i <= fois; i++) {
      var o = { button: bouton, buttons: appuye, detail: i }; for (var k in m) o[k] = m[k];
      souris(el, "pointerdown", x, y, o);
      var pasBloque = souris(el, "mousedown", x, y, o);
      if (pasBloque) focaliser(el, x, y);
      var o2 = { button: bouton, buttons: 0, detail: i }; for (var k2 in m) o2[k2] = m[k2];
      souris(el, "pointerup", x, y, o2); souris(el, "mouseup", x, y, o2);
      if (droit) { souris(el, "contextmenu", x, y, o2); note = " (le menu de Safari ne s'ouvre pas : seul l'événement « contextmenu » est envoyé à la page)"; continue; }
      // Lien qui s'ouvrirait ailleurs : Safari bloque l'ouverture venant d'un clic simulé. Le serveur ouvre l'onglet lui-même.
      var lien = el.closest ? el.closest("a[href]") : null, ailleurs = lien && (lien.target === "_blank" || m.metaKey);
      var bloqueParLaPage = false, ecoute = null;
      if (ailleurs) {
        ecoute = function (e) { bloqueParLaPage = e.defaultPrevented; e.preventDefault(); };
        window.addEventListener("click", ecoute, false);
      } else if (lien && !droit) {
        // Lien dans le même onglet : on note si la page l'a laissé faire, pour que le serveur attende la nouvelle page
        // (certains sites mettent plus d'une seconde à partir ; sans ça, Claude croit que le clic n'a rien fait).
        ecoute = function (e) { bloqueParLaPage = e.defaultPrevented; };
        window.addEventListener("click", ecoute, false);
      }
      souris(el, "click", x, y, o2);
      if (ecoute) {
        window.removeEventListener("click", ecoute, false);
        if (ailleurs && !bloqueParLaPage && /^https?:/i.test(lien.href)) suite.ouvrir = lien.href;
        var memePage = lien.href.split("#")[0] === location.href.split("#")[0];
        if (!ailleurs && !bloqueParLaPage && /^https?:/i.test(lien.href) && !memePage) suite.lien = lien.href;
      }
    }
    if (fois === 2) souris(el, "dblclick", x, y, { button: 0, detail: 2 });
    if (fois === 3) {
      var cible = el.closest && el.closest("input, textarea");
      try {
        if (cible && cible.select) cible.select();
        else { var rg = document.createRange(); rg.selectNodeContents(el); var s = getSelection(); s.removeAllRanges(); s.addRange(rg); }
      } catch (e) {}
    }
    if (t === "select" || (el.closest && el.closest("select"))) note += " (une liste déroulante native ne s'ouvre pas par un clic simulé : choisis la valeur avec form_input)";
    var quoi = { left_click: "Clic", right_click: "Clic droit", double_click: "Double-clic", triple_click: "Triple-clic" }[action] || "Clic";
    suite.texte = quoi + " sur " + decrire(v.parRef || (el.closest && el.closest(FOCALISABLES)) || el) + " en (" + Math.round(v.x) + ", " + Math.round(v.y) + ")" + note;
    return suite;
  }
  function survoler(args) {
    var v = viser(args), x = v.dx != null ? v.dx : v.x, y = v.dy != null ? v.dy : v.y;
    montrerVoyant(); souriceau(v.x, v.y);
    entrer(v.el, x, y, modifs(args));
    return { texte: "Survol de " + decrire(v.parRef || v.el) + " en (" + Math.round(v.x) + ", " + Math.round(v.y) + "). Limite : les effets CSS « :hover » ne se déclenchent pas avec un survol simulé ; les menus ouverts par JavaScript, oui." };
  }
  function glisser(args) {
    if (!args.start_coordinate || !args.coordinate) throw new Refus("ARGUMENT", "Il faut `start_coordinate` et `coordinate`.");
    var x0 = Number(args.start_coordinate[0]), y0 = Number(args.start_coordinate[1]), x1 = Number(args.coordinate[0]), y1 = Number(args.coordinate[1]);
    var a = ciblePoint(x0, y0), m = modifs(args);
    refuserSiCaptcha(a.el);
    montrerVoyant(); rond(x0, y0);
    entrer(a.el, a.x, a.y, m);
    var prenable = a.el.closest ? a.el.closest('[draggable="true"]') : null;
    var bas = { button: 0, buttons: 1, detail: 1 };
    souris(a.el, "pointerdown", a.x, a.y, bas);
    var pasBloque = souris(a.el, "mousedown", a.x, a.y, bas);
    var mode = "souris";
    if (prenable && pasBloque) {
      mode = "glisser-déposer";
      var dt = new DataTransfer();
      var evt = function (el, type, x, y) {
        var e = new DragEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, dataTransfer: dt, view: window });
        return el.dispatchEvent(e);
      };
      evt(prenable, "dragstart", a.x, a.y);
      evt(prenable, "drag", a.x, a.y);
      var b = ciblePoint(x1, y1);
      evt(b.el, "dragenter", b.x, b.y);
      var refuse = evt(b.el, "dragover", b.x, b.y);   // false = la cible a dit preventDefault = elle accepte le dépôt
      if (!refuse) evt(b.el, "drop", b.x, b.y);
      evt(prenable, "dragend", b.x, b.y);
      souris(b.el, "pointerup", b.x, b.y, { button: 0 }); souris(b.el, "mouseup", b.x, b.y, { button: 0 });
      rond(x1, y1);
      return { texte: "Glisser-déposer de " + decrire(prenable) + " vers " + decrire(b.el) + (refuse ? " : la cible n'accepte pas le dépôt." : ".") };
    }
    var pas = 10, dernier = a;
    for (var i = 1; i <= pas; i++) {
      var x = x0 + (x1 - x0) * i / pas, y = y0 + (y1 - y0) * i / pas, c;
      try { c = ciblePoint(x, y); } catch (e) { continue; }
      souris(c.el, "pointermove", c.x, c.y, { buttons: 1 }); souris(c.el, "mousemove", c.x, c.y, { buttons: 1 });
      dernier = c;
    }
    souris(dernier.el, "pointerup", dernier.x, dernier.y, { button: 0 }); souris(dernier.el, "mouseup", dernier.x, dernier.y, { button: 0 });
    cs.survole = dernier.el;
    rond(x1, y1);
    return { texte: "Glissé (" + mode + ") de (" + x0 + ", " + y0 + ") à (" + x1 + ", " + y1 + "), parti de " + decrire(a.el) + ". Limite : un curseur natif (input range) ne suit pas une souris simulée ; utilise form_input." };
  }

  // ------------------------------------------------------------------ défilement
  function defilable(el, dx, dy) {
    for (var e = el; e && e.nodeType === 1; e = e.parentElement || (e.getRootNode && e.getRootNode().host) || null) {
      if (e === document.documentElement || e === document.body) break;
      var st = getComputedStyle(e);
      if (dy && /(auto|scroll|overlay)/.test(st.overflowY) && e.scrollHeight > e.clientHeight + 1) {
        if ((dy > 0 && e.scrollTop + e.clientHeight < e.scrollHeight - 1) || (dy < 0 && e.scrollTop > 0)) return e;
      }
      if (dx && /(auto|scroll|overlay)/.test(st.overflowX) && e.scrollWidth > e.clientWidth + 1) {
        if ((dx > 0 && e.scrollLeft + e.clientWidth < e.scrollWidth - 1) || (dx < 0 && e.scrollLeft > 0)) return e;
      }
    }
    return el.ownerDocument.scrollingElement || document.documentElement;
  }
  function defiler(args) {
    var crans = args.scroll_amount > 0 ? args.scroll_amount : 3, d = crans * 100;
    var sens = args.scroll_direction, dx = sens === "left" ? -d : sens === "right" ? d : 0, dy = sens === "up" ? -d : sens === "down" ? d : 0;
    if (!dx && !dy) throw new Refus("ARGUMENT", "`scroll_direction` doit valoir up, down, left ou right.");
    var x = args.coordinate ? Number(args.coordinate[0]) : innerWidth / 2, y = args.coordinate ? Number(args.coordinate[1]) : innerHeight / 2;
    var c = ciblePoint(x, y);
    montrerVoyant();
    var libre = souris(c.el, "wheel", c.x, c.y, { deltaX: dx, deltaY: dy, deltaMode: 0 });
    if (!libre) return { texte: "Molette envoyée (" + sens + ", " + crans + " crans) : la page gère elle-même son défilement." };
    var zone = defilable(c.el, dx, dy), avantX = zone.scrollLeft, avantY = zone.scrollTop;
    zone.scrollBy({ left: dx, top: dy, behavior: "instant" });
    var fait = (zone.scrollLeft - avantX) || (zone.scrollTop - avantY);
    var se = document.scrollingElement || document.documentElement;
    return { texte: "Défilement " + sens + " de " + Math.abs(fait) + " px" + (fait ? "" : " (déjà au bout)") + ". Position de la page : " + Math.round(se.scrollTop) + " / " + Math.max(0, se.scrollHeight - se.clientHeight) + " px." };
  }
  function defilerVers(args) {
    var el = elDe(args.ref);
    montrerVoyant();
    el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    var p = centre(el);
    return { texte: decrire(el) + " est maintenant dans la vue, centre (" + p[0] + ", " + p[1] + ")." };
  }

  // ------------------------------------------------------------------ clavier
  function actif() {
    var el = document.activeElement;
    for (var i = 0; i < 12 && el; i++) {
      if (el.shadowRoot && el.shadowRoot.activeElement) { el = el.shadowRoot.activeElement; continue; }
      if (tag(el) === "iframe") { var d = null; try { d = el.contentDocument; } catch (e) {} if (d && d.activeElement) { el = d.activeElement; continue; } }
      break;
    }
    return el || document.body;
  }
  function editable(el) {
    if (!el || el.nodeType !== 1) return false;
    var t = tag(el);
    if (t === "textarea") return !el.readOnly && !el.disabled;
    if (t === "input") {
      var type = (el.getAttribute("type") || "text").toLowerCase();
      return !el.readOnly && !el.disabled && !/^(checkbox|radio|button|submit|reset|file|image|range|color|hidden)$/.test(type);
    }
    return !!el.isContentEditable;
  }
  var TOUCHES = {
    enter: ["Enter", "Enter", 13], "return": ["Enter", "Enter", 13], tab: ["Tab", "Tab", 9], escape: ["Escape", "Escape", 27], esc: ["Escape", "Escape", 27],
    backspace: ["Backspace", "Backspace", 8], "delete": ["Delete", "Delete", 46], space: [" ", "Space", 32],
    arrowup: ["ArrowUp", "ArrowUp", 38], up: ["ArrowUp", "ArrowUp", 38], arrowdown: ["ArrowDown", "ArrowDown", 40], down: ["ArrowDown", "ArrowDown", 40],
    arrowleft: ["ArrowLeft", "ArrowLeft", 37], left: ["ArrowLeft", "ArrowLeft", 37], arrowright: ["ArrowRight", "ArrowRight", 39], right: ["ArrowRight", "ArrowRight", 39],
    home: ["Home", "Home", 36], end: ["End", "End", 35], pageup: ["PageUp", "PageUp", 33], page_up: ["PageUp", "PageUp", 33],
    pagedown: ["PageDown", "PageDown", 34], page_down: ["PageDown", "PageDown", 34], insert: ["Insert", "Insert", 45]
  };
  function toucheDe(nomTouche) {
    var k = String(nomTouche), bas = k.toLowerCase();
    if (TOUCHES[bas]) return { key: TOUCHES[bas][0], code: TOUCHES[bas][1], keyCode: TOUCHES[bas][2] };
    var f = /^f(\d{1,2})$/.exec(bas); if (f) return { key: "F" + f[1], code: "F" + f[1], keyCode: 111 + Number(f[1]) };
    if (Array.from(k).length === 1) {
      var code = /[a-z]/i.test(k) ? "Key" + k.toUpperCase() : /\d/.test(k) ? "Digit" + k : "";
      return { key: k, code: code, keyCode: k.toUpperCase().charCodeAt(0), caractere: true };
    }
    throw new Refus("ARGUMENT", "Touche inconnue : « " + nomTouche + " ». Exemples : Enter, Tab, Escape, Backspace, ArrowDown, cmd+a, shift+Tab.");
  }
  function clavier(el, type, t, m) {
    var init = { key: t.key, code: t.code, keyCode: t.keyCode, which: t.keyCode, bubbles: true, cancelable: true, composed: true, view: el.ownerDocument.defaultView };
    for (var k in m) init[k] = m[k];
    var ev = new KeyboardEvent(type, init);
    // Safari garde keyCode à 0 sur un événement fabriqué : on le fixe pour les pages qui le lisent.
    try { Object.defineProperty(ev, "keyCode", { get: function () { return t.keyCode; } }); Object.defineProperty(ev, "which", { get: function () { return t.keyCode; } }); } catch (e) {}
    return el.dispatchEvent(ev);
  }
  function inserer(el, txt) {
    var doc = el.ownerDocument, ok = false;
    try { ok = doc.execCommand("insertText", false, txt); } catch (e) {}
    if (ok) return true;
    var t = tag(el);
    if (t === "input" || t === "textarea") {
      var proto = t === "input" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      var poser = Object.getOwnPropertyDescriptor(proto, "value").set;
      var debut = el.value.length, fin = el.value.length;
      try { if (el.selectionStart != null) { debut = el.selectionStart; fin = el.selectionEnd; } } catch (e) {}
      poser.call(el, el.value.slice(0, debut) + txt + el.value.slice(fin));
      try { el.setSelectionRange(debut + txt.length, debut + txt.length); } catch (e) {}
      el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: txt, inputType: "insertText" }));
      return true;
    }
    return false;
  }
  function tabulables() {
    var liste = Array.prototype.filter.call(document.querySelectorAll(FOCALISABLES), function (e) { return e.tabIndex >= 0 && !e.disabled && visible(e); });
    var positifs = liste.filter(function (e) { return e.tabIndex > 0; }).sort(function (a, b) { return a.tabIndex - b.tabIndex; });
    return positifs.concat(liste.filter(function (e) { return e.tabIndex === 0; }));
  }
  function validerFormulaire(el) {
    var f = el.form;
    if (!f) return false;
    var b = f.querySelector('button:not([type]), button[type="submit"], input[type="submit"], input[type="image"]');
    if (b && !b.disabled) { b.click(); return true; }
    if (b) return false;
    if (f.requestSubmit) f.requestSubmit(); else f.submit();
    return true;
  }
  function parDefaut(el, t, m) {
    // Ce que le navigateur ferait tout seul après la touche (un événement fabriqué ne le déclenche pas).
    var tg = tag(el), ed = editable(el), cmd = m.metaKey || m.ctrlKey;
    if (cmd) {
      var k = t.key.toLowerCase();
      if (k === "a") { if (ed && el.select) el.select(); else document.execCommand("selectAll"); return ""; }
      if (k === "z") { document.execCommand(m.shiftKey ? "redo" : "undo"); return ""; }
      if (k === "c" || k === "x") { var ok = false; try { ok = document.execCommand(k === "c" ? "copy" : "cut"); } catch (e) {} return ok ? "" : " (Safari a refusé l'accès au presse-papiers pour une action simulée)"; }
      if (k === "v") return " (coller n'est pas possible : Claude ne lit pas le presse-papiers ; tape le texte avec l'action type)";
      if (k === "r") return { recharger: true };
      if (k === "arrowleft" || k === "arrowup") { if (ed) { try { el.setSelectionRange(0, 0); } catch (e) {} } else if (k === "arrowup") scrollTo({ top: 0, behavior: "instant" }); return ""; }
      if (k === "arrowright" || k === "arrowdown") { if (ed) { try { el.setSelectionRange(el.value.length, el.value.length); } catch (e) {} } else if (k === "arrowdown") scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }); return ""; }
      return " (raccourci de Safari non simulé : seuls les événements clavier sont envoyés à la page)";
    }
    if (t.caractere || t.key === " ") {
      if (ed) { refuserSiSensible(el, null); clavier(el, "keypress", t, m); inserer(el, t.key); return ""; }
      clavier(el, "keypress", t, m);
      if (t.key === " ") {
        if (tg === "button" || (tg === "input" && /^(checkbox|radio|button|submit)$/.test((el.type || "").toLowerCase())) || tg === "summary") el.click();
        else (document.scrollingElement || document.documentElement).scrollBy({ top: (m.shiftKey ? -1 : 1) * innerHeight * 0.9, behavior: "instant" });
      }
      return "";
    }
    switch (t.key) {
      case "Enter":
        clavier(el, "keypress", t, m);
        if (tg === "textarea") inserer(el, "\n");
        else if (el.isContentEditable) { try { document.execCommand(m.shiftKey ? "insertLineBreak" : "insertParagraph"); } catch (e) {} }
        else if (tg === "input") { if (!/^(checkbox|radio|file)$/.test((el.type || "").toLowerCase())) validerFormulaire(el); }
        else if (tg === "button" || tg === "a" || tg === "summary" || el.getAttribute("role") === "button" || el.getAttribute("role") === "link") el.click();
        return "";
      case "Tab": {
        var liste = tabulables(), i = liste.indexOf(el), suivant;
        if (!liste.length) return "";
        if (m.shiftKey) suivant = liste[i <= 0 ? liste.length - 1 : i - 1]; else suivant = liste[i < 0 || i === liste.length - 1 ? 0 : i + 1];
        suivant.focus(); if (suivant.select && editable(suivant)) { try { suivant.select(); } catch (e) {} }
        return "";
      }
      case "Backspace": if (ed) document.execCommand("delete"); return "";
      case "Delete": if (ed) document.execCommand("forwardDelete"); return "";
      case "Escape": return "";
      case "ArrowLeft": case "ArrowRight": case "ArrowUp": case "ArrowDown": case "Home": case "End": case "PageUp": case "PageDown": {
        if (tg === "select") {
          var d = (t.key === "ArrowDown" || t.key === "ArrowRight") ? 1 : (t.key === "ArrowUp" || t.key === "ArrowLeft") ? -1 : 0;
          var j = t.key === "Home" ? 0 : t.key === "End" ? el.options.length - 1 : Math.max(0, Math.min(el.options.length - 1, el.selectedIndex + d));
          if (j !== el.selectedIndex) { el.selectedIndex = j; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }
          return "";
        }
        if (tg === "input" && el.type === "range") {
          var pas = Number(el.step) || 1, sens = (t.key === "ArrowRight" || t.key === "ArrowUp") ? 1 : (t.key === "ArrowLeft" || t.key === "ArrowDown") ? -1 : 0;
          if (sens) { poserValeur(el, String(Number(el.value) + sens * pas)); }
          return "";
        }
        if (tg === "input" && el.type === "radio" && el.name) {
          var groupe = Array.prototype.filter.call(document.querySelectorAll('input[type="radio"]'), function (r) { return r.name === el.name && r.form === el.form && !r.disabled; });
          var s2 = (t.key === "ArrowRight" || t.key === "ArrowDown") ? 1 : -1, idx = groupe.indexOf(el);
          var prochain = groupe[(idx + s2 + groupe.length) % groupe.length];
          if (prochain) { prochain.focus(); prochain.click(); }
          return "";
        }
        if (ed) {
          if (tg === "input" || tg === "textarea") {
            try {
              var p = el.selectionStart, fin = el.selectionEnd, n = el.value.length, np = p;
              if (t.key === "ArrowLeft") np = m.shiftKey ? p - 1 : (p !== fin ? p : p - 1);
              else if (t.key === "ArrowRight") np = m.shiftKey ? fin + 1 : (p !== fin ? fin : fin + 1);
              else if (t.key === "Home" || t.key === "ArrowUp") np = 0;
              else if (t.key === "End" || t.key === "ArrowDown") np = n;
              np = Math.max(0, Math.min(n, np));
              if (m.shiftKey) { if (t.key === "ArrowLeft" || t.key === "Home" || t.key === "ArrowUp") el.setSelectionRange(np, fin); else el.setSelectionRange(p, np); }
              else el.setSelectionRange(np, np);
            } catch (e) {}
          } else {
            var sel = getSelection(), mode = m.shiftKey ? "extend" : "move";
            var mouvement = { ArrowLeft: ["backward", "character"], ArrowRight: ["forward", "character"], ArrowUp: ["backward", "line"], ArrowDown: ["forward", "line"],
              Home: ["backward", "lineboundary"], End: ["forward", "lineboundary"] }[t.key];
            if (mouvement && sel.modify) sel.modify(mode, mouvement[0], mouvement[1]);
          }
          return "";
        }
        var se = defilable(el, t.key === "ArrowLeft" ? -1 : t.key === "ArrowRight" ? 1 : 0, (t.key === "ArrowUp" || t.key === "PageUp" || t.key === "Home") ? -1 : 1);
        var saut = { ArrowUp: [0, -40], ArrowDown: [0, 40], ArrowLeft: [-40, 0], ArrowRight: [40, 0], PageUp: [0, -innerHeight * 0.9], PageDown: [0, innerHeight * 0.9] }[t.key];
        if (saut) se.scrollBy({ left: saut[0], top: saut[1], behavior: "instant" });
        else if (t.key === "Home") se.scrollTo({ top: 0, behavior: "instant" });
        else se.scrollTo({ top: se.scrollHeight, behavior: "instant" });
        return "";
      }
    }
    return "";
  }
  function appuyer(args) {
    var combos = String(args.text || "").trim().split(/\s+/).filter(Boolean);
    if (!combos.length) throw new Refus("ARGUMENT", "`text` est vide : donne la ou les touches, par exemple « Enter » ou « cmd+a ».");
    var fois = Math.max(1, Math.min(100, args.repeat || 1)), notes = [], suite = {};
    montrerVoyant();
    for (var r = 0; r < fois; r++) {
      for (var i = 0; i < combos.length; i++) {
        var parts = combos[i].length > 1 ? combos[i].split("+") : [combos[i]];
        if (combos[i].length > 1 && combos[i].slice(-1) === "+") { parts = combos[i].slice(0, -1).split("+"); parts.push("+"); }
        var m = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false }, principale = null;
        for (var j = 0; j < parts.length; j++) {
          var p = parts[j].toLowerCase();
          if (p === "cmd" || p === "meta" || p === "command" || p === "super" || p === "win") m.metaKey = true;
          else if (p === "ctrl" || p === "control") m.ctrlKey = true;
          else if (p === "alt" || p === "option") m.altKey = true;
          else if (p === "shift") m.shiftKey = true;
          else principale = parts[j];
        }
        if (principale === null) throw new Refus("ARGUMENT", "« " + combos[i] + " » ne contient que des touches de modification.");
        var t = toucheDe(principale);
        if (t.caractere && m.shiftKey && !m.metaKey && !m.ctrlKey) t.key = t.key.toUpperCase();
        var el = actif();
        refuserSiCaptcha(el);
        var libre = clavier(el, "keydown", t, m), note = "";
        if (libre) { note = parDefaut(el, t, m); if (note && note.recharger) { suite.recharger = true; note = ""; } }
        clavier(actif(), "keyup", t, m);
        if (note && notes.indexOf(note) < 0) notes.push(note);
      }
    }
    suite.texte = "Touche" + (combos.length * fois > 1 ? "s" : "") + " envoyée" + (combos.length * fois > 1 ? "s" : "") + " : " + combos.join(" ") + (fois > 1 ? " ×" + fois : "") + " (élément actif : " + decrire(actif()) + ")" + notes.join("");
    return suite;
  }
  function taper(args) {
    var txt = String(args.text == null ? "" : args.text);
    var el = actif();
    refuserSiCaptcha(el);
    refuserSiSensible(el, txt);
    montrerVoyant();
    var ed = editable(el), m = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
    var lettres = Array.from(txt);
    for (var i = 0; i < lettres.length; i++) {
      var ch = lettres[i];
      if (ch === "\r") continue;
      if (ch === "\n") {
        var e = { key: "Enter", code: "Enter", keyCode: 13 };
        el = actif();
        if (clavier(el, "keydown", e, m)) parDefaut(el, e, m);
        clavier(actif(), "keyup", e, m);
        continue;
      }
      if (ch === "\t" && !ed) { var tb = { key: "Tab", code: "Tab", keyCode: 9 }; el = actif(); if (clavier(el, "keydown", tb, m)) parDefaut(el, tb, m); clavier(actif(), "keyup", tb, m); el = actif(); ed = editable(el); continue; }
      var t = { key: ch, code: /[a-z]/i.test(ch) ? "Key" + ch.toUpperCase() : "", keyCode: ch.toUpperCase().charCodeAt(0), caractere: true };
      el = actif(); ed = editable(el);
      if (ed) refuserSiSensible(el, null);
      if (clavier(el, "keydown", t, m)) {
        clavier(el, "keypress", t, m);
        if (ed) inserer(el, ch);
      }
      clavier(el, "keyup", t, m);
    }
    el = actif();
    if (!editable(el)) return { texte: "Touches envoyées (" + lettres.length + " caractères), mais aucun champ de saisie n'a le focus (élément actif : " + decrire(el) + "). Clique d'abord dans le champ." };
    return { texte: "Texte saisi (" + lettres.length + " caractères) dans " + decrire(el) + "." };
  }

  // ------------------------------------------------------------------ formulaires
  function poserValeur(el, valeur) {
    var proto = tag(el) === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, valeur);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertReplacementText", data: valeur }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function remplir(args) {
    var el = elDe(args.ref), v = args.value, t = tag(el);
    refuserSiCaptcha(el);
    if (t === "label" && el.control) { el = el.control; t = tag(el); }
    refuserSiSensible(el, typeof v === "string" || typeof v === "number" ? String(v) : null);
    montrerVoyant();
    if (!dansLaVue(el)) el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    var p = centre(el); rond(p[0], p[1]);
    if (el.disabled) throw new Refus("DESACTIVE", decrire(el) + " est désactivé.");
    if (t === "select") {
      var voulus = Array.isArray(v) ? v.map(String) : [String(v)], trouve = [];
      var norm = function (s) { return sansAccent(String(s)).replace(/\s+/g, " ").trim(); };
      for (var i = 0; i < voulus.length; i++) {
        var o = null, options = el.options;
        for (var j = 0; j < options.length && !o; j++) if (options[j].value === voulus[i]) o = options[j];
        for (var j2 = 0; j2 < options.length && !o; j2++) if (options[j2].textContent.trim() === voulus[i].trim()) o = options[j2];
        for (var j3 = 0; j3 < options.length && !o; j3++) if (norm(options[j3].textContent) === norm(voulus[i]) || norm(options[j3].value) === norm(voulus[i])) o = options[j3];
        if (!o) throw new Refus("OPTION_INCONNUE", "Option « " + voulus[i] + " » introuvable. Options : " + Array.prototype.map.call(options, function (x) { return x.textContent.trim(); }).join(" | "));
        trouve.push(o);
      }
      if (el.multiple) for (var k = 0; k < el.options.length; k++) el.options[k].selected = trouve.indexOf(el.options[k]) >= 0;
      else el.value = trouve[0].value;
      el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
      return { texte: decrire(el) + " = « " + trouve.map(function (x) { return x.textContent.trim(); }).join(", ") + " »" };
    }
    if (t === "input") {
      var type = (el.getAttribute("type") || "text").toLowerCase();
      if (type === "file") throw new Refus("FICHIER", "C'est un champ de fichier : utilise file_upload.");
      if (type === "checkbox" || type === "radio") {
        var veut = v === true || v === "true" || v === 1 || v === "on" || v === "checked" || v === "1";
        if (typeof v === "string" && type === "radio" && v === el.value) veut = true;
        if (el.checked !== veut) { if (type === "radio" && !veut) throw new Refus("ARGUMENT", "Un bouton radio ne se décoche pas : coche un autre choix du groupe."); el.click(); }
        return { texte: decrire(el) + (el.checked ? " : coché" : " : décoché") };
      }
      if (/^(date|time|datetime-local|month|week|color|range|number)$/.test(type)) {
        try { el.focus({ preventScroll: true }); } catch (e) {}
        poserValeur(el, String(v));
        if (String(el.value) !== String(v) && type !== "range" && type !== "color") return { texte: decrire(el) + " : la valeur « " + v + " » n'a pas été acceptée telle quelle (valeur actuelle : « " + el.value + " »). Vérifie le format attendu par ce type de champ (" + type + ")." };
        return { texte: decrire(el) + " = « " + el.value + " »" };
      }
    }
    if (t === "input" || t === "textarea") {
      try { el.focus({ preventScroll: true }); } catch (e) {}
      var fait = false;
      try { el.select(); fait = v === "" ? (document.execCommand("delete"), el.value === "") : document.execCommand("insertText", false, String(v)); } catch (e) {}
      if (!fait || el.value !== String(v)) poserValeur(el, String(v)); else el.dispatchEvent(new Event("change", { bubbles: true }));
      return { texte: decrire(el) + " = « " + propre(el.value, 120) + " »" };
    }
    if (el.isContentEditable) {
      el.focus();
      var rg = document.createRange(); rg.selectNodeContents(el);
      var s = getSelection(); s.removeAllRanges(); s.addRange(rg);
      var ok = false; try { ok = String(v) === "" ? document.execCommand("delete") : document.execCommand("insertText", false, String(v)); } catch (e) {}
      if (!ok) { el.textContent = String(v); el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(v) })); }
      return { texte: decrire(el) + " = « " + propre(el.textContent, 120) + " »" };
    }
    throw new Refus("PAS_UN_CHAMP", decrire(el) + " n'est pas un champ de formulaire. Pour cliquer, utilise computer (left_click) avec cette référence.");
  }

  // ------------------------------------------------------------------ fichiers
  function morceau(args) {
    (cs.tampons[args.id] = cs.tampons[args.id] || []).push(args.b64);
    return { n: cs.tampons[args.id].length };
  }
  function fabriquerFichiers(liste) {
    return liste.map(function (f) {
      var parts = (cs.tampons[f.id] || []).map(function (b64) {
        var bin = atob(b64), octets = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) octets[i] = bin.charCodeAt(i);
        return octets;
      });
      delete cs.tampons[f.id];
      return new File(parts, f.nom, { type: f.type || "application/octet-stream", lastModified: Date.now() });
    });
  }
  function deposer(args) {
    var fichiers = fabriquerFichiers(args.fichiers || []);
    if (!fichiers.length) throw new Refus("ARGUMENT", "Aucun fichier à déposer.");
    var dt = new DataTransfer();
    fichiers.forEach(function (f) { dt.items.add(f); });
    montrerVoyant();
    var noms = fichiers.map(function (f) { return f.name + " (" + f.size + " octets)"; }).join(", ");
    if (args.ref) {
      var el = elDe(args.ref);
      refuserSiCaptcha(el);
      var champ = tag(el) === "input" && el.type === "file" ? el : (tag(el) === "label" && el.control && el.control.type === "file" ? el.control : el.querySelector && el.querySelector('input[type="file"]'));
      if (champ) {
        if (!champ.multiple && fichiers.length > 1) throw new Refus("ARGUMENT", "Ce champ n'accepte qu'un fichier.");
        champ.files = dt.files;
        champ.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        champ.dispatchEvent(new Event("change", { bubbles: true }));
        return { texte: "Fichier" + (fichiers.length > 1 ? "s" : "") + " posé" + (fichiers.length > 1 ? "s" : "") + " dans " + decrire(champ) + " : " + noms };
      }
      var p = centre(el);
      return lacher(el, p[0], p[1], dt, noms);
    }
    if (!args.coordinate) throw new Refus("ARGUMENT", "Il faut `ref` ou `coordinate`.");
    var c = ciblePoint(Number(args.coordinate[0]), Number(args.coordinate[1]));
    refuserSiCaptcha(c.el);
    return lacher(c.el, c.x, c.y, dt, noms);
  }
  function lacher(el, x, y, dt, noms) {
    var evt = function (type) { return el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, dataTransfer: dt, view: window })); };
    evt("dragenter");
    var refuse = evt("dragover");
    if (refuse) { evt("dragleave"); return { texte: "Dépôt refusé : " + decrire(el) + " n'accepte pas les fichiers déposés (la page n'a pas répondu à « dragover »)." }; }
    evt("drop");
    rond(x, y);
    return { texte: "Déposé sur " + decrire(el) + " : " + noms };
  }

  // ------------------------------------------------------------------ JavaScript libre (javascript_tool)
  function enClair(v, niveau) {
    niveau = niveau || 0;
    if (v === undefined) return "undefined";
    if (v === null) return "null";
    var t = typeof v;
    if (t === "string") return niveau ? JSON.stringify(v) : v;
    if (t === "number" || t === "boolean" || t === "bigint") return String(v);
    if (t === "symbol") return v.toString();
    if (t === "function") return "[Function" + (v.name ? ": " + v.name : "") + "]";
    if (v instanceof Error) return (v.name || "Error") + ": " + v.message;
    if (typeof Node !== "undefined" && v instanceof Node) {
      if (v.nodeType === 1) { var h = v.outerHTML || ""; return h.length > 300 ? h.slice(0, 300) + "…" : h; }
      if (v.nodeType === 9) return "[Document " + (v.URL || "") + "]";
      return "[" + v.nodeName + "] " + propre(v.textContent, 100);
    }
    if (typeof Window !== "undefined" && v instanceof Window) return "[Window]";
    if (typeof NodeList !== "undefined" && (v instanceof NodeList || v instanceof HTMLCollection)) v = Array.prototype.slice.call(v);
    try {
      var vus = [];
      return JSON.stringify(v, function (cle, val) {
        if (typeof val === "bigint") return String(val) + "n";
        if (typeof val === "function") return "[Function]";
        if (val === undefined) return "[undefined]";
        if (typeof Node !== "undefined" && val instanceof Node) return enClair(val, 1);
        if (val instanceof Map) return { "[Map]": Array.from(val.entries()) };
        if (val instanceof Set) return { "[Set]": Array.from(val.values()) };
        if (typeof val === "object" && val !== null) { if (vus.indexOf(val) >= 0) return "[cycle]"; vus.push(val); }
        return val;
      }, 2);
    } catch (e) { try { return String(v); } catch (e2) { return "[illisible]"; } }
  }
  var FonctionAsync = Object.getPrototypeOf(async function () {}).constructor;
  function compilerAsync(code) {
    // « Dernière expression renvoyée » pour du code avec await : on cherche où mettre le return.
    try { return new FonctionAsync("return (" + code + "\n)"); } catch (e) {}
    var coupes = [];
    for (var i = code.length - 1; i >= 0; i--) if (code[i] === ";" || code[i] === "\n") coupes.push(i);
    for (var j = 0; j < coupes.length && j < 400; j++) {
      var tete = code.slice(0, coupes[j] + 1), queue = code.slice(coupes[j] + 1);
      if (!queue.trim() || /^\s*(const|let|var|if|for|while|do|switch|try|throw|return|function|class|import|export)\b/.test(queue)) continue;
      try { return new FonctionAsync(tete + "\nreturn (" + queue + "\n)"); } catch (e) {}
    }
    return new FonctionAsync(code);   // lève l'erreur de syntaxe d'origine si le code est faux
  }
  function evaluer(args) {
    var code = String(args.code), valeur;
    montrerVoyant();
    try { valeur = (0, eval)(code); }
    catch (e) {
      if (e instanceof SyntaxError && /await|async/i.test(code)) {
        try { valeur = compilerAsync(code)(); }
        catch (e2) { return { erreur: enClair(e2) + (e2.stack ? "\n" + String(e2.stack).split("\n").slice(0, 3).join("\n") : "") }; }
      } else return { erreur: enClair(e) + (e && e.stack ? "\n" + String(e.stack).split("\n").slice(0, 3).join("\n") : "") };
    }
    if (valeur && typeof valeur.then === "function") {
      var id = "p" + Date.now() + Math.random().toString(36).slice(2, 8);
      cs.promesses[id] = { fini: false };
      valeur.then(function (v) { cs.promesses[id] = { fini: true, valeur: enClair(v) }; },
        function (err) { cs.promesses[id] = { fini: true, erreur: enClair(err) + (err && err.stack ? "\n" + String(err.stack).split("\n").slice(0, 3).join("\n") : "") }; });
      return { attente: id };
    }
    return { valeur: enClair(valeur) };
  }
  function promesse(args) {
    var p = cs.promesses[args.id];
    if (!p) return { erreur: "Résultat perdu (la page a changé pendant l'attente)." };
    if (!p.fini) return { attente: args.id };
    delete cs.promesses[args.id];
    return p;
  }

  // ------------------------------------------------------------------ console et réseau
  function lireConsole(args) {
    var c = window.__csCapteur;
    if (!c) return { absent: true };
    var motif = null;
    if (args.pattern) { try { motif = new RegExp(args.pattern, "i"); } catch (e) { throw new Refus("ARGUMENT", "`pattern` n'est pas une expression régulière valide : " + e.message); } }
    var limite = args.limit > 0 ? args.limit : 100;
    var liste = c.console.filter(function (m) {
      if (args.onlyErrors && m.n !== "error" && m.n !== "exception") return false;
      return !motif || motif.test(m.m) || motif.test(m.n);
    });
    var total = liste.length;
    liste = liste.slice(-limite);
    var sortie = { mode: c.mode, depuis: c.depuis, total: total, perdus: c.perdus, messages: liste };
    if (args.clear) c.console.length = 0;
    return sortie;
  }
  function lireReseau(args) {
    var c = window.__csCapteur, liste = [];
    var vues = {};
    if (c) c.reseau.forEach(function (r) { liste.push(r); vues[r.url] = (vues[r.url] || 0) + 1; });
    var debut = performance.timeOrigin || 0, depuis = cs.reseauDepuis || 0;
    try {
      var nav = performance.getEntriesByType("navigation")[0];
      if (nav && debut + nav.startTime >= depuis) liste.push({ t: Math.round(debut + nav.startTime), methode: "GET", url: nav.name || location.href, type: "document", statut: nav.responseStatus || null, ms: Math.round(nav.duration), octets: nav.transferSize || null });
      performance.getEntriesByType("resource").forEach(function (e) {
        if (debut + e.startTime < depuis) return;
        if ((e.initiatorType === "fetch" || e.initiatorType === "xmlhttprequest") && vues[e.name]) { vues[e.name]--; return; }
        liste.push({ t: Math.round(debut + e.startTime), methode: "GET", url: e.name, type: e.initiatorType || "autre", statut: e.responseStatus || null, ms: Math.round(e.duration), octets: e.transferSize || null });
      });
    } catch (e) {}
    liste.sort(function (a, b) { return a.t - b.t; });
    if (args.urlPattern) liste = liste.filter(function (r) { return r.url.indexOf(args.urlPattern) >= 0; });
    var total = liste.length, limite = args.limit > 0 ? args.limit : 100;
    liste = liste.slice(-limite);
    if (args.clear) { if (c) c.reseau.length = 0; cs.reseauDepuis = Date.now(); try { performance.clearResourceTimings(); } catch (e) {} }
    return { mode: c ? c.mode : "absent", total: total, requetes: liste };
  }

  // ------------------------------------------------------------------ état
  function etat() {
    return { url: location.href, titre: document.title, pret: document.readyState, lw: innerWidth, lh: innerHeight,
      cw: document.documentElement.clientWidth, ch: document.documentElement.clientHeight, dpr: devicePixelRatio,
      sx: Math.round(scrollX), sy: Math.round(scrollY), capteur: window.__csCapteur ? window.__csCapteur.mode : "absent", visible: document.visibilityState };
  }

  function apercu(args) {
    var calme = Date.now() - cs.mutT;
    if (args.attendre && calme < args.attendre && document.readyState === "complete") return { calme: calme };
    if (args.attendre && document.readyState !== "complete") return { calme: 0 };
    var t = texte({ max_chars: args.texte || 1500 });
    var a = arbre({ filter: "interactive", max_chars: args.elements || 2500 });
    return { calme: calme, pret: true, url: location.href, titre: document.title, texte: t.texte, coupe: t.coupe, elements: a.texte };
  }

  var OPS = { voyant: function () { montrerVoyant(); return true; },
    ouvrirPanneau: function () { document.documentElement.setAttribute("data-cs-demande-panneau", String(Date.now())); return true; }, apercu: apercu, arbre: arbre, trouver: trouver, texte: texte, cliquer: cliquer, survoler: survoler, glisser: glisser, defiler: defiler,
    defilerVers: defilerVers, appuyer: appuyer, taper: taper, remplir: remplir, morceau: morceau, deposer: deposer, evaluer: evaluer,
    promesse: promesse, lireConsole: lireConsole, lireReseau: lireReseau, etat: etat, marques: marques, finMarques: finMarques,
    cacherVoyant: function (a) { return cacherVoyant(a.cache); }, voyant: function () { montrerVoyant(); return true; },
    coordonnees: function (a) { var el = elDe(a.ref); var p = centre(el); return { x: p[0], y: p[1], description: decrire(el) }; } };
  var SANS_ARRET = { apercu: 1, etat: 1, marques: 1, finMarques: 1, cacherVoyant: 1 };

  cs.appel = function (op, args) {
    try {
      if (cs.arrete && !SANS_ARRET[op]) return JSON.stringify({ ok: false, code: "ARRETE", erreur: "la personne a cliqué sur « Arrêter » dans cet onglet. Claude n'y touche plus. Dis-le-lui et attends sa consigne." });
      if (!OPS[op]) return JSON.stringify({ ok: false, code: "ARGUMENT", erreur: "Opération inconnue : " + op });
      return JSON.stringify({ ok: true, r: OPS[op](args || {}) });
    } catch (e) {
      if (e instanceof Refus) return JSON.stringify({ ok: false, code: e.code, erreur: e.message });
      return JSON.stringify({ ok: false, code: "JS_ERREUR", erreur: String(e && e.message || e) });
    }
  };
})();
