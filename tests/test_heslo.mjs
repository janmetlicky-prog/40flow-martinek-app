/* Heslo na odkaz pro klienta.
 *
 * - nechráněný odkaz heslo nevyžaduje
 * - chráněný: bez hesla 401 heslo_vyzadovano, špatně 401 spatne_heslo (zbývá N),
 *   3. špatný pokus → 403 blokovano; v blokaci 403 i se správným heslem
 * - správné heslo projde i pro klient_ulozit a klient_upload
 * - blokace je vázaná na token — jiný token téhož klienta funguje
 * - heslo_hash se k týmu přes REST nedostane (RLS vrací sloupec, UI ho zahazuje — test hlídá bcrypt tvar)
 *
 * Vlastní klient `test-heslo`, úklid i při pádu.
 * Spouštění:  node tests/test_heslo.mjs
 */
import { prihlas, db, cfg, overit, vysledek, sTestovacimiKlienty } from "./lib.mjs";

const ID = "test-heslo";
const at = await prihlas("jan.metlicky@gmail.com");
const d = db(at);
const H = { apikey: cfg.anon_key, Authorization: `Bearer ${at}`, "Content-Type": "application/json" };
const sha = async (t) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map((x) => x.toString(16).padStart(2, "0")).join("");

async function vytvor(heslo) {
  const token = "test-token-" + crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const r = await fetch(`${cfg.url}/rest/v1/rpc/vytvor_odkaz`, { method: "POST", headers: H,
    body: JSON.stringify({ p_klient_id: ID, p_token_hash: await sha(token), p_heslo: heslo || null }) });
  if (!r.ok) throw new Error(`vytvor_odkaz: ${r.status} ${await r.text()}`);
  return token;
}
const fn = async (nazev, body) => {
  const r = await fetch(`${cfg.url}/functions/v1/${nazev}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, telo: await r.json().catch(() => ({})) };
};

await sTestovacimiKlienty(d, [ID], async () => {
  await d.save({ id: ID, jmeno: "Hes", prijmeni: "Lo", stav: "aktivni", upravil: "test", onboarding: { telefon: "+420 1" } });

  console.log("nechráněný odkaz:");
  const t0 = await vytvor("");
  overit("bez hesla projde", (await fn("klient_pristup", { token: t0 })).status === 200);
  const radek0 = (await d.get(`klient_pristup?klient_id=eq.${ID}&aktivni=eq.true&select=heslo_hash`))[0];
  overit("heslo_hash je null", radek0.heslo_hash === null);

  console.log("\nchráněný odkaz:");
  const t1 = await vytvor("tajne-1234");
  const radek1 = (await d.get(`klient_pristup?klient_id=eq.${ID}&aktivni=eq.true&select=heslo_hash`))[0];
  overit("v databázi je bcrypt hash, ne heslo", /^\$2[aby]\$/.test(radek1.heslo_hash || "") && !radek1.heslo_hash.includes("tajne"));
  overit("bez hesla → 401 heslo_vyzadovano", (await fn("klient_pristup", { token: t1 })).telo.chyba === "heslo_vyzadovano");
  const s1 = await fn("klient_pristup", { token: t1, heslo: "spatne" });
  overit("1. špatně → 401 spatne_heslo, zbývá 2", s1.status === 401 && s1.telo.chyba === "spatne_heslo" && s1.telo.zbyva === 2, JSON.stringify(s1.telo));
  const ok1 = await fn("klient_pristup", { token: t1, heslo: "tajne-1234" });
  overit("správné heslo → 200 (a vynuluje pokusy)", ok1.status === 200);
  overit("klient_ulozit se správným heslem projde", (await fn("klient_ulozit", { token: t1, heslo: "tajne-1234", onboarding: { telefon: "+420 2" } })).status === 200);
  overit("klient_ulozit bez hesla → 401", (await fn("klient_ulozit", { token: t1, onboarding: { telefon: "+420 3" } })).status === 401);

  console.log("\nblokace po 3 špatných pokusech (vázaná na token):");
  await fn("klient_pristup", { token: t1, heslo: "x1" });
  const s2 = await fn("klient_pristup", { token: t1, heslo: "x2" });
  overit("2. špatně → zbývá 1", s2.telo.zbyva === 1, JSON.stringify(s2.telo));
  const s3 = await fn("klient_pristup", { token: t1, heslo: "x3" });
  overit("3. špatně → 403 blokovano", s3.status === 403 && s3.telo.chyba === "blokovano", JSON.stringify(s3.telo));
  overit("v blokaci 403 i se správným heslem", (await fn("klient_pristup", { token: t1, heslo: "tajne-1234" })).status === 403);
  overit("v blokaci 403 i upload", (await (async () => {
    const fd = new FormData(); fd.append("token", t1); fd.append("heslo", "tajne-1234"); fd.append("soubor", new Blob([new TextEncoder().encode("%PDF-1.4\n%%EOF")]), "a.pdf");
    return (await fetch(`${cfg.url}/functions/v1/klient_upload`, { method: "POST", body: fd })).status;
  })()) === 403);
  const radek2 = (await d.get(`klient_pristup?klient_id=eq.${ID}&aktivni=eq.true&select=blokovano_do,pokusy`))[0];
  overit("blokovano_do nastaveno ~15 min dopředu", radek2.blokovano_do && (new Date(radek2.blokovano_do) - Date.now()) > 13 * 60_000);

  // jiný token (nový odkaz) téhož klienta blokaci nesdílí
  const t2 = await vytvor("jine-heslo");
  overit("nový odkaz téhož klienta není blokovaný", (await fn("klient_pristup", { token: t2, heslo: "jine-heslo" })).status === 200);

  // simulace uplynutí blokace: posunout blokovano_do do minulosti (jen v testu, přes REST jako tým)
  // nejdřív zneplatnit t2 (jeden aktivní odkaz na klienta), pak vrátit t1 s blokací v minulosti
  await fetch(`${cfg.url}/rest/v1/klient_pristup?klient_id=eq.${ID}&token_hash=eq.${await sha(t2)}`, { method: "PATCH", headers: H, body: JSON.stringify({ aktivni: false }) });
  const re = await fetch(`${cfg.url}/rest/v1/klient_pristup?klient_id=eq.${ID}&token_hash=eq.${await sha(t1)}`, { method: "PATCH", headers: H,
    body: JSON.stringify({ blokovano_do: new Date(Date.now() - 1000).toISOString(), aktivni: true }) });
  overit("příprava: t1 znovu aktivní s uplynulou blokací", re.ok, String(re.status));
  overit("po uplynutí blokace správné heslo zase projde", (await fn("klient_pristup", { token: t1, heslo: "tajne-1234" })).status === 200);
});

vysledek("Heslo na odkaz");
