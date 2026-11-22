// Secours pour les versions de Safari qui ne savent pas lancer un script d'extension dans le monde de la page :
// on y pose le capteur par une balise <script>. S'il y est déjà, il ne fait rien.
(function () {
  var api = typeof browser !== "undefined" ? browser : chrome;
  var s = document.createElement("script");
  s.src = api.runtime.getURL("capteur.js");
  s.onload = function () { s.remove(); };
  (document.documentElement || document.head).appendChild(s);
})();
