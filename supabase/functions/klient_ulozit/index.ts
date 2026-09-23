// klient_ulozit — klient uloží změny své části.
//
// Vstup:  POST { token, onboarding: {…} }
// Chování:
//  - z payloadu se vezmou JEN povolené klíče; cokoli jiného se tiše ignoruje
//  - změny proti hodnotám, které byly vyplněné dřív, se zalogují do onboarding_zmeny
//    (poradce v kartě vidí „klient upravil N polí")
//  - smlouvy se rozřadí do oblastí (config/oblasti.json z aplikace), stav oblasti
//    se nemění → v kartě svítí „nové"
//  - zápis přes save_klient jen s klíči onboarding (+ oblasti, když přibyla smlouva)

import { admin, json, overToken, jenPovolene, kanon, ALLOWED_ONBOARDING, CORS } from "../_shared/klient.ts";

const APP_URL = Deno.env.get("APP_URL") || "https://janmetlicky-prog.github.io/40flow-martinek-app";

type Mapa = { mapovani: { oblast: string; klice: string[] }[]; vychozi: string };

async function nactiMapu(): Promise<Mapa> {
  try {
    const r = await fetch(`${APP_URL}/config/oblasti.json`, { headers: { "cache-control": "no-cache" } });
    if (r.ok) return await r.json();
  } catch { /* níže záloha */ }
  return { mapovani: [], vychozi: "ostatni" };
}

function oblastProTyp(typ: string, mapa: Mapa) {
  const t = (typ || "").toLowerCase();
  for (const m of mapa.mapovani) if (m.klice.some((k) => t.includes(k))) return m.oblast;
  return mapa.vychozi;
}

const prazdne = (v: unknown) =>
  v == null || v === "" || (Array.isArray(v) && v.length === 0) ||
  (typeof v === "object" && !Array.isArray(v) && Object.values(v as object).every((x) => prazdne(x)));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ chyba: "metoda" }, 405);

  let body: { token?: unknown; onboarding?: Record<string, unknown> } = {};
  try { body = await req.json(); } catch { return json({ chyba: "telo" }, 400); }
  const p = await overToken(body.token);
  if (p instanceof Response) return p;
  if (!body.onboarding || typeof body.onboarding !== "object") return json({ chyba: "telo" }, 400);

  const db = admin();
  const { data: k } = await db.from("klienti").select("id, onboarding, upraveno").eq("id", p.klient_id).maybeSingle();
  if (!k) return json({ chyba: "neplatny_odkaz" }, 401);

  const stare = (k.onboarding || {}) as Record<string, unknown>;
  const nove = jenPovolene(body.onboarding);   // cizí klíče zahozeny

  // --- log změn: jen tam, kde dřív něco bylo a teď je to jinak ---------------
  const zmeny: { klient_id: string; pole: string; stara: unknown; nova: unknown; zdroj: string }[] = [];
  for (const kl of ALLOWED_ONBOARDING) {
    const a = stare[kl], b = nove[kl];
    if (kanon(a) !== kanon(b) && !prazdne(a)) {
      zmeny.push({ klient_id: k.id, pole: kl, stara: a ?? null, nova: b ?? null, zdroj: "klient" });
    }
  }

  // --- smlouvy → oblasti (bez změny stavu, přibude jen položka) ---------------
  let oblastiPayload: unknown[] | null = null;
  const smlouvy = (nove.smlouvy as { typ?: string; instituce?: string; mesicni_platba?: string; poznamka?: string }[]) || [];
  if (smlouvy.length) {
    const mapa = await nactiMapu();
    const { data: obl } = await db.from("oblasti")
      .select("id, klic, stav, faze, poznamka, oblasti_polozky(typ, instituce, mesicni_platba, poznamka), faze_historie(faze, kdy, kdo)")
      .eq("klient_id", k.id);
    const byKlic = new Map<string, any>();
    for (const o of obl || []) byKlic.set(o.klic, {
      klic: o.klic, stav: o.stav, faze: o.faze, poznamka: o.poznamka,
      polozky: [...(o.oblasti_polozky || [])], faze_historie: [...(o.faze_historie || [])],
    });
    let pridano = 0;
    for (const s of smlouvy) {
      if (!s.typ && !s.instituce) continue;
      const key = oblastProTyp(s.typ || "", mapa);
      if (!byKlic.has(key)) byKlic.set(key, { klic: key, stav: "", faze: "", poznamka: "", polozky: [], faze_historie: [] });
      const o = byKlic.get(key);
      const platba = s.mesicni_platba || "";
      if (!o.polozky.some((x: any) => x.typ === s.typ && x.instituce === s.instituce && x.mesicni_platba === platba)) {
        o.polozky.push({ typ: s.typ || "", instituce: s.instituce || "", mesicni_platba: platba, poznamka: s.poznamka || "" });
        pridano++;
      }
    }
    if (pridano) oblastiPayload = [...byKlic.values()];
  }

  const payload: Record<string, unknown> = {
    id: k.id, upraveno: k.upraveno, upravil: "klient",
    onboarding: { ...stare, ...nove },   // mimo-povolené klíče z DB zůstávají, jak byly
  };
  if (oblastiPayload) payload.oblasti = oblastiPayload;

  const { error } = await db.rpc("save_klient", { p: payload });
  if (error) {
    const konflikt = /KONFLIKT/.test(error.message);
    return json({ chyba: konflikt ? "konflikt" : "ulozeni" }, konflikt ? 409 : 500);
  }
  if (zmeny.length) await db.from("onboarding_zmeny").insert(zmeny);

  // co ještě chybí — pro potvrzovací obrazovku klienta
  const { data: doky } = await db.from("dokumenty").select("nazev, stav")
    .eq("klient_id", k.id).is("smazano", null).eq("stav", "nedodano");
  const chybi: string[] = [];
  if (!nove.telefon) chybi.push("telefon");
  if (!nove.email) chybi.push("e-mail");
  for (const d of doky || []) chybi.push(d.nazev);

  return json({ ok: true, zmen: zmeny.length, chybi });
});
