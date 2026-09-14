/* Neúplný zápis nesmí nic smazat.
 *
 * Proč to existuje: `save_klient` kdysi přepisoval všechny sloupce z payloadu,
 * takže zápis, který poslal jen část dat (formulář, budoucí edge funkce),
 * tiše smazal obchodníka i podřízené záznamy. Nikde to nehlásilo chybu —
 * klient prostě přišel o data.
 *
 * SPOUŠTĚT PO KAŽDÉ ZMĚNĚ save_klient:  node tests/test_neuplny_zapis.mjs
 */
import { prihlas, db, overit, vysledek } from "./lib.mjs";

const ID = "test_neuplny";
const at = await prihlas("jan.metlicky@gmail.com");
const d = db(at);

// --- 1) založit klienta se vším, co se dá ztratit ---------------------------
const obchodnik = (await d.get("uzivatele?select=id&limit=1"))[0].id;

await d.save({
  id: ID,
  jmeno: "Zkouška", prijmeni: "Neúplného zápisu",
  stav: "aktivni", stav_vztahu: "Aktivní klient",
  obchodnik_id: obchodnik,
  ida_url: "https://example.com/ida",
  onboarding: { email: "zkouska@example.com", telefon: "+420 111 222 333" },
  poradce: { segmentace: "B", dohoda: "Podepsána" },
  oblasti: [
    { klic: "zivot", stav: "Rozpracováno", faze: "Nová", poznamka: "pozn",
      polozky: [{ typ: "ŽP", instituce: "Pojišťovna Vzor", mesicni_platba: "1000", poznamka: "" }],
      faze_historie: [{ faze: "Nová", kdy: new Date().toISOString(), kdo: "test" }] },
    { klic: "investice", stav: "Audit", faze: "", poznamka: "", polozky: [], faze_historie: [] },
  ],
  komentare: [{ text: "Komentář, který musí přežít", kdy: new Date().toISOString() }],
  schuzky: [{ datum: "2026-09-01", typ: "Úvodní schůzka", souhrn: "Souhrn", odkaz: "", zdroj: "rucni" }],
  cile: [{ cil: "Renta", castka: "1000000", termin: "2040", stav: "aktivní" }],
  upravil: "test",
});

const pred = {
  klient: (await d.get(`klienti?id=eq.${ID}&select=*`))[0],
  oblasti: await d.get(`oblasti?klient_id=eq.${ID}&select=klic,stav`),
  komentare: await d.get(`komentare?klient_id=eq.${ID}&select=id`),
  schuzky: await d.get(`schuzky?klient_id=eq.${ID}&select=id`),
  cile: await d.get(`cile?klient_id=eq.${ID}&select=id`),
  polozky: await d.get(`oblasti_polozky?select=id,oblast_id`),
  historie: await d.get(`faze_historie?select=id`),
};
console.log("Příprava: klient založen se všemi typy záznamů");

// --- 2) zápis, který nese JEDINÉ pole ---------------------------------------
const r = await d.save({ id: ID, jmeno: "Změněné jméno", upraveno: pred.klient.upraveno, upravil: "test-neuplny" });
overit("neúplný zápis proběhl", r.ok, r.ok ? "" : r.telo.slice(0, 120));

const po = {
  klient: (await d.get(`klienti?id=eq.${ID}&select=*`))[0],
  oblasti: await d.get(`oblasti?klient_id=eq.${ID}&select=klic,stav`),
  komentare: await d.get(`komentare?klient_id=eq.${ID}&select=id`),
  schuzky: await d.get(`schuzky?klient_id=eq.${ID}&select=id`),
  cile: await d.get(`cile?klient_id=eq.${ID}&select=id`),
};

console.log("\nCo mělo zůstat nedotčené:");
overit("jméno se změnilo (zápis opravdu proběhl)", po.klient.jmeno === "Změněné jméno");
overit("obchodník zachován", po.klient.obchodnik_id === pred.klient.obchodnik_id);
overit("stav vztahu zachován", po.klient.stav_vztahu === pred.klient.stav_vztahu, po.klient.stav_vztahu);
overit("retenční stav zachován", po.klient.stav === pred.klient.stav);
overit("odkaz na IDA zachován", po.klient.ida_url === pred.klient.ida_url);
overit("onboarding jsonb zachován", po.klient.onboarding?.email === "zkouska@example.com");
overit("poradce jsonb zachován", po.klient.poradce?.segmentace === "B");
overit("odvozený e-mail zachován", po.klient.email === pred.klient.email, po.klient.email);
overit("příjmení zachováno", po.klient.prijmeni === pred.klient.prijmeni);
overit("oblasti zachovány", po.oblasti.length === pred.oblasti.length, `${pred.oblasti.length} → ${po.oblasti.length}`);
overit("stavy oblastí zachovány", po.oblasti.find((o) => o.klic === "zivot")?.stav === "Rozpracováno");
overit("komentáře zachovány", po.komentare.length === pred.komentare.length, `${pred.komentare.length} → ${po.komentare.length}`);
overit("schůzky zachovány", po.schuzky.length === pred.schuzky.length, `${pred.schuzky.length} → ${po.schuzky.length}`);
overit("cíle zachovány", po.cile.length === pred.cile.length, `${pred.cile.length} → ${po.cile.length}`);

// položky a historie visí na oblastech — smazání oblasti by je vzalo s sebou
const polozkyPo = await d.get("oblasti_polozky?select=id");
const historiePo = await d.get("faze_historie?select=id");
overit("položky oblastí zachovány", polozkyPo.length === pred.polozky.length,
  `${pred.polozky.length} → ${polozkyPo.length}`);
overit("historie fází zachována", historiePo.length === pred.historie.length,
  `${pred.historie.length} → ${historiePo.length}`);

// --- 3) prázdný seznam JE pokyn ke smazání ----------------------------------
// Rozdíl oproti výše: chybějící klíč = „neřeším", poslaný prázdný seznam = „smaž".
console.log("\nProtiklad — poslaný prázdný seznam má smazat:");
const k2 = (await d.get(`klienti?id=eq.${ID}&select=upraveno`))[0];
await d.save({ id: ID, upraveno: k2.upraveno, upravil: "test", komentare: [] });
const komentarePo = await d.get(`komentare?klient_id=eq.${ID}&select=id`);
overit("prázdný seznam komentářů smazal komentáře", komentarePo.length === 0);
overit("cíle tím ale nezmizely", (await d.get(`cile?klient_id=eq.${ID}&select=id`)).length === pred.cile.length);

// --- úklid ------------------------------------------------------------------
await fetch(`${(await import("./lib.mjs")).cfg.url}/rest/v1/klienti?id=eq.${ID}`, {
  method: "DELETE",
  headers: { apikey: (await import("./lib.mjs")).cfg.anon_key, Authorization: `Bearer ${at}` },
});
console.log("\nÚklid: testovací klient smazán");

vysledek("Neúplný zápis nic nemaže");
