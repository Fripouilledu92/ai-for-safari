// Le bouton « Claude » de la barre d'outils ouvre ou ferme le panneau de L'ONGLET où l'on clique, et seulement de
// celui-là (comme le panneau de Claude in Chrome). L'état de chaque onglet est gardé ici, par numéro d'onglet, pour
// qu'il survive aux changements de page dans ce même onglet. Astre gris : fermé ; astre orange : ouvert.
var api = typeof browser !== "undefined" ? browser : chrome;

function lire(defauts) {
  return new Promise(function (ok) {
    var fini = false;
    function fin(r) { if (!fini) { fini = true; ok(r || defauts); } }
    try {
      var p = api.storage.local.get(defauts, fin);
      if (p && typeof p.then === "function") p.then(fin, function () { fin(defauts); });
    } catch (e) { fin(defauts); }
  });
}
function ouverts() { return lire({ ouverts: {} }).then(function (r) { return r.ouverts || {}; }); }
function icone(tabId, ouvert) {
  var nom = ouvert ? "icone" : "icone-gris";
  try { api.action.setIcon({ tabId: tabId, path: { "48": nom + "-48.png", "96": nom + "-96.png" } }); } catch (e) {}
}
function poser(tabId, ouvert) {
  return ouverts().then(function (o) {
    if (ouvert) o[tabId] = true; else delete o[tabId];
    icone(tabId, ouvert);
    return api.storage.local.set({ ouverts: o });
  }).then(function () {
    try { api.tabs.sendMessage(tabId, { claudeSafari: "ouvert", oui: !!ouvert }); } catch (e) {}
  });
}
function basculer(tabId) {
  if (tabId == null) return;
  return ouverts().then(function (o) { return poser(tabId, !o[tabId]); });
}

// L'ancien réglage commun à tous les onglets n'existe plus : on l'efface, sinon le panneau s'ouvrait partout.
try { api.storage.local.remove("ouvert"); } catch (e) {}

api.action.onClicked.addListener(function (tab) { basculer(tab && tab.id); });
if (api.commands && api.commands.onCommand) api.commands.onCommand.addListener(function (nom, tab) {
  if (nom !== "basculer-panneau") return;
  if (tab && tab.id != null) { basculer(tab.id); return; }
  try { api.tabs.query({ active: true, currentWindow: true }).then(function (t) { if (t[0]) basculer(t[0].id); }); } catch (e) {}
});
if (api.tabs && api.tabs.onRemoved) api.tabs.onRemoved.addListener(function (tabId) {
  delete billets[tabId]; delete citations[tabId];
  ouverts().then(function (o) { if (o[tabId]) { delete o[tabId]; api.storage.local.set({ ouverts: o }); } });
});

// --- Clé de l'extension : tirée au hasard une fois, gardée ici. Le programme local ne répond qu'à elle, une fois que la
// personne l'a reliée (fenêtre de macOS avec un code). Elle n'est donnée qu'au panneau que NOTRE script a ouvert dans
// l'onglet : il présente un numéro à usage unique, déposé juste avant par le script de la page (cadre principal).
// Une page qui chargerait panneau.html dans son propre cadre n'a pas ce numéro et n'obtient rien.
function cleExtension() {
  return lire({ cle: "" }).then(function (r) {
    if (r.cle && r.cle.length >= 32) return r.cle;
    var o = new Uint8Array(32); crypto.getRandomValues(o);
    var c = Array.prototype.map.call(o, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
    return api.storage.local.set({ cle: c }).then(function () { return c; });
  });
}
var suites = {};         // numéro d'onglet -> jeton du panneau qui vient de recevoir la clé
var billets = {};        // numéro d'onglet -> { n: numéro à usage unique, t: heure }
var citations = {};
var infos = {};          // numéro d'onglet -> titre et adresse de la page, pour l'en-tête du panneau      // numéro d'onglet -> passage choisi sur la page, en attente du panneau
var RACINE = api.runtime.getURL("");

api.runtime.onMessage.addListener(function (message, expediteur, repondre) {
  if (!message || !expediteur.tab) return;
  if (expediteur.id && expediteur.id !== api.runtime.id) return;
  var id = expediteur.tab.id;
  // Notre script de page ne tourne que dans le cadre principal : tout expéditeur d'un sous-cadre est une page de l'extension.
  var duPanneau = !!(expediteur.url && expediteur.url.indexOf(RACINE) === 0) || expediteur.frameId > 0;
  var deLaPage = !duPanneau && (expediteur.frameId === 0 || expediteur.frameId === undefined);   // notre script, cadre principal
  if (message.claudeSafari === "billet") {
    if (!deLaPage || typeof message.n !== "string" || message.n.length < 16) return;
    billets[id] = { n: message.n, t: Date.now() };
    repondre({ ok: true });
    return;
  }
  if (message.claudeSafari === "cle") {
    var b = billets[id];
    if (!duPanneau || !b || b.n !== message.n || Date.now() - b.t > 30000) { repondre({ erreur: "billet" }); return; }
    delete billets[id];                             // usage unique
    var o = new Uint8Array(16); crypto.getRandomValues(o);
    var jetonSuite = Array.prototype.map.call(o, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
    suites[id] = jetonSuite;
    cleExtension().then(function (c) {
      return lire({ preuve: "" }).then(function (r) { repondre({ cle: c, preuve: r.preuve || "", suite: jetonSuite }); });
    }).catch(function () { repondre({ erreur: "cle" }); });
    return true;
  }
  if (message.claudeSafari === "preuve-poser") {
    // Le secret par lequel l'app prouvera son identité : posé une fois, par le panneau qui vient de recevoir la clé.
    if (!duPanneau || !suites[id] || suites[id] !== message.suite || typeof message.s !== "string" || !/^[0-9a-f]{32,128}$/.test(message.s)) return;
    delete suites[id];
    lire({ preuve: "" }).then(function (r) { if (!r.preuve) api.storage.local.set({ preuve: message.s }); });
    return;
  }
  if (message.claudeSafari === "onglet-info") {
    if (!deLaPage) return;
    infos[id] = { titre: String(message.titre || "").slice(0, 300), url: String(message.url || "").slice(0, 2000) };
    return;
  }
  if (message.claudeSafari === "onglet-info-lire") { repondre(duPanneau ? (infos[id] || {}) : {}); return; }
  if (message.claudeSafari === "citation-poser") {
    if (!deLaPage) return;
    citations[id] = { texte: String(message.texte || "").slice(0, 8000), titre: String(message.titre || "").slice(0, 200), url: String(message.url || "").slice(0, 500), t: Date.now() };
    repondre({ ok: true });
    return;
  }
  if (message.claudeSafari === "citation-prendre") {
    var c = citations[id];
    delete citations[id];
    repondre(duPanneau && c && Date.now() - c.t < 60000 ? { citation: c } : {});
    return;
  }
  if (duPanneau) return;                            // le reste ne vient que de notre script de page
  if (message.claudeSafari === "suis-je-ouvert") {
    ouverts().then(function (o) { icone(id, !!o[id]); repondre({ ouvert: !!o[id] }); });
    return true;                                   // réponse asynchrone
  }
  if (message.claudeSafari === "basculer") {
    ouverts().then(function (o) { var oui = !o[id]; return poser(id, oui).then(function () { repondre({ ouvert: oui }); }); })
      .catch(function (e) { repondre({ erreur: String(e) }); });
    return true;
  }
  if (message.claudeSafari === "ouvrir") { poser(id, true).then(function () { repondre({ ouvert: true }); }); return true; }
  if (message.claudeSafari === "fermer") { poser(id, false).then(function () { repondre({ ouvert: false }); }); return true; }
  if (message.claudeSafari === "etat") { icone(id, !!message.ouvert); return; }
});

// --- « Demander à Claude » dans le menu du clic droit, en haut du menu de Safari (pas dans « Services ») : le texte
// choisi part dans le panneau de cet onglet, qui s'ouvre s'il était fermé.
var menus = api.contextMenus || api.menus;
if (menus) {
  var poserMenu = function () {
    try { menus.create({ id: "demander-claude", title: "Demander à Claude", contexts: ["selection"] }, function () { void (api.runtime && api.runtime.lastError); }); } catch (e) {}
  };
  try {
    var p = menus.removeAll();
    if (p && typeof p.then === "function") p.then(poserMenu, poserMenu); else poserMenu();
  } catch (e) { poserMenu(); }
  menus.onClicked.addListener(function (info, tab) {
    if (!info || info.menuItemId !== "demander-claude" || !tab || tab.id == null) return;
    citations[tab.id] = { texte: String(info.selectionText || "").slice(0, 8000), titre: String(tab.title || "").slice(0, 200), url: String(tab.url || "").slice(0, 500), t: Date.now() };
    try { api.tabs.sendMessage(tab.id, { claudeSafari: "demander-claude", texte: info.selectionText || "" }); } catch (e) {}
  });
}
