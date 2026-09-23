// Společný kód edge funkcí pro přístup klienta.
//
// Bezpečnostní zásady:
//  - Service klíč jde VÝHRADNĚ z prostředí (Supabase Secrets), nikdy z kódu.
//  - Token z odkazu se nikdy neukládá; porovnává se jeho SHA-256.
//  - Jedna chybová odpověď pro neplatný / vypršelý / zneplatněný token —
//    volající nezjistí, jestli token někdy existoval.
//  - Klient dostává jen povolený seznam klíčů (ALLOWED_ONBOARDING), ne celý jsonb.

import { createClient } from "npm:@supabase/supabase-js@2";

export const CORS = {
  "Access-Control-Allow-Origin": "*",          // přístup chrání token, ne origin
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const LIMIT_VOLANI_ZA_HODINU = 20;

/** Klíče onboardingu, které klient smí vidět i měnit. Nic mimo seznam neprojde ani tam, ani zpět. */
export const ALLOWED_ONBOARDING = [
  "telefon", "email",
  "adresa_trvala", "adresa_korespondencni_shodna", "adresa_korespondencni",
  "rodinny_stav", "povolani", "zdroj_prijmu",
  "bilance", "smlouvy",
] as const;

export function admin() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Chybí SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY v Secrets.");
  return createClient(url, key, { auth: { persistSession: false } });
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

export const NEPLATNY = () => json({ chyba: "neplatny_odkaz" }, 401);

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface Pristup { id: string; klient_id: string; platnost_do: string; }

/**
 * Ověří token, uplatní rate limit a zapíše pouzito_naposledy.
 * Vrací přístup, nebo hotovou chybovou Response.
 */
export async function overToken(token: unknown): Promise<Pristup | Response> {
  if (typeof token !== "string" || token.length < 32 || token.length > 128) return NEPLATNY();
  const db = admin();
  const hash = await sha256(token);
  const { data: p } = await db.from("klient_pristup")
    .select("id, klient_id, platnost_do, aktivni, volani_pocet, volani_od")
    .eq("token_hash", hash).maybeSingle();
  if (!p || !p.aktivni || new Date(p.platnost_do) < new Date()) return NEPLATNY();

  // rate limit: klouzavé hodinové okno per token
  const okno = new Date(p.volani_od);
  const vOkne = Date.now() - okno.getTime() < 3600_000;
  const pocet = vOkne ? p.volani_pocet : 0;
  if (pocet >= LIMIT_VOLANI_ZA_HODINU) return json({ chyba: "limit" }, 429);
  await db.from("klient_pristup").update({
    volani_pocet: pocet + 1,
    volani_od: vOkne ? p.volani_od : new Date().toISOString(),
    pouzito_naposledy: new Date().toISOString(),
  }).eq("id", p.id);

  return { id: p.id, klient_id: p.klient_id, platnost_do: p.platnost_do };
}

/**
 * Kanonický tvar pro porovnání: seřazené klíče, prázdné hodnoty sjednocené.
 * jsonb v Postgresu klíče přeskládá, takže porovnání JSON.stringify(a) === JSON.stringify(b)
 * hlásilo změnu i tam, kde žádná nebyla.
 */
export function kanon(v: unknown): string {
  const norm = (x: unknown): unknown => {
    if (x === undefined || x === null || x === "") return null;
    if (Array.isArray(x)) return x.map(norm);
    if (typeof x === "object") {
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(x as object).sort()) {
        const n = norm((x as Record<string, unknown>)[k]);
        if (n !== null) o[k] = n;
      }
      return Object.keys(o).length ? o : null;
    }
    return x;
  };
  return JSON.stringify(norm(v));
}

/** Z libovolného objektu vybere jen povolené klíče onboardingu. */
export function jenPovolene(onb: Record<string, unknown> | null | undefined) {
  const out: Record<string, unknown> = {};
  const src = onb || {};
  for (const k of ALLOWED_ONBOARDING) out[k] = src[k] ?? null;
  // výchozí tvary, ať klient nedostane null tam, kde čeká strukturu
  if (!out.adresa_trvala) out.adresa_trvala = { ulice: "", cislo: "", mesto: "", psc: "" };
  if (out.adresa_korespondencni_shodna == null) out.adresa_korespondencni_shodna = true;
  if (!out.bilance) out.bilance = { prijmy: [], vydaje: [], zavazky: [] };
  if (!Array.isArray(out.smlouvy)) out.smlouvy = [];
  for (const k of ["telefon", "email", "rodinny_stav", "povolani", "zdroj_prijmu"]) if (out[k] == null) out[k] = "";
  return out;
}
