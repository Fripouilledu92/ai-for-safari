// Capteur de console et de réseau de « AI for Safari ».
// Le même fichier sert deux fois :
//  - dans l'extension Safari, posé au tout début de chaque document (mode "document") : il voit tout ;
//  - injecté par le serveur après coup (mode "tardif") : il ne voit que ce qui arrive après.
// Il ne fait qu'écouter et ranger dans la page. Il n'envoie rien nulle part.
(function (mode) {
  "use strict";
  if (window.__csCapteur) return;
  var MAX = 1000;
  var capteur = { mode: mode, depuis: Date.now(), console: [], reseau: [], perdus: 0 };
  try { Object.defineProperty(window, "__csCapteur", { value: capteur, enumerable: false, configurable: true }); }
  catch (e) { window.__csCapteur = capteur; }

  function ranger(liste, objet) {
    liste.push(objet);
    if (liste.length > MAX) { liste.shift(); capteur.perdus++; }
  }

  function enTexte(v, niveau) {
    try {
      if (typeof v === "string") return v;
      if (v === undefined) return "undefined";
      if (v === null) return "null";
      if (typeof v === "function") return "function " + (v.name || "") + "()";
      if (v instanceof Error) return (v.name || "Error") + ": " + v.message + (v.stack ? "\n" + String(v.stack).split("\n").slice(0, 4).join("\n") : "");
      if (typeof Node !== "undefined" && v instanceof Node) {
        if (v.nodeType === 1) return "<" + v.tagName.toLowerCase() + (v.id ? "#" + v.id : "") + ">";
        return v.nodeName;
      }
      if (typeof v === "object") {
        if (niveau > 1) return Array.isArray(v) ? "[…]" : "{…}";
        var vus = [];
        return JSON.stringify(v, function (cle, val) {
          if (typeof val === "object" && val !== null) { if (vus.indexOf(val) >= 0) return "[cycle]"; vus.push(val); }
          if (typeof val === "bigint") return String(val) + "n";
          if (typeof val === "function") return "function";
          return val;
        });
      }
      return String(v);
    } catch (e) { return "[illisible]"; }
  }

  function message(args) {
    var morceaux = [];
    for (var i = 0; i < args.length; i++) morceaux.push(enTexte(args[i], 0));
    var m = morceaux.join(" ");
    return m.length > 4000 ? m.slice(0, 4000) + "… [coupé]" : m;
  }

  // --- Console ---
  ["log", "info", "warn", "error", "debug", "trace"].forEach(function (niveau) {
    var origine = console[niveau];
    if (typeof origine !== "function") return;
    console[niveau] = function () {
      try { ranger(capteur.console, { t: Date.now(), n: niveau, m: message(arguments), u: location.href }); } catch (e) {}
      return origine.apply(this, arguments);
    };
  });
  var affirmer = console.assert;
  if (typeof affirmer === "function") {
    console.assert = function (condition) {
      if (!condition) {
        try { ranger(capteur.console, { t: Date.now(), n: "error", m: "Assertion failed: " + message(Array.prototype.slice.call(arguments, 1)), u: location.href }); } catch (e) {}
      }
      return affirmer.apply(this, arguments);
    };
  }

  window.addEventListener("error", function (e) {
    try {
      if (e.target && e.target !== window && e.target.nodeType === 1) {
        var src = e.target.src || e.target.href || "";
        ranger(capteur.console, { t: Date.now(), n: "error", m: "Échec de chargement : <" + e.target.tagName.toLowerCase() + "> " + src, u: location.href });
      } else {
        var ou = e.filename ? " (" + e.filename + ":" + e.lineno + ":" + e.colno + ")" : "";
        ranger(capteur.console, { t: Date.now(), n: "exception", m: (e.error ? enTexte(e.error, 0) : String(e.message)) + ou, u: location.href });
      }
    } catch (x) {}
  }, true);

  window.addEventListener("unhandledrejection", function (e) {
    try { ranger(capteur.console, { t: Date.now(), n: "exception", m: "Promesse rejetée sans traitement : " + enTexte(e.reason, 0), u: location.href }); } catch (x) {}
  });

  // --- Réseau ---
  function absolue(u) { try { return new URL(String(u), location.href).href; } catch (e) { return String(u); } }

  var fetchOrigine = window.fetch;
  if (typeof fetchOrigine === "function") {
    window.fetch = function (entree, options) {
      var debut = Date.now(), fiche = null;
      try {
        var url = (typeof Request !== "undefined" && entree instanceof Request) ? entree.url : entree;
        var methode = (options && options.method) || ((typeof Request !== "undefined" && entree instanceof Request) ? entree.method : "GET");
        fiche = { t: debut, methode: String(methode).toUpperCase(), url: absolue(url), type: "fetch", statut: null, ms: null };
        ranger(capteur.reseau, fiche);
      } catch (e) {}
      var promesse = fetchOrigine.apply(this, arguments);
      if (fiche && promesse && typeof promesse.then === "function") {
        promesse.then(function (r) { fiche.statut = r.status; fiche.ms = Date.now() - debut; },
          function (err) { fiche.statut = 0; fiche.erreur = String(err && err.message || err); fiche.ms = Date.now() - debut; });
      }
      return promesse;
    };
  }

  if (typeof XMLHttpRequest !== "undefined") {
    var ouvrir = XMLHttpRequest.prototype.open, envoyer = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (methode, url) {
      try { this.__csFiche = { t: 0, methode: String(methode).toUpperCase(), url: absolue(url), type: "xhr", statut: null, ms: null }; } catch (e) {}
      return ouvrir.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      var fiche = this.__csFiche, xhr = this;
      if (fiche) {
        fiche.t = Date.now();
        ranger(capteur.reseau, fiche);
        this.addEventListener("loadend", function () { fiche.statut = xhr.status; fiche.ms = Date.now() - fiche.t; });
      }
      return envoyer.apply(this, arguments);
    };
  }
})(/*MODE*/"document");
