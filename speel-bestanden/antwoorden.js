// @ts-check
// Feature 259 — het telscript van de antwoordpagina /quiz/<slug>/antwoorden/. Geen spel, geen opslag.
// ⛔ Constitutie, sectie Web Round (principe IV): een los bestand met @ts-check, getoetst met tsc --checkJs (D2).
// ⛔ Tellen blokkeert nooit en verandert niets aan de pagina: zonder dit script werken de uitklappers gewoon.
// Telt (contracts/tel.md): `lees` bij het openen, `antwoord` bij de eerste uitklapper in dit bezoek, `doorspeel` bij
// een tik naar de speelpagina. Alle drie met de hostnaam van de verwijzer; de server bewaart alleen de groep.
(function () {
  "use strict";

  /** @type {{ pagina: string }} */
  var G;
  try {
    G = JSON.parse(/** @type {HTMLElement} */ (document.getElementById("gegevens")).textContent || "{}");
  } catch (e) { return; }
  if (!G || typeof G.pagina !== "string") return;

  var VERWIJZER = (function () {
    try { return document.referrer ? new URL(document.referrer).hostname : ""; } catch (e) { return ""; }
  })();

  /** @param {"lees" | "antwoord" | "doorspeel"} stap */
  function tel(stap) {
    try {
      fetch("/w/tel", {
        method: "POST", keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pagina: G.pagina, stap: stap, verwijzer: VERWIJZER }),
      }).catch(function () {});
    } catch (e) { /* niets */ }
  }

  tel("lees");

  var antwoordGeteld = false;
  document.querySelectorAll("details").forEach(function (d) {
    d.addEventListener("toggle", function () {
      if (d.open && !antwoordGeteld) { antwoordGeteld = true; tel("antwoord"); }
    });
  });

  var doorGeteld = false;
  document.querySelectorAll("a.speel-link").forEach(function (a) {
    a.addEventListener("click", function () {
      if (!doorGeteld) { doorGeteld = true; tel("doorspeel"); }
    });
  });
})();
