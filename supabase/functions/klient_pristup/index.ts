// klient_pristup — klient s platným odkazem dostane SVOU část dat.
//
// Vstup:  POST { token }
// Výstup: { klient: {jmeno, prijmeni, poradce}, onboarding: {…povolené klíče…},
//           dokumenty: [{id, nazev, stav, ma_soubor}], platnost_do }
// Nikdy: poradce jsonb, komentáře, schůzky, cíle, oblasti, jiní klienti, id klienta.

import { admin, json, overToken, jenPovolene, CORS } from "../_shared/klient.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ chyba: "metoda" }, 405);

  let body: { token?: unknown } = {};
  try { body = await req.json(); } catch { /* prázdné tělo */ }
  const p = await overToken(body.token);
  if (p instanceof Response) return p;

  const db = admin();
  const { data: k } = await db.from("klienti")
    .select("jmeno, prijmeni, onboarding, obchodnik:uzivatele!klienti_obchodnik_id_fkey(jmeno)")
    .eq("id", p.klient_id).maybeSingle();
  if (!k) return json({ chyba: "neplatny_odkaz" }, 401);

  const { data: doky } = await db.from("dokumenty")
    .select("id, nazev, stav, storage_path")
    .eq("klient_id", p.klient_id).is("smazano", null)
    .order("kdy", { ascending: true });

  const obch = k.obchodnik as { jmeno?: string } | { jmeno?: string }[] | null;
  const poradce = (Array.isArray(obch) ? obch[0]?.jmeno : obch?.jmeno) || "Váš poradce";

  return json({
    klient: { jmeno: k.jmeno || "", prijmeni: k.prijmeni || "", poradce },
    onboarding: jenPovolene(k.onboarding as Record<string, unknown>),
    dokumenty: (doky || []).map((d) => ({ id: d.id, nazev: d.nazev, stav: d.stav, ma_soubor: !!d.storage_path })),
    platnost_do: p.platnost_do,
  });
});
