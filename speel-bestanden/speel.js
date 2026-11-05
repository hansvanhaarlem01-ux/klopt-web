// @ts-check
// Feature 150 — het spel van de webronde. Geen bouwstap, geen extern verzoek, geen cookie.
// Contract: specs/150-webronde-instroom/contracts/webronde-api.md. Grondwet 7.9.0, sectie Web Round.
//
// ⛔ Getallen gekopieerd uit src/utils/constants.ts (de site heeft geen bouwstap). Wijzigt daar iets, wijzig dan hier.
// ⛔ Alles in localStorage staat in try/catch: zonder opslag werkt de ronde, alleen zonder hervatten.
// ⛔ Antwoorden blijven in de browser tot het inleveren; ×1,5 is alleen weergave, er hangt niets aan.
(function () {
  "use strict";

  var SPEELTIJD_S = 600;      // constants.ts sessionTimer
  var GRACE_MS = 8000;        // constants.ts honestyGraceMs
  var STRAF_S = 120;          // constants.ts honestyTimePenaltySec
  var BONUS = 1.5;            // constants.ts honestyMultiplier

  /** @returns {any} */
  function $(id) { return document.getElementById(id); }
  /** @returns {any} */
  function maak(tag, klas, tekst) {
    var e = document.createElement(tag);
    if (klas) e.className = klas;
    if (tekst !== undefined && tekst !== null) e.textContent = tekst;
    return e;
  }

  /** @type {any} */
  var G = JSON.parse($("gegevens").textContent);
  var SLEUTEL = "klopt-webronde-" + G.slug;

  /** @type {any} */
  var stand = null; // { vragen, intro, titel, eindtijd, antwoorden, weggaan, bonus, weg_op, huidig, uitslag }
  var klokTimer = 0;
  var bezig = false;

  // --- Opslag ------------------------------------------------------------------------------------------------------
  function bewaar() {
    try { localStorage.setItem(SLEUTEL, JSON.stringify(stand)); } catch (e) { /* zonder opslag gaat het ook */ }
  }
  function laad() {
    try {
      var r = localStorage.getItem(SLEUTEL);
      return r ? JSON.parse(r) : null;
    } catch (e) { return null; }
  }

  // --- Server ------------------------------------------------------------------------------------------------------
  function post(pad, body) {
    return fetch("/w/" + pad, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  /** ⛔ Tellen blokkeert nooit. */
  function tel(stap) {
    try {
      fetch("/w/tel", {
        method: "POST", keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pagina: G.pagina, stap: stap }),
      }).catch(function () {});
    } catch (e) { /* niets */ }
  }

  // --- Schermen ----------------------------------------------------------------------------------------------------
  function toon(id) {
    ["vooraf", "uit", "intro", "spel", "afrond", "wacht", "fout", "uitslag"].forEach(function (s) { $(s).hidden = s !== id; });
    // De klok loopt door op het afrondscherm: ook daar moet de speler hem zien.
    $("balk").hidden = id !== "spel" && id !== "afrond";
    if (id === "wacht") startGlas(); else stopGlas();
    window.scrollTo(0, 0);
  }

  function resterend() { return Math.max(0, Math.ceil((stand.eindtijd - Date.now()) / 1000)); }

  function tekenKlok() {
    var s = resterend();
    var m = Math.floor(s / 60);
    var k = $("klok");
    k.textContent = m + ":" + String(s % 60).padStart(2, "0");
    k.className = s <= 60 ? "klok bijna" : "klok";
    // ⛔ Dezelfde woorden als src/components/round/HonestyBadge.tsx.
    $("bonus").textContent = stand.bonus ? "Eerlijkheidsbonus actief" : "Eerlijkheidsbonus verloren";
    if (s <= 0) inleveren();
  }

  // --- Tekeningen --------------------------------------------------------------------------------------------------
  // ⛔ Omgezet uit src/components/round/Kroonkurk.tsx (085, 095) en src/components/common/Bierglas.tsx (099). Wijzigt
  //    daar een maat of lichtwaarde, wijzig die dan ook hier. De lichtwaarden zijn in de app nagerekend op leesbaarheid
  //    van het cijfer: niet op het oog bijstellen.
  var SVG_NS = "http://www.w3.org/2000/svg";
  var f = function (/** @type {number} */ n) { return Number(n.toFixed(3)); };
  var HOEK = (158 * Math.PI) / 180; // VERLOOP_HOEK in src/styles/verloop.ts
  var DX = Math.sin(HOEK) / 2;
  var DY = -Math.cos(HOEK) / 2;
  var mag_bewegen = !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  /** Een svg-element. `stijl` gaat in het style-attribuut: `var(--…)` werkt niet in een presentatie-attribuut. */
  function s(tag, attr, kinderen) {
    var e = document.createElementNS(SVG_NS, tag);
    Object.keys(attr || {}).forEach(function (k) {
      e.setAttribute(k === "stijl" ? "style" : k, String(attr[k]));
    });
    (kinderen || []).forEach(function (k) { if (k) e.appendChild(k); });
    return e;
  }
  function stop(offset, kleur, alfa) {
    return s("stop", {
      offset: offset,
      stijl: "stop-color:var(--" + kleur + ");stop-opacity:" + (alfa === undefined ? 1 : alfa),
    });
  }
  function cirkelPad(cx, cy, r) {
    return "M " + f(cx - r) + " " + f(cy) + " a " + f(r) + " " + f(r) + " 0 1 0 " + f(r * 2) + " 0 a " + f(r) + " " + f(r) + " 0 1 0 " + f(-r * 2) + " 0 Z";
  }

  // De kurk. Maten als fractie van de doorsnede, zie KURK in Kroonkurk.tsx.
  var DOP = 38;
  var KURK_MARGE = 5;
  var R = DOP / 2;
  var BULT = DOP * 0.067;
  var BULT_STRAAL = R - BULT;
  var KERN = BULT_STRAAL + BULT * 0.2;
  var KOP = DOP * 0.38;
  var RING = DOP * 0.05;
  var HALS = DOP * 0.86;
  var KURK_LICHT = {
    plooi: 0.38, kopRand: 0.22, kopBoog: [1.22, 1.62], schaduw: 0.55,
    glans: { afstand: 0.78, hoek: 250, rx: 0.4, ry: 0.14, draai: -20, alfa: 0.32 },
    halsRand: 0.28, halsSchaduw: 0.5, halsGlans: 0.42,
  };
  var BULTEN = [];
  for (var bi = 0; bi < 21; bi++) {
    var bh = (2 * Math.PI * bi) / 21;
    BULTEN.push({ x: R + BULT_STRAAL * Math.sin(bh), y: R - BULT_STRAAL * Math.cos(bh), h: bh });
  }
  // ⭐ Alle cirkels draaien dezelfde kant op: met `nonzero` is dit één vereniging, zonder naden.
  var RAND_PAD = BULTEN.map(function (b) { return cirkelPad(b.x, b.y, BULT); }).join(" ") + " " + cirkelPad(R, R, KERN);

  /** De verlopen staan één keer op de pagina: het krat wordt bij elke wijziging opnieuw getekend. */
  function zetVerlopen() {
    var boven = [R - DX * DOP, R - DY * DOP];
    var onder = [R + DX * DOP, R + DY * DOP];
    var g = KURK_LICHT.glans.alfa;
    document.body.appendChild(s("svg", { width: 0, height: 0, "aria-hidden": "true", stijl: "position:absolute" }, [
      s("defs", {}, [
        s("radialGradient", { id: "kurk-s", cx: "50%", cy: "50%", r: "50%" }, [stop(0, "zwart", KURK_LICHT.schaduw), stop(1, "zwart", 0)]),
        s("linearGradient", { id: "kurk-b", gradientUnits: "userSpaceOnUse", x1: f(boven[0]), y1: f(boven[1]), x2: f(onder[0]), y2: f(onder[1]) }, [stop(0, "koper"), stop(1, "koperDiep")]),
        s("radialGradient", { id: "kurk-k", cx: "50%", cy: "50%", r: "62%", fx: "34%", fy: "30%" }, [stop(0, "kroonkurk"), stop(1, "koperDiep")]),
        s("radialGradient", { id: "kurk-g", cx: "50%", cy: "50%", r: "50%" }, [stop(0, "schuim", g), stop(1, "schuim", 0)]),
        s("linearGradient", { id: "hals-r", x1: "0%", y1: "0%", x2: "100%", y2: "100%" }, [stop(0, "schuim", KURK_LICHT.halsRand), stop(0.5, "schuim", 0)]),
        // ⛔ Het licht valt hier rechtsonder, omgekeerd aan de kurk: dat maakt het een holte en geen bolling.
        s("radialGradient", { id: "hals-b", cx: "50%", cy: "50%", r: "60%", fx: "64%", fy: "68%" }, [stop(0, "koperLicht"), stop(1, "koperDiep")]),
        s("radialGradient", { id: "hals-s", cx: "58%", cy: "60%", r: "56%" }, [stop(0.62, "zwart", 0), stop(1, "zwart", KURK_LICHT.halsSchaduw)]),
      ]),
    ]));
  }

  /** Een dichte kroonkurk: de vraag heeft nog geen antwoord. Geen schaduw bij de vliegende: die tolt. */
  function kurkTekening(schaduw) {
    var maat = DOP + KURK_MARGE * 2;
    var delen = [];
    if (schaduw) delen.push(s("ellipse", { cx: R + 1.2, cy: R + 2.4, rx: R + 2.6, ry: R + 2.2, fill: "url(#kurk-s)" }));
    delen.push(s("path", { d: RAND_PAD, fill: "url(#kurk-b)" }));
    // Een lichtpuntje op elke plooi die naar de lamp (linksboven) kijkt.
    BULTEN.forEach(function (b) {
      var t = Math.max(0, Math.cos(b.h + Math.PI / 4));
      if (t < 0.05) return;
      delen.push(s("circle", {
        cx: f(b.x - Math.SQRT1_2 * BULT * 0.35), cy: f(b.y - Math.SQRT1_2 * BULT * 0.35), r: f(BULT * 0.45),
        stijl: "fill:var(--schuim);fill-opacity:" + f(KURK_LICHT.plooi * t),
      }));
    });
    // ⛔ De ring maakt van een koekje een kroonkurk.
    delen.push(s("circle", { cx: R, cy: R, r: f(KOP + RING / 2), fill: "none", "stroke-width": f(RING), stijl: "stroke:var(--night)" }));
    delen.push(s("circle", { cx: R, cy: R, r: f(KOP), fill: "url(#kurk-k)" }));
    var a = KOP - 0.45;
    var p1 = [R + a * Math.cos(Math.PI * KURK_LICHT.kopBoog[0]), R + a * Math.sin(Math.PI * KURK_LICHT.kopBoog[0])];
    var p2 = [R + a * Math.cos(Math.PI * KURK_LICHT.kopBoog[1]), R + a * Math.sin(Math.PI * KURK_LICHT.kopBoog[1])];
    delen.push(s("path", {
      d: "M " + f(p1[0]) + " " + f(p1[1]) + " A " + f(a) + " " + f(a) + " 0 0 1 " + f(p2[0]) + " " + f(p2[1]),
      fill: "none", "stroke-width": 0.9, "stroke-linecap": "round",
      stijl: "stroke:var(--schuim);stroke-opacity:" + KURK_LICHT.kopRand,
    }));
    var g = KURK_LICHT.glans;
    var gh = (g.hoek * Math.PI) / 180;
    var gx = f(R + g.afstand * KOP * Math.cos(gh));
    var gy = f(R + g.afstand * KOP * Math.sin(gh));
    delen.push(s("ellipse", {
      cx: gx, cy: gy, rx: f(g.rx * KOP), ry: f(g.ry * KOP),
      transform: "rotate(" + g.draai + " " + gx + " " + gy + ")", fill: "url(#kurk-g)",
    }));
    return s("svg", {
      width: maat, height: maat, viewBox: -KURK_MARGE + " " + -KURK_MARGE + " " + maat + " " + maat, "aria-hidden": "true",
    }, delen);
  }

  /** Een open flessenhals: de vraag heeft een antwoord. ⛔ Het bier is lichter dan de kurk, anders leest een gat als leeg. */
  function openHals() {
    var r = HALS / 2;
    var gx = f(HALS - HALS * 0.25 - HALS * 0.11);
    var gy = f(HALS * 0.27 + HALS * 0.075);
    return s("svg", { width: f(HALS), height: f(HALS), viewBox: "0 0 " + f(HALS) + " " + f(HALS), "aria-hidden": "true" }, [
      s("circle", { cx: f(r), cy: f(r), r: f(r), stijl: "fill:var(--koper)" }),
      s("circle", { cx: f(r), cy: f(r), r: f(r - HALS * 0.045), fill: "none", stroke: "url(#hals-r)", "stroke-width": f(HALS * 0.09) }),
      s("circle", { cx: f(r), cy: f(r), r: f(r - HALS * 0.09), stijl: "fill:var(--night)" }),
      s("circle", { cx: f(r), cy: f(r), r: f(r - HALS * 0.18), fill: "url(#hals-b)" }),
      s("circle", { cx: f(r), cy: f(r), r: f(r - HALS * 0.18), fill: "url(#hals-s)" }),
      s("ellipse", {
        cx: gx, cy: gy, rx: f(HALS * 0.11), ry: f(HALS * 0.075), transform: "rotate(-24 " + gx + " " + gy + ")",
        stijl: "fill:var(--schuim);fill-opacity:" + KURK_LICHT.halsGlans,
      }),
    ]);
  }

  // De vlucht: VliegendeKurk.tsx. ⛔ De eindtoestand hangt hier niet aan: de hals staat er omdat de vraag is ingevuld,
  // dus een vlucht die niet start of wordt afgebroken laat altijd het juiste beeld achter.
  var VLUCHT_MS = 460;
  var SPREIDING_MS = 80;
  var VLUCHT = [
    { offset: 0, transform: "translate(0px,0px) rotate(0deg) scale(1)", opacity: 1 },
    { offset: 0.196, transform: "translate(3px,-10px) rotate(14deg) scale(1)", opacity: 1 },
    { offset: 0.435, transform: "translate(16px,-52px) rotate(250deg) scale(0.78)", opacity: 1 },
    { offset: 0.717, transform: "translate(31px,-96px) rotate(560deg) scale(0.5)", opacity: 0.55 },
    { offset: 1, transform: "translate(42px,-128px) rotate(760deg) scale(0.3)", opacity: 0 },
  ];
  function laatVliegen(vak, vertraging) {
    if (!mag_bewegen || !vak) return;
    var laag = $("krat-laag");
    var opLaag = laag.getBoundingClientRect();
    var opVak = vak.getBoundingClientRect();
    var maat = DOP + KURK_MARGE * 2;
    var d = maak("div", "vlieger");
    d.style.left = opVak.left - opLaag.left + (opVak.width - maat) / 2 + "px";
    d.style.top = opVak.top - opLaag.top + (opVak.height - maat) / 2 + "px";
    d.appendChild(kurkTekening(false));
    if (typeof d.animate !== "function") return;
    laag.appendChild(d);
    var a = d.animate(VLUCHT, { duration: VLUCHT_MS, delay: vertraging, easing: "cubic-bezier(0.22,0.7,0.3,1)", fill: "both" });
    a.onfinish = a.oncancel = function () { d.remove(); };
  }

  function isLeeg(v) {
    var a = stand.antwoorden[v.id];
    if (a === undefined || a === "") return true;
    if (v.type === "meervoud") {
      try { return JSON.parse(a).every(function (x) { return !String(x).trim(); }); } catch (e) { return true; }
    }
    return !String(a).trim();
  }

  function openVragen() {
    var open = [];
    stand.vragen.forEach(function (v, i) { if (isLeeg(v)) open.push(i); });
    return open;
  }

  // ⛔ Bij het openen van het spelscherm geldt alles als gezien: een hervatte ronde laat geen kurken wegvliegen.
  // Een gewist antwoord krijgt zijn kurk terug zonder vlucht (besluit in Kratje.tsx).
  /** @type {boolean[] | null} */
  var vorigeLeeg = null;
  var kratSleutel = "";

  function tekenKrat() {
    var leeg = stand.vragen.map(isLeeg);
    var sleutel = leeg.join() + "|" + stand.huidig;
    var open = leeg.filter(Boolean).length;
    // De regel van src/utils/afgeefknop.ts: op de laatste vraag altijd, daarvoor alleen bij een vol kratje.
    $("inleveren").hidden = !(stand.huidig === stand.vragen.length - 1 || open === 0);
    tekenLat(leeg, open);
    if (sleutel === kratSleutel) return;
    kratSleutel = sleutel;

    var krat = $("krat");
    krat.replaceChildren();
    /** @type {any[]} */
    var knoppen = [];
    stand.vragen.forEach(function (v, i) {
      var b = maak("button", "vakje" + (i === stand.huidig ? " nu" : ""));
      b.type = "button";
      b.setAttribute("aria-label", "Vraag " + v.nummer + (leeg[i] ? ", nog leeg" : ", ingevuld"));
      if (i === stand.huidig) b.setAttribute("aria-current", "true");
      if (leeg[i]) {
        b.appendChild(kurkTekening(true));
        b.appendChild(maak("span", "nr", v.nummer));
      } else {
        b.appendChild(openHals());
      }
      b.addEventListener("click", function () { naar(i); });
      krat.appendChild(b);
      knoppen.push(b);
    });
    $("krat-tel").textContent = (stand.vragen.length - open) + " van de " + stand.vragen.length + " ingevuld";

    if (vorigeLeeg) {
      var n = 0;
      for (var i = 0; i < leeg.length; i++) {
        if (vorigeLeeg[i] && !leeg[i]) {
          // Ingeklapt is er geen krat om uit te vliegen: de kurk wacht tot het toetsenbord dicht is.
          if (ingeklapt) { if (wachtend.indexOf(i) === -1) wachtend.push(i); }
          else laatVliegen(knoppen[i], n++ * SPREIDING_MS);
        } else if (!vorigeLeeg[i] && leeg[i]) {
          // ⛔ Antwoord gewist: de kurk komt terug zonder vlucht, en een wachtende voor dit vak vervalt.
          wachtend = wachtend.filter(function (x) { return x !== i; });
        }
      }
    }
    vorigeLeeg = leeg;
  }

  // --- De lat: de ingeklapte vorm van het krat (Kratje.tsx) -----------------------------------------------------------
  // ⛔ Alleen op een touchscherm: daar neemt het toetsenbord de ruimte in. Een computer heeft die ruimte wel.
  var heeftToetsenbord = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  var ingeklapt = false;
  /** @type {number[]} */
  var wachtend = [];
  var uitklapTimer = 0;

  function tekenLat(leeg, open) {
    var streep = $("lat-streep");
    streep.replaceChildren();
    leeg.forEach(function (/** @type {boolean} */ l, /** @type {number} */ i) {
      streep.appendChild(maak("span", "streepje" + (l ? "" : " vol") + (i === stand.huidig ? " nu" : "")));
    });
    var gevuld = leeg.length - open;
    $("lat-tel").textContent = gevuld + "/" + leeg.length;
    $("lat").setAttribute("aria-label", "Vraag " + (stand.huidig + 1) + " van " + leeg.length + ", " + gevuld + " ingevuld");
  }

  function zetIngeklapt(aan) {
    if (ingeklapt === aan) return;
    ingeklapt = aan;
    $("krat-blok").hidden = aan;
    $("lat").hidden = !aan;
    // ⭐ Logo, titel en voettekst weg tijdens het typen: dan staat het veld boven het toetsenbord en hoeft een iPhone de
    // pagina niet omhoog te schuiven, met witruimte eronder (gemeten door de eigenaar 05-11).
    document.body.classList.toggle("typt", aan);
    // Begint krap: de ruimte is pas bekend als het toetsenbord er staat, en dan wordt het zo nodig ruimer (kiesDichtheid).
    document.body.classList.toggle("krap", aan);
    if (aan) return;
    // ⭐ Pas nu staat het krat op zijn plek, en is de vertrekplek van de kurk bekend.
    var rij = wachtend;
    wachtend = [];
    var knoppen = $("krat").children;
    rij.forEach(function (i, n) { laatVliegen(knoppen[i], n * SPREIDING_MS); });
  }

  function isInvoer(e) { return !!e && e.tagName === "INPUT"; }

  /**
   * ⭐ Alleen krap als het moet. Een iPhone houdt ~318 px over en een grote Android ~464 px: daar gaf de krappe vorm
   * ruim beeld met niets erin (gemeten door de eigenaar 05-11).
   */
  function kiesDichtheid(inp, hoogte) {
    document.body.classList.remove("krap");
    if (inp.getBoundingClientRect().bottom + window.scrollY + 12 > hoogte) document.body.classList.add("krap");
  }

  /** Terug naar boven, tenzij het veld dan achter het toetsenbord valt (een lange vraag of een foto). */
  function zetVeldInBeeld(inp) {
    if (!ingeklapt || !inp || !inp.isConnected) return;
    /** @type {any} */
    var vv = window.visualViewport;
    var hoogte = vv ? vv.height : window.innerHeight;
    window.scrollTo(0, 0);
    var onder = inp.getBoundingClientRect().bottom + 12;
    if (onder > hoogte) window.scrollTo(0, onder - hoogte);
  }

  function volgToetsenbord() {
    if (!heeftToetsenbord) return;
    var vraag = $("vraag");
    vraag.addEventListener("focusin", function (/** @type {any} */ e) {
      if (!isInvoer(e.target)) return;
      clearTimeout(uitklapTimer);
      zetIngeklapt(true);
      // Het toetsenbord schuift nog in beeld; een iPhone zet de pagina pas dan op zijn plek. Daarom twee keer.
      [60, 350].forEach(function (ms) { window.setTimeout(function () { zetVeldInBeeld(e.target); }, ms); });
    });
    // ⭐ Pas als het toetsenbord er echt staat, is bekend hoeveel ruimte er over is.
    /** @type {any} */
    var vv = window.visualViewport;
    if (!vv) return;
    var hoogsteBeeld = vv.height;
    vv.addEventListener("resize", function () {
      hoogsteBeeld = Math.max(hoogsteBeeld, vv.height);
      var inp = document.activeElement;
      if (!isInvoer(inp) || $("spel").hidden) return;
      // ⛔ Op Android sluit de pijl het toetsenbord terwijl het veld actief blijft (gemeten 05-11): zonder deze regel
      // komt het krat niet terug. De schermhoogte zegt het, de focus niet. Tik daarna opnieuw in het veld: zelfde weg.
      var toetsenbordOpen = vv.height < hoogsteBeeld * 0.8;
      zetIngeklapt(toetsenbordOpen);
      if (toetsenbordOpen) { kiesDichtheid(inp, vv.height); zetVeldInBeeld(inp); }
    });
    ["pointerdown", "pointerup", "touchstart", "touchend", "click"].forEach(function (soort) {
      document.addEventListener(soort, onthoudTik, true);
    });
    vraag.addEventListener("focusout", function (/** @type {any} */ e) {
      clearTimeout(uitklapTimer);
      var inp = e.target;
      var vinkje = isInvoer(inp) && doorVinkje(e);
      var verder = vinkje && vinkjeGaatDoor(inp);
      zelfGesloten = false;
      // ⚠️ Niet meteen: wie *Volgende* aantikt terwijl het toetsenbord open is, verliest hier de focus. Klapt het krat
      // dan direct uit, dan schuift de knop onder zijn vinger weg en valt de tik ernaast. Ook van veld naar veld
      // (meervoud) blijft het zo ingeklapt.
      uitklapTimer = window.setTimeout(function () {
        if (isInvoer(document.activeElement)) return;
        zetIngeklapt(false);
        if (verder) naar(stand.huidig + 1);
      }, 250);
    });
  }

  function zetAntwoord(v, waarde) {
    stand.antwoorden[v.id] = waarde;
    bewaar();
  }

  function veld(labelTekst, waarde, invoerType, opInvoer) {
    // ⛔ Een formulier en geen losse toetsvang: op een iPhone komt Enter in een los veld niet betrouwbaar binnen
    // (gemeten door de eigenaar 05-11). Via `submit` werkt het overal, ook tijdens woordsuggesties.
    var w = maak("form", "veld");
    w.noValidate = true;
    w.addEventListener("submit", function (/** @type {any} */ e) {
      e.preventDefault();
      enterInVeld(inp);
    });
    var id = "i" + Math.random().toString(36).slice(2);
    var l = maak("label", "", labelTekst);
    l.htmlFor = id;
    var inp = maak("input");
    inp.id = id;
    inp.value = waarde;
    inp.maxLength = 250;
    inp.autocomplete = "off";
    inp.setAttribute("autocapitalize", "off");
    inp.spellcheck = false;
    if (invoerType === "getal" || invoerType === "jaartal") inp.inputMode = "decimal";
    inp.enterKeyHint = "next";
    inp.addEventListener("input", function () { opInvoer(inp.value); tekenKrat(); });
    w.appendChild(l);
    w.appendChild(inp);
    return w;
  }

  // Enter doet wat *Volgende* doet (besluit eigenaar 05-11). Bij meerdere velden eerst het volgende veld, anders slaat
  // de speler de rest van de vraag over. Op de laatste vraag is er geen *Volgende*: dan alleen het toetsenbord dicht.
  function enterInVeld(inp) {
    var velden = Array.prototype.slice.call(document.querySelectorAll("#vraag input"));
    var hier = velden.indexOf(inp);
    if (hier >= 0 && hier < velden.length - 1) { velden[hier + 1].focus(); return; }
    zelfGesloten = true;
    inp.blur();
    if (stand.huidig < stand.vragen.length - 1) naar(stand.huidig + 1);
  }

  // Het vinkje boven het iPhone-toetsenbord (besluit eigenaar 05-11: gedraagt zich als *Volgende*). Het sluit alleen het
  // toetsenbord en meldt zich verder niet; het is dus te herkennen als: veld los, zonder dat er op de pagina is getikt.
  var zelfGesloten = false;
  var laatsteTik = 0;
  function onthoudTik() { laatsteTik = Date.now(); }

  /** Is dit veld net losgelaten door het vinkje? */
  function doorVinkje(/** @type {any} */ e) {
    if (zelfGesloten || apparaat() !== "ios") return false;
    if (e.relatedTarget || !e.target.isConnected) return false; // een ander veld, of de vraag is al vervangen
    if (document.visibilityState !== "visible" || !document.hasFocus()) return false; // weggegaan uit de browser
    return Date.now() - laatsteTik > 500;
  }

  /** ⭐ Een leeg veld blijft staan: wie het toetsenbord sluit om een foto te bekijken, wil niet naar de volgende vraag. */
  function vinkjeGaatDoor(/** @type {any} */ inp) {
    var velden = Array.prototype.slice.call(document.querySelectorAll("#vraag input"));
    if (velden.indexOf(inp) !== velden.length - 1) return false;
    return !!inp.value.trim() && stand.huidig < stand.vragen.length - 1;
  }

  function tekenMedia(v, doel) {
    if (v.beeld) {
      var img = maak("img", "media");
      img.src = v.beeld;
      img.alt = "Afbeelding bij vraag " + v.nummer;
      doel.appendChild(img);
    }
    if (v.clip) {
      var c = maak(v.clip_type === "video" ? "video" : "audio", "media");
      c.src = v.clip;
      c.controls = true;
      c.preload = "none";
      c.setAttribute("playsinline", "");
      doel.appendChild(c);
    }
  }

  function tekenVraag() {
    var v = stand.vragen[stand.huidig];
    var d = $("vraag");
    d.replaceChildren();
    d.appendChild(maak("p", "stil", "Vraag " + v.nummer + " van " + stand.vragen.length));
    d.appendChild(maak("p", "vraag-tekst", v.tekst));
    var extra = v.extra || {};
    // ⛔ De marge staat zichtbaar vóór het antwoorden (principe VI).
    var marge = extra.antwoordinstructie || (extra.marge !== undefined ? "Marge: ± " + extra.marge : null);
    if (marge) d.appendChild(maak("p", "instructie", marge));
    tekenMedia(v, d);

    if (v.type === "meerkeuze") {
      (extra.options || []).forEach(function (o) {
        var b = maak("button", "optie", o);
        b.type = "button";
        b.setAttribute("aria-pressed", String(stand.antwoorden[v.id] === o));
        b.addEventListener("click", function () { zetAntwoord(v, o); tekenVraag(); tekenKrat(); });
        d.appendChild(b);
      });
    } else if (v.type === "meervoud") {
      var delen = extra.delen || [];
      var waarden = [];
      try { waarden = JSON.parse(stand.antwoorden[v.id] || "[]"); } catch (e) { waarden = []; }
      delen.forEach(function (deel, k) {
        d.appendChild(veld(deel.label || "Antwoord " + (k + 1), waarden[k] || "", deel.type, function (w) {
          waarden[k] = w;
          var vol = [];
          for (var i = 0; i < delen.length; i++) vol.push(waarden[i] || "");
          zetAntwoord(v, JSON.stringify(vol));
        }));
      });
    } else {
      d.appendChild(veld("Uw antwoord", stand.antwoorden[v.id] || "", v.type, function (w) { zetAntwoord(v, w); }));
    }
    $("vorige").disabled = stand.huidig === 0;
    $("volgende").disabled = stand.huidig === stand.vragen.length - 1;
  }

  function naar(i) {
    stand.huidig = i;
    bewaar();
    tekenKrat();
    tekenVraag();
    window.scrollTo(0, 0);
  }

  function speelScherm() {
    toon("spel");
    $("spel-titel").textContent = stand.titel;
    vorigeLeeg = null;
    kratSleutel = "";
    wachtend = [];
    zetIngeklapt(false);
    tekenKrat();
    tekenVraag();
    tekenKlok();
    clearInterval(klokTimer);
    klokTimer = window.setInterval(tekenKlok, 500);
  }

  // --- Eerlijkheid -------------------------------------------------------------------------------------------------
  function speeltMedia() {
    var m = document.querySelectorAll("audio, video");
    for (var i = 0; i < m.length; i++) if (!(/** @type {any} */ (m[i])).paused) return true;
    return false;
  }

  function terug() {
    if (!stand || stand.weg_op === null || stand.weg_op === undefined) return;
    var weg = Date.now() - stand.weg_op;
    var media = stand.weg_media;
    stand.weg_op = null;
    stand.weg_media = false;
    // ⛔ Een afwezigheid die eindigt zonder speeltijd telt niet: er viel niets meer te wijzigen.
    if (weg >= GRACE_MS && !media && resterend() > 0) {
      stand.weggaan = (stand.weggaan || 0) + 1;
      if (stand.bonus) stand.bonus = false;
      if (stand.weggaan > 1) stand.eindtijd -= STRAF_S * 1000;
    }
    bewaar();
    tekenKlok();
  }

  document.addEventListener("visibilitychange", function () {
    if (!stand || stand.uitslag || !stand.eindtijd || bezig) return;
    if (document.visibilityState === "hidden") {
      stand.weg_op = Date.now();
      stand.weg_media = speeltMedia();
      bewaar();
    } else {
      terug();
    }
  });

  // --- Starten en inleveren ----------------------------------------------------------------------------------------
  function start() {
    var knop = $("start");
    knop.disabled = true;
    post("start", { slug: G.slug })
      .then(function (r) {
        if (r.status === 503) { toon("uit"); return null; }
        if (!r.ok) throw new Error("start");
        return r.json();
      })
      .then(function (d) {
        if (!d) return;
        // ⛔ De klok loopt pas na de intro (principe VII): `eindtijd` blijft leeg tot *Start de klok*.
        stand = {
          titel: d.titel, intro: d.intro, vragen: d.vragen, antwoorden: {},
          eindtijd: null,
          weggaan: 0, bonus: true, weg_op: null, weg_media: false, huidig: 0, uitslag: null,
        };
        bewaar();
        tel("start");
        introScherm();
      })
      .catch(function () {
        knop.disabled = false;
        $("start-fout").hidden = false;
      });
  }

  // De ronde-intro van de app, als platte tekst met alleen vet (`**`), zoals daar. Nooit via innerHTML.
  function introScherm() {
    toon("intro");
    $("intro-titel").textContent = stand.titel;
    var doel = $("intro-tekst");
    doel.replaceChildren();
    String(stand.intro || "").split(/\n\s*\n/).forEach(function (alinea) {
      if (!alinea.trim()) return;
      var p = maak("p");
      alinea.split("**").forEach(function (stuk, i) {
        if (!stuk) return;
        p.appendChild(i % 2 === 1 ? maak("strong", "", stuk) : document.createTextNode(stuk));
      });
      doel.appendChild(p);
    });
  }

  function startKlok() {
    stand.eindtijd = Date.now() + SPEELTIJD_S * 1000;
    bewaar();
    speelScherm();
  }

  // --- Afronden: src/components/round/AfrondPaneel.tsx --------------------------------------------------------------
  // ⛔ Een aanbod, geen poort: wie bewust iets leeg laat, moet gewoon kunnen afgeven. Alleen helemaal niets ingevuld
  //    krijgt een extra vraag, want dat is bijna altijd een vergissing.
  function afrondScherm() {
    var open = openVragen();
    var alles = open.length === 0;
    toon("afrond");
    $("afrond-keuze").hidden = false;
    $("afrond-niets").hidden = true;
    $("afrond").classList.toggle("vol", alles);
    $("afrond-kop").textContent = alles ? "Het kratje is vol"
      : open.length === 1 ? "Er staat er nog één open" : open.length + " staan er nog open";
    $("afrond-sub").textContent = alles
      ? (stand.vragen.length === 10 ? "Tien" : stand.vragen.length) + " antwoorden, niets overgeslagen. Nog even nakijken kan."
      : "Lege vragen leveren niets op. Tik erop om er alsnog iets van te maken.";
    $("afrond-terug").textContent = alles ? "Nog een keer langslopen" : "Terug naar de vragen";
    var lijst = $("afrond-lijst");
    lijst.replaceChildren();
    open.forEach(function (i) {
      var v = stand.vragen[i];
      var rij = maak("button", "afrond-rij");
      rij.type = "button";
      rij.setAttribute("aria-label", "Vraag " + v.nummer + ": " + v.tekst);
      rij.appendChild(maak("span", "afrond-nr", v.nummer));
      if (v.beeld) {
        var img = maak("img", "afrond-beeld");
        img.src = v.beeld;
        img.alt = "";
        rij.appendChild(img);
      } else if (v.clip) {
        var noot = maak("span", "afrond-noot");
        [9, 16, 11, 19].forEach(function (h) {
          var streep = maak("span");
          streep.style.height = h + "px";
          noot.appendChild(streep);
        });
        rij.appendChild(noot);
      }
      var tekst = maak("span", "afrond-tekst");
      tekst.appendChild(maak("span", "afrond-vraag", v.tekst));
      if (v.beeld || v.clip) tekst.appendChild(maak("span", "afrond-soort", v.beeld ? "beeldvraag" : "fragment"));
      rij.appendChild(tekst);
      rij.appendChild(maak("span", "afrond-pijl", "›"));
      rij.addEventListener("click", function () { terugNaarVragen(i); });
      lijst.appendChild(rij);
    });
  }

  function terugNaarVragen(i) {
    toon("spel");
    naar(i === undefined ? stand.huidig : i);
  }

  function afgeven() {
    if (openVragen().length === stand.vragen.length) {
      $("afrond-keuze").hidden = true;
      $("afrond-niets").hidden = false;
      return;
    }
    geluidKlaarzetten();
    inleveren();
  }

  // --- Het geluid: src/api/geluid.ts, moment `uitslag` --------------------------------------------------------------
  // ⛔ Alleen bij een VERSE uitslag, niet bij terugkomen op de pagina, en hetzelfde bij goed of fout (115, FR-006).
  // ⭐ Web Audio en geen <audio>: de bedoeling is dat de stille stand van een iPhone wint, zoals in de app. Dat is
  //    te bevestigen op een echt toestel. Elk falen is stil: het geluid draagt geen informatie.
  /** @type {any} */
  var geluid = null;
  function geluidKlaarzetten() {
    if (geluid) return;
    try {
      /** @type {any} */
      var w = window;
      var Ctx = w.AudioContext || w.webkitAudioContext;
      if (!Ctx) return;
      // ⭐ Aangemaakt tijdens de tik: browsers staan geluid alleen toe na een handeling van de speler.
      var ctx = new Ctx();
      if (ctx.state === "suspended") ctx.resume().catch(function () {});
      geluid = {
        ctx: ctx,
        buffer: fetch("/speel-bestanden/klopt_gescoord_aandacht.wav")
          .then(function (r) { if (!r.ok) throw new Error("geluid"); return r.arrayBuffer(); })
          .then(function (b) { return new Promise(function (ok, nee) { ctx.decodeAudioData(b, ok, nee); }); })
          .catch(function () { return null; }),
      };
    } catch (e) { geluid = null; }
  }
  function speelUitslagGeluid() {
    if (!geluid) return;
    try {
      geluid.buffer.then(function (/** @type {any} */ buffer) {
        if (!buffer) return;
        var bron = geluid.ctx.createBufferSource();
        bron.buffer = buffer;
        bron.connect(geluid.ctx.destination);
        bron.start();
      }).catch(function () {});
    } catch (e) { /* stil */ }
  }

  function inleveren() {
    if (bezig || !stand) return;
    bezig = true;
    clearInterval(klokTimer);
    // ⭐ Zo gaat het nakijken verder als de speler deze pagina sluit en later terugkomt.
    stand.ingeleverd = true;
    bewaar();
    geluidKlaarzetten(); // bij een aflopende klok is er geen tik; op een iPhone kan het geluid dan wegvallen
    toon("wacht");
    post("nakijken", { slug: G.slug, antwoorden: stand.antwoorden })
      .then(function (r) {
        if (r.status === 429) throw { reden: "limiet" };
        if (r.status === 503) return r.json().then(function (b) { throw { reden: b.reden }; });
        if (!r.ok) throw { reden: "probeer_opnieuw" };
        return r.json();
      })
      .then(function (u) {
        stand.uitslag = u;
        bewaar();
        tel("afgerond");
        bezig = false;
        uitslagScherm();
        speelUitslagGeluid();
      })
      .catch(function (e) {
        bezig = false;
        toon("fout");
        $("fout-tekst").textContent = e && e.reden === "limiet"
          ? "U heeft vandaag al heel wat ingeleverd. Probeer het morgen nog eens, of ga verder in de app."
          : "Het nakijken lukte even niet. Uw antwoorden zijn bewaard; niets is fout gerekend.";
        $("opnieuw").hidden = !!(e && e.reden === "limiet");
      });
  }

  // --- Uitslag -----------------------------------------------------------------------------------------------------
  function eigenAntwoord(v) {
    var a = stand.antwoorden[v.id];
    return a === undefined || a === "" ? "(leeg)" : a;
  }

  function tekenRij(v, u) {
    var r = maak("div", "rij");
    r.appendChild(maak("p", "stil", "Vraag " + v.nummer));
    r.appendChild(maak("p", "", v.tekst));
    var oordeel = u.niet_nagekeken
      ? maak("span", "oordeel open", "Niet nagekeken")
      : u.is_correct ? maak("span", "oordeel goed", "Klopt!") : maak("span", "oordeel net-niet", "Net niet!");
    r.appendChild(oordeel);
    if (u.detail) {
      u.detail.forEach(function (d) {
        r.appendChild(maak("p", "", (d.label ? d.label + ": " : "") + (d.value || "(leeg)") + (d.is_correct ? " ✓" : " ✗")));
        if (!d.is_correct && d.correct_answer) r.appendChild(maak("p", "zacht", "Juist: " + d.correct_answer));
      });
    } else {
      r.appendChild(maak("p", "", "Uw antwoord: " + eigenAntwoord(v)));
      r.appendChild(maak("p", "zacht", "Juist: " + u.juiste_antwoord));
    }
    if (u.pct_goed !== null && u.pct_goed !== undefined) {
      r.appendChild(maak("p", "stil", u.pct_goed + "% van de Klopt!-spelers had deze goed."));
    }
    if (u.uitleg) r.appendChild(maak("p", "uitleg zacht", u.uitleg));
    return r;
  }

  function uitnodigingTekst() {
    // ⛔ Nooit beloven dat de webscore meegaat (FR-019).
    if (G.hoort_bij_lopend) return "Dit was ronde 1. Speel de quiz verder in de app: de volgende rondes staan daar klaar. Uw score van hier telt daar niet mee.";
    if (G.lopende_quiz) return "Deze ronde kwam uit een eerdere quiz. Speel nu \"" + G.lopende_quiz.naam + "\" in de app, met een nieuw thema. Elke twee weken komt er weer een nieuwe quiz.";
    return "Elke twee weken komt er in de app een nieuwe quiz, steeds met een ander thema.";
  }

  function apparaat() {
    var ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
    if (/Android/.test(ua)) return "android";
    return "computer";
  }

  function tekenQr(svg, doel) {
    /** @type {any} */
    var w = window;
    if (typeof w.kloptQr !== "function") { svg.hidden = true; return; }
    var rijen = w.kloptQr(doel), n = rijen.length, stil = 4, maat = n + 2 * stil, pad = "";
    svg.setAttribute("viewBox", "0 0 " + maat + " " + maat);
    svg.setAttribute("shape-rendering", "crispEdges");
    for (var r = 0; r < n; r++) for (var k = 0; k < n; k++) {
      if (rijen[r][k]) pad += "M" + (k + stil) + " " + (r + stil) + "h1v1h-1z";
    }
    var p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", pad);
    p.setAttribute("fill", "#17100B"); // ⭐ QR op wit, gelijk aan /installeren/: hier draagt de kleur geen stijl.
    svg.appendChild(p);
  }

  function tekenUitnodiging() {
    $("uitnodiging-tekst").textContent = uitnodigingTekst();
    var soort = apparaat();
    var link = "/s/" + G.code;
    var boven = $("winkel");
    var onder = $("winkel-onder");
    var q = $("qr-blok");
    if (soort === "computer") {
      // ⛔ De QR-code alleen onderaan: hij is groot en zou de antwoorden wegduwen. Boven de gouden knop ernaartoe.
      boven.hidden = true;
      onder.hidden = true;
      $("naar-qr").hidden = false;
      q.hidden = false;
      tekenQr($("qr"), "https://klopt-app.nl" + link);
      return;
    }
    q.hidden = true;
    $("naar-qr").hidden = true;
    [boven, onder].forEach(function (a) {
      a.hidden = false;
      a.textContent = winkelTekst(soort);
      a.href = link;
    });
    var ios = soort === "ios";
    $("plak-hint").hidden = !ios;
    $("plak-hint-onder").hidden = !ios;
  }

  function winkelTekst(soort) {
    return soort === "ios" ? "Download in de App Store" : "Ontdek het op Google Play";
  }

  // ⭐ Elke winkellink, ook vóór het spelen. Op iOS draagt alleen het klembord de herkomst; bij het aanmelden tikt de speler op Plakken.
  function zetWinkelLinks() {
    var soort = apparaat();
    if (soort === "ios") {
      document.querySelectorAll(".winkel-link, #winkel, #winkel-onder").forEach(function (a) {
        a.addEventListener("click", function () {
          try { navigator.clipboard.writeText(G.code).catch(function () {}); } catch (e) { /* dan de gewone kennismaking */ }
        });
      });
    }
    if (soort === "computer") return; // ⛔ Computer: alleen de QR-code na de ronde.
    $("winkel-boven").textContent = winkelTekst(soort);
    $("winkel-boven").hidden = false;
    $("plak-hint-boven").hidden = soort !== "ios";
  }

  function uitslagScherm() {
    toon("uitslag");
    var u = stand.uitslag;
    var punten = stand.bonus ? u.punten * BONUS : u.punten;
    $("score").textContent = String(punten).replace(".", ",");
    $("score-sub").textContent = stand.bonus
      ? u.punten + " goed × 1,5 eerlijkheidsbonus"
      : u.punten + " goed. De eerlijkheidsbonus was verloren.";
    $("niet-nagekeken").hidden = !u.niet_nagekeken;
    $("niet-nagekeken").textContent = u.niet_nagekeken
      ? u.niet_nagekeken + (u.niet_nagekeken === 1 ? " vraag kon" : " vragen konden") + " nu niet worden nagekeken en " + (u.niet_nagekeken === 1 ? "telt" : "tellen") + " niet mee."
      : "";
    var lijst = $("rijen");
    lijst.replaceChildren();
    stand.vragen.forEach(function (v) {
      var r = u.vragen.filter(function (x) { return x.vraag_id === v.id; })[0];
      if (r) lijst.appendChild(tekenRij(v, r));
    });
    tekenUitnodiging();
  }

  // --- Het wachtglas: src/components/round/WachtScherm.tsx en Bierglas.tsx ------------------------------------------
  // ⛔ Tempo T3 (besluit eigenaar): de tijd zit in het schenken. Een LUS, geen éénmalige beweging: een glas dat vol
  //    blijft staan leest als een voortgangsbalk die de app niet kent. Geen geluid op dit scherm (084).
  var GLAS = (function () {
    var W = 92, H = 132, WD = 2.2, K = 0.16;
    var B = Math.round(W * (20 / 28));
    var FL = (W - B) / 2;
    var links = function (/** @type {number} */ y) { return (FL * y) / H; };
    var half = function (/** @type {number} */ y) { return W / 2 - links(y); };
    return {
      W: W, H: H, WD: WD, K: K, B: B, FL: FL, BINNEN: H * 0.925, M: Math.ceil(W * 0.25), links: links, half: half,
      binnen: function (/** @type {number} */ y) { return half(y) - WD / 2; },
    };
  })();
  var SCHENKEN_MS = 3000, STAAN_MS = 1400, VERVAGEN_MS = 600, LEEG_MS = 400;
  var OMLOOP_MS = SCHENKEN_MS + STAAN_MS + VERVAGEN_MS + LEEG_MS;
  var KRAAG_EIND = 20, KRAAG_START = 3, BEL_MS = 1600, BEL_R = 1.5;
  var BELLEN = [[0.32, 0, 1.1], [0.62, 0.35, 0.8], [0.46, 0.7, 1.3], [0.7, 0.15, 0.9], [0.39, 0.5, 1], [0.56, 0.85, 1.2]];
  var CONDENS = [[0.22, 0.52, 1], [0.74, 0.44, 0.8], [0.63, 0.78, 1.1], [0.3, 0.86, 0.7], [0.82, 0.68, 0.9], [0.44, 0.63, 0.6], [0.55, 0.92, 0.8]];
  var schenk = function (/** @type {number} */ ms) { return 1 - Math.pow(1 - Math.min(1, ms / SCHENKEN_MS), 3); };
  var schuimOp = function (/** @type {number} */ ms) { return GLAS.BINNEN * schenk(ms); };
  var bierOp = function (/** @type {number} */ ms) { return Math.max(0, (GLAS.BINNEN - KRAAG_EIND + KRAAG_START) * schenk(ms) - KRAAG_START); };
  var dekkingOp = function (/** @type {number} */ ms) {
    return ms <= SCHENKEN_MS + STAAN_MS ? 1 : Math.max(0, 1 - (ms - SCHENKEN_MS - STAAN_MS) / VERVAGEN_MS);
  };

  /** @type {any} */
  var glasDelen = null;
  var glasFrame = 0;

  function tekenGlas() {
    var g = GLAS, W = g.W, H = g.H, wd = g.WD, K = g.K, b = g.B, fl = g.FL, yb = g.BINNEN, M = g.M;
    var cx = W / 2;
    var rx0 = g.binnen(0), ry0 = rx0 * K;
    var lerp = function (/** @type {number} */ a, /** @type {number} */ c, /** @type {number} */ t) { return a + (c - a) * t; };
    var vakB = W + 2 * M, vakH = H + 2 * M;
    var binnenPad = "M " + f(g.links(0) + wd / 2) + " 0 L " + f(g.links(yb) + wd / 2) + " " + f(yb) +
      " A " + f(g.binnen(yb)) + " " + f(g.binnen(yb) * K) + " 0 0 0 " + f(W - g.links(yb) - wd / 2) + " " + f(yb) +
      " L " + f(W - g.links(0) - wd / 2) + " 0 Z";
    var boog = function (/** @type {number} */ y) { return "M " + f(cx - rx0) + " " + f(y) + " A " + f(rx0) + " " + f(ry0) + " 0 0 0 " + f(cx + rx0) + " " + f(y); };

    var klipSchuim = s("rect", { x: -M, width: vakB, height: 0, y: yb });
    var klipBier = s("rect", { x: -M, width: vakB, height: 0, y: yb });
    var bellen = BELLEN.map(function (bel) {
      var ymid = yb * 0.5;
      var marge = g.links(ymid) + wd + BEL_R * 1.2;
      return s("circle", { cx: f(marge + bel[0] * (W - 2 * marge)), cy: yb, r: BEL_R, stijl: "fill:var(--schuim);fill-opacity:0.5" });
    });
    var condens = CONDENS.map(function (c) {
      var y = H * c[1];
      if (y > yb - 1) return null;
      var r = 1.5 * c[2];
      return s("ellipse", {
        cx: f(lerp(g.links(y) + wd + r, W - g.links(y) - wd - r, c[0])), cy: f(y), rx: f(r), ry: f(r * 1.3),
        stijl: "fill:var(--schuim);fill-opacity:0.28",
      });
    });
    var band = 4, schaduw = 1.8;
    var kraag = s("g", {}, [
      s("path", { d: boog(0) + " Z", stijl: "fill:var(--schuim)" }),
      s("path", { d: boog(-schaduw / 2), fill: "none", "stroke-width": schaduw, stijl: "stroke:var(--tekstZacht);stroke-opacity:0.45" }),
      s("path", { d: boog(band / 2), fill: "none", "stroke-width": band, stijl: "stroke:var(--lamp);stroke-opacity:0.3" }),
    ]);
    var kop = s("g", {}, [
      s("ellipse", { cx: f(cx), cy: 0, rx: f(rx0), ry: f(ry0), stijl: "fill:var(--schuim)" }),
      s("ellipse", { cx: f(cx), cy: 0, rx: f(rx0), ry: f(ry0), fill: "url(#glas-k)" }),
    ]);
    var vloeistof = s("g", {}, [
      s("path", { d: binnenPad, "clip-path": "url(#glas-ks)", stijl: "fill:var(--schuim)" }),
      s("g", { "clip-path": "url(#glas-kb)" }, [s("path", { d: binnenPad, fill: "url(#glas-b)" })].concat(condens, bellen)),
      kraag,
      kop,
    ]);

    var yT = H * 0.1, yB = yb - H * 0.06, off = W * 0.1, sw = W * 0.075, yT2 = yT * 1.4, yB2 = yB - H * 0.1, sw2 = W * 0.028;
    var punt = function (/** @type {number} */ gr) {
      var t = (gr * Math.PI) / 180;
      return [cx + (W / 2) * Math.cos(t), (W / 2) * K * Math.sin(t)];
    };
    var pa = punt(166), pb = punt(118);

    var svg = s("svg", { width: vakB, height: vakH, viewBox: -M + " " + -M + " " + vakB + " " + vakH, "aria-hidden": "true" }, [
      s("defs", {}, [
        s("radialGradient", { id: "glas-h", cx: "50%", cy: "50%", r: "50%" }, [stop(0, "zwart", 0.55), stop(1, "zwart", 0)]),
        s("linearGradient", {
          id: "glas-b", gradientUnits: "userSpaceOnUse",
          x1: f(W * (0.5 - DX)), y1: f(H * (0.5 - DY)), x2: f(W * (0.5 + DX)), y2: f(H * (0.5 + DY)),
        }, [stop(0, "koperLicht"), stop(1, "koper")]),
        s("radialGradient", { id: "glas-k", cx: "50%", cy: "50%", r: "60%", fx: "36%", fy: "40%" }, [stop(0.45, "tekstZacht", 0), stop(1, "tekstZacht", 0.45)]),
        s("linearGradient", { id: "glas-l", x1: 0, y1: 0, x2: 0, y2: 1 }, [stop(0, "schuim", 0.46), stop(1, "schuim", 0.03)]),
        s("clipPath", { id: "glas-ks" }, [klipSchuim]),
        s("clipPath", { id: "glas-kb" }, [klipBier]),
      ]),
      // Achter: schaduw, de tint van het glas, de achterste helft van de rand.
      s("ellipse", { cx: f(cx + W * 0.05), cy: f(H + b * K * 0.5), rx: f(b * 0.85), ry: f(H * 0.05), fill: "url(#glas-h)" }),
      s("path", {
        d: "M 0 0 L " + f(fl) + " " + f(H) + " A " + f(b / 2) + " " + f((b / 2) * K) + " 0 0 0 " + f(W - fl) + " " + f(H) + " L " + f(W) + " 0 A " + f(W / 2) + " " + f((W / 2) * K) + " 0 0 0 0 0 Z",
        stijl: "fill:var(--schuim);fill-opacity:0.045",
      }),
      s("path", { d: "M 0 0 A " + f(W / 2) + " " + f((W / 2) * K) + " 0 0 1 " + f(W) + " 0", fill: "none", "stroke-width": f(wd * 0.8), stijl: "stroke:var(--knopRand);stroke-opacity:0.55" }),
      vloeistof,
      // Voor: glazen bodem, licht, omtrek, voorste helft van de rand.
      s("path", {
        d: "M " + f(g.links(yb)) + " " + f(yb) + " A " + f(g.half(yb)) + " " + f(g.half(yb) * K) + " 0 0 0 " + f(W - g.links(yb)) + " " + f(yb) +
          " L " + f(W - fl) + " " + f(H) + " A " + f(b / 2) + " " + f((b / 2) * K) + " 0 0 1 " + f(fl) + " " + f(H) + " Z",
        stijl: "fill:var(--knopRand);fill-opacity:0.5",
      }),
      s("line", {
        x1: f(g.links(yb) + wd), y1: f(yb + g.half(yb) * K * 0.6), x2: f(lerp(g.links(yb), W - g.links(yb), 0.42)), y2: f(yb + g.half(yb) * K),
        "stroke-width": 1.2, "stroke-linecap": "round", stijl: "stroke:var(--schuim);stroke-opacity:0.3",
      }),
      s("path", {
        d: "M " + f(g.links(yT) + off) + " " + f(yT) + " L " + f(g.links(yT) + off + sw) + " " + f(yT) + " L " + f(g.links(yB) + off + sw * 0.7) + " " + f(yB) + " L " + f(g.links(yB) + off) + " " + f(yB) + " Z",
        fill: "url(#glas-l)",
      }),
      s("path", {
        d: "M " + f(W - g.links(yT2) - W * 0.15) + " " + f(yT2) + " L " + f(W - g.links(yT2) - W * 0.15 + sw2) + " " + f(yT2) + " L " + f(W - g.links(yB2) - W * 0.13 + sw2) + " " + f(yB2) + " L " + f(W - g.links(yB2) - W * 0.13) + " " + f(yB2) + " Z",
        stijl: "fill:var(--schuim);fill-opacity:0.16",
      }),
      s("path", {
        d: "M 0 0 L " + f(fl) + " " + f(H) + " A " + f(b / 2) + " " + f((b / 2) * K) + " 0 0 0 " + f(W - fl) + " " + f(H) + " L " + f(W) + " 0",
        fill: "none", "stroke-width": wd, "stroke-linejoin": "round", "stroke-linecap": "round", stijl: "stroke:var(--knopRand)",
      }),
      s("path", { d: "M 0 0 A " + f(W / 2) + " " + f((W / 2) * K) + " 0 0 0 " + f(W) + " 0", fill: "none", "stroke-width": wd, stijl: "stroke:var(--knopRand)" }),
      s("path", {
        d: "M " + f(pa[0]) + " " + f(pa[1]) + " A " + f(W / 2) + " " + f((W / 2) * K) + " 0 0 0 " + f(pb[0]) + " " + f(pb[1]),
        fill: "none", "stroke-width": f(wd * 0.8), "stroke-linecap": "round", stijl: "stroke:var(--schuim);stroke-opacity:0.55",
      }),
    ]);
    var doel = $("glas");
    doel.replaceChildren(svg);
    return {
      vloeistof: vloeistof, klipSchuim: klipSchuim, klipBier: klipBier, kraag: kraag, kop: kop, bellen: bellen,
      smalOnder: g.binnen(yb) / rx0, cx: cx, vakH: vakH, M: M,
    };
  }

  /** Eén moment in de omloop. De tekening staat stil; alleen vensters, randen en belletjes bewegen. */
  function zetGlas(ms) {
    var d = glasDelen, yb = GLAS.BINNEN;
    var sh = schuimOp(ms), bh = bierOp(ms);
    d.vloeistof.setAttribute("opacity", f(dekkingOp(ms)));
    d.klipSchuim.setAttribute("y", f(yb - sh));
    d.klipSchuim.setAttribute("height", f(d.vakH));
    d.klipBier.setAttribute("y", f(yb - bh));
    d.klipBier.setAttribute("height", f(d.vakH));
    // ⚠️ Zonder vloeistof eronder is een rand een witte ellips op de bodem: daarom de zichtbaarheid onder 1,5.
    var rand = function (/** @type {any} */ el, /** @type {number} */ h) {
      var breed = d.smalOnder + (1 - d.smalOnder) * (h / yb);
      el.setAttribute("transform", "translate(" + f(d.cx) + " " + f(yb - h) + ") scale(" + f(breed) + " 1) translate(" + f(-d.cx) + " 0)");
      el.setAttribute("opacity", f(Math.min(1, h / 1.5)));
    };
    rand(d.kraag, bh);
    rand(d.kop, sh);
    BELLEN.forEach(function (bel, i) {
      var hoogte = ((ms / BEL_MS) * bel[2] + bel[1]) % 1;
      d.bellen[i].setAttribute("cy", f(yb - BEL_R * 1.5 - hoogte * Math.max(0, bh - BEL_R * 1.5)));
      d.bellen[i].setAttribute("r", f(BEL_R * (0.7 + 0.5 * hoogte)));
    });
  }

  function startGlas() {
    if (!glasDelen) glasDelen = tekenGlas();
    cancelAnimationFrame(glasFrame);
    // ⛔ Verminderde beweging: een stilstaand VOL glas, nooit een leeg (099, rij D7).
    if (!mag_bewegen) { zetGlas(SCHENKEN_MS); return; }
    var begin = performance.now();
    var stap = function (/** @type {number} */ nu) {
      zetGlas((nu - begin) % OMLOOP_MS);
      glasFrame = requestAnimationFrame(stap);
    };
    zetGlas(0);
    glasFrame = requestAnimationFrame(stap);
  }
  function stopGlas() { cancelAnimationFrame(glasFrame); }

  // --- Opstarten ---------------------------------------------------------------------------------------------------
  function geenScript() {
    $("zonder-script") && ($("zonder-script").hidden = true);
  }

  function opstarten() {
    geenScript();
    zetWinkelLinks();
    zetVerlopen();
    volgToetsenbord();
    $("start").addEventListener("click", start);
    $("klok-start").addEventListener("click", startKlok);
    $("vorige").addEventListener("click", function () { naar(stand.huidig - 1); });
    $("volgende").addEventListener("click", function () { naar(stand.huidig + 1); });
    $("inleveren").addEventListener("click", afrondScherm);
    $("afgeven").addEventListener("click", afgeven);
    $("afrond-terug").addEventListener("click", function () { terugNaarVragen(); });
    $("toch-afgeven").addEventListener("click", function () { geluidKlaarzetten(); inleveren(); });
    $("niets-terug").addEventListener("click", function () { terugNaarVragen(); });
    $("opnieuw").addEventListener("click", function () { geluidKlaarzetten(); inleveren(); });

    tel("bezoek");
    stand = laad();
    if (stand && stand.uitslag) { uitslagScherm(); return; }
    if (stand && stand.ingeleverd) { inleveren(); return; }
    if (stand && stand.eindtijd) {
      terug();
      if (resterend() <= 0) { inleveren(); return; }
      speelScherm();
      return;
    }
    if (stand && stand.vragen) { introScherm(); return; } // gestart, maar de klok liep nog niet
    stand = null;
    fetch("/w/status").then(function (r) { return r.json(); }).then(function (s) {
      if (!s.aan) toon("uit");
    }).catch(function () { /* de startknop meldt het dan zelf */ });
  }

  opstarten();
})();
