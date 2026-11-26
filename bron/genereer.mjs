// @ts-check
// Feature 150 — manifest → pagina's. Draait in GitHub Actions van het openbare repo; zie contracts/publicatie.md.
//
//   node genereer.mjs <manifest-url of -bestand> <uitvoermap>
//
// ⛔ Een leeg of ongeldig manifest stopt met exit 3 zonder iets te schrijven: er ontstaat nooit een lege site.
// ⛔ De uitvoer hangt alleen af van het manifest (geen tijdstip), dus de Action commit alleen bij echt verschil.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = "https://klopt-app.nl";
const HIER = dirname(fileURLToPath(import.meta.url));
// ⭐ De vaste code van /speel/ (besluit 127: geen bezoekdatum). Niet wijzigen: de funnel telt op deze code.
const SPEEL_CODE = "web-speel-20261105";
const LIJST_CODE = "web-quizzen-20261105";
// ⭐ Kopie van assets/sounds/klopt_gescoord_aandacht.wav: het geluid als de uitslag openvalt (115).
const GELUID = "klopt_gescoord_aandacht.wav";
// Het logo op 2× de weergavemaat (48 px); het app-icoon van 180 px woog 17 kB meer. Uit site/apple-touch-icon.png.
const LOGO = "logo-96.png";

/** @param {unknown} s */
const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// JSON in een script-blok: `</` mag er niet in voorkomen.
/** @param {unknown} o */
const jsonInScript = (o) => JSON.stringify(o).replace(/</g, "\\u003c");

/** @param {any} m */
export function isGeldig(m) {
  return !!m && Array.isArray(m.rondes) && m.rondes.length > 0 && typeof m.speel === "string" &&
    m.rondes.some((/** @type {any} */ r) => r.slug === m.speel) &&
    m.rondes.every((/** @type {any} */ r) => /^[a-z0-9]{1,20}$/.test(r.slug) && Array.isArray(r.voorproef) && r.voorproef.length === 3 &&
      // 259: elke ronde heeft haar vragen, elk met nummer, tekst en antwoord. Een manifest van vóór 259 (zonder vragen)
      // wordt geweigerd: dan schrijft deze generator niets, in plaats van antwoordpagina's zonder antwoorden.
      Array.isArray(r.vragen) && r.vragen.length > 0 &&
      r.vragen.every((/** @type {any} */ v) => Number.isInteger(v?.nummer) && typeof v.tekst === "string" && v.tekst !== "" &&
        typeof v.antwoord === "string" && v.antwoord !== ""));
}

/** @param {string} iso */
const datumCode = (iso) => iso.slice(0, 10).replace(/-/g, "");

const OVER_APP = "Klopt! is een Nederlandse pubquiz-app voor iPhone en Android. U speelt alleen, met vrienden in uw eigen kroeg, of in een team.";

// ⭐ Twee verhaallijnen (besluit eigenaar 04-11): ronde 1 van de lopende quiz gaat verder in de app; een oudere ronde
// verwijst naar de quiz die nu loopt. ⛔ Nooit beloven dat de webscore meegaat (FR-019).
/** @param {any} ronde @param {any} manifest */
export function appBlok(ronde, manifest) {
  const lopend = manifest.lopende_quiz?.naam;
  if (lopend && lopend === ronde.quiz) {
    return {
      kop: "Speel deze quiz verder in de app",
      tekst: `Dit is ronde 1 van "${lopend}". De volgende rondes staan in de app. ${OVER_APP}`,
    };
  }
  if (lopend) {
    return {
      kop: `Speel nu "${lopend}" in de app`,
      tekst: `Deze ronde komt uit een eerdere quiz. In de app loopt nu "${lopend}", met een nieuw thema. ${OVER_APP}`,
    };
  }
  return { kop: "Meer rondes in de app", tekst: `Elke twee weken start er een nieuwe quiz van acht rondes, steeds met een ander thema. ${OVER_APP}` };
}

/** @param {any} ronde @param {any} manifest @param {boolean} isSpeel @param {string} sjabloon */
function pagina(ronde, manifest, isSpeel, sjabloon) {
  const pad = isSpeel ? "/speel/" : `/quiz/${ronde.slug}/`;
  const code = isSpeel ? SPEEL_CODE : `web-${ronde.slug}-${datumCode(ronde.deadline)}`;
  const titel = isSpeel
    ? "Gratis online quiz: speel nu een echte pubquizronde | Klopt!"
    : `${ronde.titel}: online quiz met 10 vragen | Klopt!`;
  const kop = isSpeel ? "Gratis online quiz: speel een echte pubquizronde" : `${ronde.titel}: speel deze online quiz`;
  const omschrijving = isSpeel
    ? `Gratis online quiz zonder account: tien vragen, tien minuten, u typt zelf het antwoord. Deze ronde: ${ronde.omschrijving}.`
    : `Online quiz met 10 vragen: ${ronde.omschrijving}. Gratis en zonder account, u typt zelf het antwoord.`;
  const opening = `${ronde.omschrijving}. Een typfout kost u niets: de quizmaster begrijpt wat u bedoelt.`;

  // ⛔ Geen links naar andere rondes (besluit eigenaar 04-11): na een ronde is de volgende stap de app, niet nog een ronde.
  //    De oude pagina's zijn alleen vindbaar via de sitemap en Google.
  const ld = [
    {
      "@context": "https://schema.org", "@type": "MobileApplication", name: "Klopt!",
      operatingSystem: "iOS, Android", applicationCategory: "GameApplication", inLanguage: "nl",
      offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" }, url: SITE,
    },
    { "@context": "https://schema.org", "@type": "Organization", name: "Klopt!", url: SITE, logo: `${SITE}/apple-touch-icon.png` },
  ];
  const gegevens = {
    slug: ronde.slug,
    pagina: isSpeel ? "speel" : ronde.slug,
    code,
    lopende_quiz: manifest.lopende_quiz ?? null,
    hoort_bij_lopend: !!manifest.lopende_quiz && manifest.lopende_quiz.naam === ronde.quiz,
  };
  const app = appBlok(ronde, manifest);
  const vervang = {
    APP_KOP: esc(app.kop),
    APP_TEKST: esc(app.tekst),
    TITEL: esc(titel),
    OMSCHRIJVING: esc(omschrijving),
    CANONICAL: esc(SITE + pad),
    LD_JSON: jsonInScript(ld),
    KOP: esc(kop),
    OPENING: esc(opening),
    WEBINTRO: esc(ronde.webintro),
    VOORPROEF: ronde.voorproef.map((/** @type {any} */ v) => `<li>${esc(v.tekst)}</li>`).join(""),
    CODE: esc(code),
    GEGEVENS: jsonInScript(gegevens),
  };
  // ⚠️ Eén ronde door de sjabloon, in één keer: een `{{…}}` in een vraagtekst wordt zo nooit vervangen.
  return sjabloon.replace(/\{\{([A-Z_]+)\}\}/g, (heel, k) => (k in vervang ? vervang[/** @type {keyof typeof vervang} */ (k)] : heel));
}

// ---------------------------------------------------------------------------------------------------------------
// 259 — de antwoordpagina /quiz/<slug>/antwoorden/. ⛔ Kern (eigenaar 26-11): spelen en lezen zijn aparte pagina's;
// de speelpagina hierboven verandert niet (genereer_test.mjs vergelijkt haar byte voor byte met vóór 259).
// ---------------------------------------------------------------------------------------------------------------

/**
 * Het onderwerp uit de omschrijving: "Tien vragen over familieruzies, vetes en …" → "familieruzies".
 * Tot de eerste komma; "van" blijft staan ("de geschiedenis van Europa"). Past het patroon niet: null.
 * @param {unknown} omschrijving
 */
export function onderwerp(omschrijving) {
  const m = /^tien vragen over (.+)$/i.exec(String(omschrijving ?? "").trim());
  if (!m) return null;
  const o = m[1].split(",")[0].trim();
  return o === "" ? null : o;
}

/** @param {any} ronde */
export function antwoordTitel(ronde) {
  const n = ronde.vragen.length;
  const o = onderwerp(ronde.omschrijving);
  return o ? `${n} quizvragen over ${o}, met antwoorden` : `${ronde.titel}: ${n} quizvragen met antwoorden`;
}

/** De marge zoals het spel hem vóór het antwoorden toont (speel.js, tekenVraag; principe VI). @param {any} extra */
const margeTekst = (extra) =>
  extra?.antwoordinstructie ? String(extra.antwoordinstructie) : extra?.marge !== undefined ? `Marge: ± ${extra.marge}` : null;

/** @param {any} v */
function vraagHtml(v) {
  const extra = v.extra ?? {};
  const delen = [`<p class="vraag-tekst">${esc(v.tekst)}</p>`];
  const marge = margeTekst(extra);
  if (marge) delen.push(`<p class="instructie">${esc(marge)}</p>`);
  if (v.type === "meerkeuze" && Array.isArray(extra.options) && extra.options.length > 0) {
    delen.push(`<ul class="keuzes">${extra.options.map((/** @type {unknown} */ o) => `<li>${esc(o)}</li>`).join("")}</ul>`);
  }
  if (v.type === "meervoud" && Array.isArray(extra.delen) && extra.delen.length > 0) {
    const labels = extra.delen.map((/** @type {any} */ d, /** @type {number} */ k) => d?.label || `Antwoord ${k + 1}`);
    delen.push(`<p class="stil">Te noemen: ${esc(labels.join(", "))}</p>`);
  }
  if (v.beeld) delen.push(`<img class="vraag-beeld" src="${esc(v.beeld)}" alt="${esc(`Foto bij vraag ${v.nummer}`)}" loading="lazy" decoding="async">`);
  if (v.fragment) delen.push(`<p class="stil">Bij deze vraag hoort een ${v.fragment === "video" ? "videofragment" : "geluidsfragment"}. Dat hoort u als u de ronde speelt.</p>`);
  const uitleg = v.uitleg ? `<p class="zacht">${esc(v.uitleg)}</p>` : "";
  delen.push(`<details><summary>Toon het antwoord</summary><div class="antwoord-blok"><p class="antwoord">${esc(v.antwoord)}</p>${uitleg}</div></details>`);
  return `<li>${delen.join("")}</li>`;
}

/** @param {any} ronde @param {any} manifest @param {string} sjabloon */
function antwoordPagina(ronde, manifest, sjabloon) {
  const pad = `/quiz/${ronde.slug}/antwoorden/`;
  const speel = `/quiz/${ronde.slug}/`;
  const n = ronde.vragen.length;
  const o = onderwerp(ronde.omschrijving);
  const naam = antwoordTitel(ronde);
  const omschrijving = o
    ? `${n} quizvragen over ${o}, met de antwoorden. Of speel de ronde eerst zelf: gratis online, zonder account.`
    : `${n} quizvragen met de antwoorden. Of speel de ronde eerst zelf: gratis online, zonder account.`;
  const app = appBlok(ronde, manifest);
  const ld = [
    {
      "@context": "https://schema.org", "@type": "Quiz", name: naam, inLanguage: "nl", url: SITE + pad,
      ...(o ? { about: { "@type": "Thing", name: o } } : {}),
      // Google (Onderwijs V&A) herkent een quiz alleen met eduQuestionType "Flashcard" per vraag (Rich Results Test 26-11).
      hasPart: ronde.vragen.map((/** @type {any} */ v) => ({
        "@type": "Question", eduQuestionType: "Flashcard", text: v.tekst,
        acceptedAnswer: { "@type": "Answer", text: v.antwoord },
      })),
    },
    {
      "@context": "https://schema.org", "@type": "MobileApplication", name: "Klopt!",
      operatingSystem: "iOS, Android", applicationCategory: "GameApplication", inLanguage: "nl",
      offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" }, url: SITE,
    },
    { "@context": "https://schema.org", "@type": "Organization", name: "Klopt!", url: SITE, logo: `${SITE}/apple-touch-icon.png` },
  ];
  const vervang = {
    TITEL: esc(`${naam} | Klopt!`),
    OMSCHRIJVING: esc(omschrijving),
    CANONICAL: esc(SITE + pad),
    LD_JSON: jsonInScript(ld),
    KOP: esc(ronde.titel),
    OPENING: esc(`${ronde.omschrijving}.`),
    SPEEL: esc(speel),
    VRAGEN_KOP: esc(n === 1 ? "De vraag" : `De ${n} vragen`),
    VRAGEN: ronde.vragen.map(vraagHtml).join(""),
    APP_KOP: esc(app.kop),
    APP_TEKST: esc(app.tekst),
    GEGEVENS: jsonInScript({ pagina: ronde.slug }),
  };
  return sjabloon.replace(/\{\{([A-Z_]+)\}\}/g, (heel, k) => (k in vervang ? vervang[/** @type {keyof typeof vervang} */ (k)] : heel));
}

/** Heeft deze ronde vragen voor een antwoordpagina? (Een manifest van vóór 259 niet.) @param {any} r */
const heeftVragen = (r) => Array.isArray(r.vragen) && r.vragen.length > 0;

// ⭐ De lijstpagina: de enige plek met links naar de rondes, en alleen bereikbaar via de voettekst van de homepage
// (besluit eigenaar 04-11). Zo vindt Google de rondes, terwijl een speler na een ronde alleen de weg naar de app ziet.
// ⚠️ Op iOS gaat de herkomst vanaf hier niet via het klembord: het klikken telt wel, de proefrondes blijven staan.
/** @param {any} manifest */
function lijstPagina(manifest) {
  const rondes = [...manifest.rondes].sort((/** @type {any} */ a, /** @type {any} */ b) => String(b.deadline).localeCompare(String(a.deadline)));
  const lopend = manifest.lopende_quiz?.naam;
  // 259: per ronde de antwoordpagina (titel op het onderwerp) en de speelpagina. Een ronde zonder vragen (manifest van
  // vóór 259) krijgt alleen de speellink, zoals vroeger.
  /** @param {any} r */
  const lijstRegel = (r) => heeftVragen(r)
    ? `<li><a href="/quiz/${esc(r.slug)}/antwoorden/">${esc(antwoordTitel(r))}</a><br><span class="zacht">${esc(r.titel)} · ${esc(r.omschrijving)}</span><br><a class="stil" href="/quiz/${esc(r.slug)}/">Speel deze ronde</a></li>`
    : `<li><a href="/quiz/${esc(r.slug)}/">${esc(r.titel)}</a><br><span class="zacht">${esc(r.omschrijving)}</span></li>`;
  const ld = {
    "@context": "https://schema.org", "@type": "CollectionPage", name: "Pubquiz vragen met antwoorden", inLanguage: "nl",
    url: `${SITE}/quizzen/`,
    mainEntity: {
      "@type": "ItemList",
      itemListElement: rondes.filter(heeftVragen).map((/** @type {any} */ r, /** @type {number} */ i) => ({
        "@type": "ListItem", position: i + 1, name: antwoordTitel(r), url: `${SITE}/quiz/${r.slug}/antwoorden/`,
      })),
    },
  };
  const app = lopend
    ? { kop: `Speel nu "${lopend}" in de app`, tekst: `In de app loopt nu "${lopend}", met een nieuw thema. ${OVER_APP}` }
    : appBlok({ quiz: null }, manifest);
  return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#17100B">
<title>Pubquiz vragen met antwoorden: ${rondes.length} rondes | Klopt!</title>
<meta name="description" content="Pubquizvragen met antwoorden, per onderwerp. Elke ronde ook gratis online te spelen, zonder account.">
<link rel="canonical" href="${SITE}/quizzen/">
<link rel="icon" href="/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/speel-bestanden/speel.css">
<script type="application/ld+json">${jsonInScript(ld)}</script>
</head>
<body>
<main>
  <a class="merk" href="/"><img src="/speel-bestanden/logo-96.png" alt="" width="48" height="48">Klopt!</a>
  <h1>Pubquiz vragen met antwoorden</h1>
  <p>Elke ronde van Klopt! met al haar vragen en de antwoorden, per onderwerp. Liever eerst zelf spelen? Elke ronde is gratis online te spelen, zonder account: tien vragen, tien minuten.</p>
  <ul class="ronde-lijst">${rondes.map(lijstRegel).join("")}</ul>
  <h2>${esc(app.kop)}</h2>
  <p>${esc(app.tekst)}</p>
  <a class="knop vol" href="/s/${LIJST_CODE}">Bekijk Klopt! in de winkel</a>
  <footer><a href="/">Over Klopt!</a> · <a href="/privacy/">Privacy</a></footer>
</main>
<script>try{var v="";try{v=document.referrer?new URL(document.referrer).hostname:""}catch(e){}fetch("/w/tel",{method:"POST",keepalive:true,headers:{"Content-Type":"application/json"},body:JSON.stringify({pagina:"quizzen",stap:"bezoek",verwijzer:v})}).catch(function(){})}catch(e){}</script>
</body>
</html>
`;
}

/** @param {any} manifest @param {string} sjabloon @param {string} [sjabloonAntwoorden] */
export function genereer(manifest, sjabloon, sjabloonAntwoorden) {
  /** @type {Record<string, string>} */
  const uit = {};
  const speel = manifest.rondes.find((/** @type {any} */ r) => r.slug === manifest.speel);
  uit["speel/index.html"] = pagina(speel, manifest, true, sjabloon);
  for (const r of manifest.rondes) uit[`quiz/${r.slug}/index.html`] = pagina(r, manifest, false, sjabloon);
  // 259: naast elke speelpagina een antwoordpagina (alleen als het manifest de vragen levert).
  const sjabloonA = sjabloonAntwoorden ?? readFileSync(join(HIER, "sjablonen", "antwoorden.html"), "utf8");
  for (const r of manifest.rondes.filter(heeftVragen)) uit[`quiz/${r.slug}/antwoorden/index.html`] = antwoordPagina(r, manifest, sjabloonA);
  uit["quizzen/index.html"] = lijstPagina(manifest);

  // De homepage staat in site/ en niet hier, maar /sitemap.xml is er maar één: zonder deze regel ontbrak hij (06-11).
  // Zonder lastmod: deze generator weet niet wanneer site/index.html wijzigde, en een verzonnen datum is erger dan geen.
  const regels = [
    { pad: "/", datum: null },
    { pad: "/speel/", datum: speel.deadline },
    { pad: "/quizzen/", datum: speel.deadline },
    ...manifest.rondes.map((/** @type {any} */ r) => ({ pad: `/quiz/${r.slug}/`, datum: r.deadline })),
    // 259: de antwoordpagina's, met de lastmod van hun ronde.
    ...manifest.rondes.filter(heeftVragen).map((/** @type {any} */ r) => ({ pad: `/quiz/${r.slug}/antwoorden/`, datum: r.deadline })),
  ];
  uit["sitemap.xml"] = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
    regels.map((r) => `  <url><loc>${SITE}${r.pad}</loc>${r.datum ? `<lastmod>${String(r.datum).slice(0, 10)}</lastmod>` : ""}</url>`).join("\n")
  }\n</urlset>\n`;
  return uit;
}

async function hoofd() {
  const [bron, doel] = process.argv.slice(2);
  if (!bron || !doel) { console.error("gebruik: genereer.mjs <manifest> <uitvoermap>"); process.exit(2); }
  const tekst = /^https?:/.test(bron) ? await (await fetch(bron)).text() : readFileSync(bron, "utf8");
  let manifest = null;
  try { manifest = JSON.parse(tekst); } catch { /* blijft null */ }
  if (!isGeldig(manifest)) {
    console.error("manifest leeg of ongeldig: niets geschreven");
    process.exit(3);
  }
  const uit = genereer(manifest, readFileSync(join(HIER, "sjablonen", "pagina.html"), "utf8"));
  for (const [pad, inhoud] of Object.entries(uit)) {
    mkdirSync(dirname(join(doel, pad)), { recursive: true });
    writeFileSync(join(doel, pad), inhoud, "utf8");
  }
  mkdirSync(join(doel, "speel-bestanden"), { recursive: true });
  copyFileSync(join(HIER, "speel.js"), join(doel, "speel-bestanden", "speel.js"));
  copyFileSync(join(HIER, "antwoorden.js"), join(doel, "speel-bestanden", "antwoorden.js")); // 259
  copyFileSync(join(HIER, "speel.css"), join(doel, "speel-bestanden", "speel.css"));
  copyFileSync(join(HIER, GELUID), join(doel, "speel-bestanden", GELUID));
  copyFileSync(join(HIER, LOGO), join(doel, "speel-bestanden", LOGO));
  // ⭐ Migratie 169: de vingerafdruk van wat hier staat. webronde-controle leest hem op Pages en start deze Action
  //    alleen als hij afwijkt van het huidige manifest. Ontbreekt hij in het manifest, dan geen bestand.
  if (typeof manifest.inhoud_hash === "string") {
    writeFileSync(join(doel, "speel-bestanden", "inhoud.txt"), `${manifest.inhoud_hash}\n`, "utf8");
  }
  console.log(`${Object.keys(uit).length} bestanden geschreven`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await hoofd();
