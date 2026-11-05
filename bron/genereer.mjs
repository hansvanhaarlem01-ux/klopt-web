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
    m.rondes.every((/** @type {any} */ r) => /^[a-z0-9]{1,20}$/.test(r.slug) && Array.isArray(r.voorproef) && r.voorproef.length === 3);
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

// ⭐ De lijstpagina: de enige plek met links naar de rondes, en alleen bereikbaar via de voettekst van de homepage
// (besluit eigenaar 04-11). Zo vindt Google de rondes, terwijl een speler na een ronde alleen de weg naar de app ziet.
// ⚠️ Op iOS gaat de herkomst vanaf hier niet via het klembord: het klikken telt wel, de proefrondes blijven staan.
/** @param {any} manifest */
function lijstPagina(manifest) {
  const rondes = [...manifest.rondes].sort((/** @type {any} */ a, /** @type {any} */ b) => String(b.deadline).localeCompare(String(a.deadline)));
  const lopend = manifest.lopende_quiz?.naam;
  const app = lopend
    ? { kop: `Speel nu "${lopend}" in de app`, tekst: `In de app loopt nu "${lopend}", met een nieuw thema. ${OVER_APP}` }
    : appBlok({ quiz: null }, manifest);
  return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#17100B">
<title>Online quizzen met 10 vragen: eerdere rondes | Klopt!</title>
<meta name="description" content="Eerdere rondes van Klopt!, de Nederlandse pubquiz-app. Gratis online te spelen, zonder account: tien vragen, tien minuten.">
<link rel="canonical" href="${SITE}/quizzen/">
<link rel="icon" href="/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/speel-bestanden/speel.css">
</head>
<body>
<main>
  <a class="merk" href="/"><img src="/speel-bestanden/logo-96.png" alt="" width="48" height="48">Klopt!</a>
  <h1>Eerdere rondes</h1>
  <p>Elke ronde is gratis online te spelen, zonder account: tien vragen, tien minuten.</p>
  <ul class="ronde-lijst">${rondes.map((r) => `<li><a href="/quiz/${esc(r.slug)}/">${esc(r.titel)}</a><br><span class="zacht">${esc(r.omschrijving)}</span></li>`).join("")}</ul>
  <h2>${esc(app.kop)}</h2>
  <p>${esc(app.tekst)}</p>
  <a class="knop vol" href="/s/${LIJST_CODE}">Bekijk Klopt! in de winkel</a>
  <footer><a href="/">Over Klopt!</a> · <a href="/privacy/">Privacy</a></footer>
</main>
<script>try{fetch("/w/tel",{method:"POST",keepalive:true,headers:{"Content-Type":"application/json"},body:JSON.stringify({pagina:"quizzen",stap:"bezoek"})}).catch(function(){})}catch(e){}</script>
</body>
</html>
`;
}

/** @param {any} manifest @param {string} sjabloon */
export function genereer(manifest, sjabloon) {
  /** @type {Record<string, string>} */
  const uit = {};
  const speel = manifest.rondes.find((/** @type {any} */ r) => r.slug === manifest.speel);
  uit["speel/index.html"] = pagina(speel, manifest, true, sjabloon);
  for (const r of manifest.rondes) uit[`quiz/${r.slug}/index.html`] = pagina(r, manifest, false, sjabloon);
  uit["quizzen/index.html"] = lijstPagina(manifest);

  const regels = [
    { pad: "/speel/", datum: speel.deadline },
    { pad: "/quizzen/", datum: speel.deadline },
    ...manifest.rondes.map((/** @type {any} */ r) => ({ pad: `/quiz/${r.slug}/`, datum: r.deadline })),
  ];
  uit["sitemap.xml"] = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
    regels.map((r) => `  <url><loc>${SITE}${r.pad}</loc><lastmod>${String(r.datum).slice(0, 10)}</lastmod></url>`).join("\n")
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
  copyFileSync(join(HIER, "speel.css"), join(doel, "speel-bestanden", "speel.css"));
  copyFileSync(join(HIER, GELUID), join(doel, "speel-bestanden", GELUID));
  copyFileSync(join(HIER, LOGO), join(doel, "speel-bestanden", LOGO));
  console.log(`${Object.keys(uit).length} bestanden geschreven`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await hoofd();
