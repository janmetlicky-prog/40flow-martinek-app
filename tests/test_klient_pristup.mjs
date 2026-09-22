/* Přístup klienta přes token — co smí a co nesmí.
 *
 * - platný token vrátí JEN klientskou část (žádné poradce, komentáře, schůzky, oblasti, id)
 * - neplatný / zneplatněný / vypršelý token → 401 se stejnou hláškou
 * - klient_ulozit: cizí klíče se ignorují, změna vyplněné hodnoty se zaloguje,
 *   smlouva se rozřadí do oblasti, poradce jsonb zůstane netknutý
 *
 * Vlastní klient `test-pristup`, úklid i při pádu.
 * Spouštění:  node tests/test_klient_pristup.mjs
 */
import { prihlas, db, cfg, overit, vysledek, sTestovacimiKlienty } from "./lib.mjs";

const ID = "test-pristup";
const at = await prihlas("jan.metlicky@gmail.com");
const d = db(at);
const H = { apikey: cfg.anon_key, Authorization: `Bearer ${at}`, "Content-Type": "application/json" };

async function sha256(t) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function zalozToken(platnost_do) {
  // jeden aktivní odkaz na klienta (unikátní index) — starý nejdřív zneplatnit
  await fetch(`${cfg.url}/rest/v1/klient_pristup?klient_id=eq.${ID}&aktivni=eq.true`, { method: "PATCH", headers: H, body: JSON.stringify({ aktivni: false }) });
  const token = "test-token-" + crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const r = await fetch(`${cfg.url}/rest/v1/klient_pristup`, { method: "POST", headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify({ klient_id: ID, token_hash: await sha256(token), aktivni: true, ...(platnost_do ? { platnost_do } : {}) }) });
  if (!r.ok) throw new Error(`token: ${r.status} ${await r.text()}`);
  return token;
}
async function fn(nazev, body) {
  const r = await fetch(`${cfg.url}/functions/v1/${nazev}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, telo: await r.json().catch(() => ({})) };
}

await sTestovacimiKlienty(d, [ID], async () => {
  const obchodnik = (await d.get("uzivatele?select=id&limit=1"))[0].id;
  await d.save({
    id: ID, jmeno: "Klára", prijmeni: "Přístupová", stav: "aktivni", stav_vztahu: "Aktivní klient",
    obchodnik_id: obchodnik,
    onboarding: { telefon: "+420 111 111 111", email: "klara@example.com", povolani: "Testerka",
      bilance: { prijmy: [{ popis: "Mzda", castka: "40000" }], vydaje: [], zavazky: [] }, smlouvy: [] },
    poradce: { segmentace: "A", rodne_cislo: "TAJNE" },
    oblasti: [{ klic: "zivot", stav: "Rozpracováno", faze: "", poznamka: "interní",
      polozky: [{ typ: "ŽP od poradce", instituce: "X", mesicni_platba: "1", poznamka: "" }], faze_historie: [] }],
    komentare: [{ text: "Interní komentář", kdy: new Date().toISOString() }],
    schuzky: [{ datum: "2026-09-01", typ: "Úvodní schůzka", souhrn: "Tajný souhrn", odkaz: "", zdroj: "rucni" }],
    cile: [{ cil: "Tajný cíl", castka: "1", termin: "2030", stav: "aktivní" }],
    dokumenty: [{ nazev: "Občanský průkaz", stav: "nedodano", checklist_klic: "obcansky_prukaz" }],
    upravil: "test",
  });
  // soft-smazaný dokument (klient ho nesmí vidět)
  const k0 = (await d.get(`klienti?id=eq.${ID}&select=upraveno`))[0];
  await d.save({ id: ID, upraveno: k0.upraveno, upravil: "test", dokumenty: [{ nazev: "Smazaný", stav: "nedodano" }] });
  const smaz = (await d.get(`dokumenty?klient_id=eq.${ID}&nazev=eq.Smazaný&select=id`))[0];
  const k1 = (await d.get(`klienti?id=eq.${ID}&select=upraveno`))[0];
  await d.save({ id: ID, upraveno: k1.upraveno, upravil: "test", dokumenty: [{ id: smaz.id, smazano: "true" }] });

  const token = await zalozToken();

  console.log("klient_pristup — platný token:");
  const r = await fn("klient_pristup", { token });
  overit("HTTP 200", r.status === 200, String(r.status));
  const t = r.telo;
  overit("klíče odpovědi přesně [klient, onboarding, dokumenty, platnost_do]",
    JSON.stringify(Object.keys(t).sort()) === JSON.stringify(["dokumenty", "klient", "onboarding", "platnost_do"]), Object.keys(t).join(","));
  overit("klient má jen jmeno/prijmeni/poradce", JSON.stringify(Object.keys(t.klient || {}).sort()) === JSON.stringify(["jmeno", "poradce", "prijmeni"]));
  overit("poradce = jméno, ne id", t.klient?.poradce && !/^[0-9a-f-]{36}$/.test(t.klient.poradce), t.klient?.poradce);
  const text = JSON.stringify(t);
  overit("nikde poradce jsonb (TAJNE)", !text.includes("TAJNE"));
  overit("nikde komentář", !text.includes("Interní komentář"));
  overit("nikde schůzka", !text.includes("Tajný souhrn"));
  overit("nikde cíl", !text.includes("Tajný cíl"));
  overit("nikde položka z karty (oblasti_polozky)", !text.includes("ŽP od poradce"));
  overit("nikde id klienta", !text.includes(ID));
  overit("onboarding jen povolené klíče", !("dokumenty" in (t.onboarding || {})) && "telefon" in (t.onboarding || {}));
  overit("dokument bez storage_path/nahral/mime", (t.dokumenty || []).every((x) => JSON.stringify(Object.keys(x).sort()) === JSON.stringify(["id", "ma_soubor", "nazev", "stav"])));
  overit("smazaný dokument se nevrací", !(t.dokumenty || []).some((x) => x.nazev === "Smazaný"));

  console.log("\nneplatné tokeny:");
  overit("smyšlený → 401", (await fn("klient_pristup", { token: "x".repeat(60) })).status === 401);
  const vyprsely = await zalozTokenVyprsely();
  overit("vypršelý → 401", (await fn("klient_pristup", { token: vyprsely })).status === 401);
  await fetch(`${cfg.url}/rest/v1/klient_pristup?klient_id=eq.${ID}&aktivni=eq.true`, { method: "PATCH", headers: H, body: JSON.stringify({ aktivni: false }) });
  overit("zneplatněný → 401", (await fn("klient_pristup", { token })).status === 401);
  overit("hláška je stejná (neprozradí důvod)", (await fn("klient_pristup", { token })).telo.chyba === "neplatny_odkaz");

  console.log("\nklient_ulozit:");
  const token2 = await zalozToken();
  const u = await fn("klient_ulozit", { token: token2, onboarding: {
    telefon: "+420 999 999 999", email: "klara@example.com", povolani: "Testerka",
    bilance: { prijmy: [{ popis: "Mzda", castka: "40000" }], vydaje: [], zavazky: [] },
    smlouvy: [{ typ: "Hypotéka", instituce: "Banka Vzor", mesicni_platba: "15000", poznamka: "" }],
    rodne_cislo: "PODVRZENE", poradce: { segmentace: "Z" }, komentare: [{ text: "hack" }],
  } });
  overit("HTTP 200", u.status === 200, JSON.stringify(u.telo));
  const po = (await d.get(`klienti?id=eq.${ID}&select=onboarding,poradce,upravil,komentare(text),oblasti(klic,stav,oblasti_polozky(typ))`))[0];
  overit("telefon změněn", po.onboarding.telefon === "+420 999 999 999");
  overit("cizí klíč rodne_cislo neprošel do onboarding", !("rodne_cislo" in po.onboarding));
  overit("poradce jsonb netknutý", po.poradce.segmentace === "A" && po.poradce.rodne_cislo === "TAJNE");
  overit("komentáře netknuté", po.komentare.length === 1 && po.komentare[0].text === "Interní komentář");
  overit("upravil = klient", po.upravil === "klient");
  const ub = po.oblasti.find((o) => o.klic === "uver_bydleni");
  overit("hypotéka rozřazena do uver_bydleni, stav prázdný (→ „nové")", ub && ub.stav === "" && ub.oblasti_polozky.some((x) => x.typ === "Hypotéka"));
  overit("položka poradce v zivot zůstala", po.oblasti.find((o) => o.klic === "zivot").oblasti_polozky.some((x) => x.typ === "ŽP od poradce"));
  const zm = await d.get(`onboarding_zmeny?klient_id=eq.${ID}&select=pole,stara,nova,zdroj`);
  overit("změna telefonu zalogována (zdroj klient)", zm.some((z) => z.pole === "telefon" && z.zdroj === "klient" && z.stara === "+420 111 111 111"));
  overit("přidání smluv (dřív prázdné) se neloguje jako změna", !zm.some((z) => z.pole === "smlouvy"));
  overit("odpověď nese seznam chybějícího", Array.isArray(u.telo.chybi) && u.telo.chybi.includes("Občanský průkaz"));

  async function zalozTokenVyprsely() { return zalozToken(new Date(Date.now() - 60_000).toISOString()); }
});

vysledek("Přístup klienta");
