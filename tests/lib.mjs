/* Společné pomůcky pro testy proti živé databázi.
 * Testy běží jako přihlášený uživatel, takže procházejí i RLS politikami —
 * stejnou cestou jako aplikace, ne obchvatem přes service klíč. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const env = Object.fromEntries(
  readFileSync(join(ROOT, ".env"), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => l.split(/=(.*)/s).slice(0, 2)));

export const cfg = JSON.parse(readFileSync(join(ROOT, "config/app.json"), "utf8")).supabase;

/** Přihlásí se jako daný uživatel a vrátí přístupový token. */
export async function prihlas(email) {
  const r = await fetch(`${cfg.url}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email }),
  });
  const { hashed_token } = await r.json();
  const v = await fetch(`${cfg.url}/auth/v1/verify?token=${hashed_token}&type=magiclink`,
    { headers: { apikey: cfg.anon_key }, redirect: "manual" });
  const loc = v.headers.get("location") || "";
  const at = new URLSearchParams(loc.split("#")[1] || "").get("access_token");
  if (!at) throw new Error(`Přihlášení ${email} selhalo`);
  return at;
}

/**
 * PRAVIDLO PRO VŠECHNY TESTY: nikdy nezapisovat na klienty, které vidí tým
 * (t0001–t0005 ani cokoli jiného). Test si založí vlastního klienta s prefixem
 * `test-` a po sobě ho smaže — i když spadne uprostřed (viz sTestovacimiKlienty).
 * Tahle vrstva to vynucuje: zápis na id bez prefixu `test-` odmítne.
 */
export const TEST_PREFIX = "test-";

function overTestovaciId(id) {
  if (typeof id !== "string" || !id.startsWith(TEST_PREFIX)) {
    throw new Error(`Test smí zapisovat jen na klienty s prefixem "${TEST_PREFIX}", ne na "${id}".`);
  }
}

/** Klient databáze se stejným přístupem, jaký má aplikace v prohlížeči. */
export function db(at) {
  const h = { apikey: cfg.anon_key, Authorization: `Bearer ${at}`, "Content-Type": "application/json" };
  return {
    async get(dotaz) {
      const r = await fetch(`${cfg.url}/rest/v1/${dotaz}`, { headers: h });
      if (!r.ok) throw new Error(`GET ${dotaz} → ${r.status}`);
      return r.json();
    },
    async save(p) {
      overTestovaciId(p && p.id);
      const r = await fetch(`${cfg.url}/rest/v1/rpc/save_klient`, {
        method: "POST", headers: h, body: JSON.stringify({ p }),
      });
      return { ok: r.ok, telo: await r.text() };
    },
    async smaz(id) {
      overTestovaciId(id);
      await fetch(`${cfg.url}/rest/v1/klienti?id=eq.${encodeURIComponent(id)}`, {
        method: "DELETE", headers: h,
      });
    },
  };
}

/**
 * Spustí test s vlastními klienty a po skončení je smaže — i po výjimce.
 * ids: seznam id (musí začínat `test-`), fn: async tělo testu.
 */
export async function sTestovacimiKlienty(d, ids, fn) {
  ids.forEach(overTestovaciId);
  try {
    await fn();
  } finally {
    for (const id of ids) {
      try { await d.smaz(id); } catch (e) { console.log(`  (úklid ${id} selhal: ${e.message})`); }
    }
    console.log(`\nÚklid: smazáno ${ids.length} testovacích klientů`);
  }
}

// --- jednoduché vyhodnocení -------------------------------------------------
let chyb = 0;

export function overit(popis, podminka, detail = "") {
  const ok = !!podminka;
  if (!ok) chyb += 1;
  console.log(`  ${ok ? "✓" : "✗"} ${popis}${detail ? ` — ${detail}` : ""}`);
}

export function vysledek(nazev) {
  console.log(chyb === 0 ? `\n✓ ${nazev}: PROŠLO` : `\n✗ ${nazev}: ${chyb} selhání`);
  process.exit(chyb === 0 ? 0 : 1);
}
