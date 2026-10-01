/* Upload dokumentů — co server odmítne a co smí kdo vidět.
 *
 * - .pdf s obsahem EXE (MZ) → 400 (typ se bere z obsahu, ne z přípony)
 * - 20 MB → 413
 * - platné PDF → řádek `ceka_na_kontrolu`, cesta ve složce klienta, nahral_klient
 * - cesta je odvozená z tokenu — klient nemůže zvolit jinou složku (není kam ji poslat)
 * - smazaný dokument se v klient_pristup nevrací
 * - anon nedostane signed URL; tým ano
 *
 * Vlastní klient `test-upload`, úklid i při pádu (včetně souboru v bucketu).
 * Spouštění:  node tests/test_upload.mjs
 */
import { prihlas, db, cfg, overit, vysledek, sTestovacimiKlienty } from "./lib.mjs";

const ID = "test-upload";
const at = await prihlas("jan.metlicky@gmail.com");
const d = db(at);
const H = { apikey: cfg.anon_key, Authorization: `Bearer ${at}`, "Content-Type": "application/json" };
const sha = async (t) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map((x) => x.toString(16).padStart(2, "0")).join("");

async function zalozToken() {
  await fetch(`${cfg.url}/rest/v1/klient_pristup?klient_id=eq.${ID}&aktivni=eq.true`, { method: "PATCH", headers: H, body: JSON.stringify({ aktivni: false }) });
  const token = "test-token-" + crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const r = await fetch(`${cfg.url}/rest/v1/klient_pristup`, { method: "POST", headers: H, body: JSON.stringify({ klient_id: ID, token_hash: await sha(token), aktivni: true }) });
  if (!r.ok) throw new Error(`token: ${r.status}`);
  return token;
}
async function upload(token, bytes, nazev, extra = {}) {
  const fd = new FormData();
  fd.append("token", token); fd.append("soubor", new Blob([bytes]), nazev);
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  const r = await fetch(`${cfg.url}/functions/v1/klient_upload`, { method: "POST", body: fd });
  return { status: r.status, telo: await r.json().catch(() => ({})) };
}
const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n");
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, ...new Array(64).fill(0)]);           // MZ hlavička
const VELKY = new Uint8Array(20 * 1024 * 1024); VELKY.set([0x25, 0x50, 0x44, 0x46, 0x2d]);  // 20 MB, začíná jako PDF

const cesty = [];
await sTestovacimiKlienty(d, [ID], async () => {
  try {
    await d.save({ id: ID, jmeno: "Upl", prijmeni: "Oad", stav: "aktivni", upravil: "test",
      dokumenty: [{ nazev: "Občanský průkaz", stav: "nedodano", checklist_klic: "obcansky_prukaz" }] });
    const token = await zalozToken();

    console.log("odmítnutí na serveru:");
    const r1 = await upload(token, EXE, "faktura.pdf");
    overit(".pdf s obsahem EXE → 400 (typ z obsahu, ne z přípony)", r1.status === 400 && r1.telo.chyba === "typ", `${r1.status} ${JSON.stringify(r1.telo)}`);
    const r2 = await upload(token, VELKY, "velky.pdf");
    overit("20 MB → 413", r2.status === 413, String(r2.status));
    const r3 = await upload("x".repeat(60), PDF, "a.pdf");
    overit("neplatný token → 401", r3.status === 401);

    console.log("\nplatný upload:");
    const polozka = (await d.get(`dokumenty?klient_id=eq.${ID}&select=id`))[0];
    const r4 = await upload(token, PDF, "občanka ÚŘAD.pdf", { dokument_id: polozka.id });
    overit("HTTP 200", r4.status === 200, JSON.stringify(r4.telo));
    overit("odpověď bez URL", !JSON.stringify(r4.telo).includes("http"));
    const rad = (await d.get(`dokumenty?klient_id=eq.${ID}&select=*`))[0];
    cesty.push(rad.storage_path);
    overit("řádek doplněn do položky checklistu (ne nový)", (await d.get(`dokumenty?klient_id=eq.${ID}&select=id`)).length === 1);
    overit("stav = ceka_na_kontrolu", rad.stav === "ceka_na_kontrolu", rad.stav);
    overit("nahral_klient = true", rad.nahral_klient === true);
    overit("cesta ve složce klienta", rad.storage_path.startsWith(`${ID}/`), rad.storage_path);
    overit("název v cestě bez diakritiky a mezer", /\/[0-9a-f-]{36}-obcanka-URAD\.pdf$/.test(rad.storage_path), rad.storage_path);
    overit("mime podle obsahu", rad.mime === "application/pdf", rad.mime);
    overit("velikost sedí", rad.velikost === PDF.length);

    console.log("\nkdo soubor vidí:");
    const signAnon = await fetch(`${cfg.url}/storage/v1/object/sign/dokumenty/${rad.storage_path}`, { method: "POST",
      headers: { apikey: cfg.anon_key, Authorization: `Bearer ${cfg.anon_key}`, "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 60 }) });
    overit("anon nedostane signed URL", signAnon.status === 400 || signAnon.status === 401 || signAnon.status === 403, String(signAnon.status));
    const signTym = await fetch(`${cfg.url}/storage/v1/object/sign/dokumenty/${rad.storage_path}`, { method: "POST", headers: H, body: JSON.stringify({ expiresIn: 60 }) });
    overit("tým signed URL dostane", signTym.status === 200, String(signTym.status));
    const { signedURL } = await signTym.json().catch(() => ({}));
    if (signedURL) {
      const stazeno = await fetch(`${cfg.url}/storage/v1${signedURL}`);
      overit("signed URL vrátí původní obsah", stazeno.status === 200 && (await stazeno.text()).startsWith("%PDF-"));
    }
    const kp = await fetch(`${cfg.url}/functions/v1/klient_pristup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
    const kpTelo = await kp.json();
    overit("klient vidí ma_soubor=true, ale ne cestu", kpTelo.dokumenty?.[0]?.ma_soubor === true && !JSON.stringify(kpTelo).includes(rad.storage_path));

    console.log("\nsoft delete:");
    const k = (await d.get(`klienti?id=eq.${ID}&select=upraveno`))[0];
    await d.save({ id: ID, upraveno: k.upraveno, upravil: "test", dokumenty: [{ id: rad.id, smazano: "true" }] });
    const po = (await d.get(`dokumenty?id=eq.${rad.id}&select=smazano,storage_path`))[0];
    overit("řádek má smazano, soubor zůstal (cesta nezměněna)", !!po.smazano && po.storage_path === rad.storage_path);
    const kp2 = await (await fetch(`${cfg.url}/functions/v1/klient_pristup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) })).json();
    overit("smazaný dokument se klientovi nevrací", (kp2.dokumenty || []).length === 0);
  } finally {
    // úklid souborů v bucketu (admin smí mazat)
    for (const c of cesty) {
      await fetch(`${cfg.url}/storage/v1/object/dokumenty`, { method: "DELETE", headers: H, body: JSON.stringify({ prefixes: [c] }) });
    }
    if (cesty.length) console.log(`\nÚklid: smazáno ${cesty.length} souborů v bucketu`);
  }
});

vysledek("Upload dokumentů");
