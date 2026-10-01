// klient_upload — klient nahraje dokument přes odkaz s tokenem.
//
// Vstup:  POST multipart/form-data: token, soubor, [checklist_klic], [dokument_id]
// Kontroly na serveru (prohlížeč se ignoruje): token + rate limit, velikost
// ≤ 15 MB (413), typ z magic bytes (400). Cesta v bucketu se odvozuje z tokenu —
// klient nemůže nahrát mimo svou složku ani určit název.
// Výstup: { ok, nazev, stav } — žádná URL ke stažení.

import { admin, json, overToken, CORS } from "../_shared/klient.ts";
import { rozpoznejTyp, bezpecnyNazev, MAX_BYTES, MAX_MB } from "../_shared/soubor.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ chyba: "metoda" }, 405);

  let form: FormData;
  try { form = await req.formData(); } catch { return json({ chyba: "telo" }, 400); }
  const p = await overToken(form.get("token"));
  if (p instanceof Response) return p;

  const soubor = form.get("soubor");
  if (!(soubor instanceof File)) return json({ chyba: "chybi_soubor" }, 400);
  if (soubor.size > MAX_BYTES) return json({ chyba: "velikost", max_mb: MAX_MB }, 413);
  if (soubor.size === 0) return json({ chyba: "prazdny" }, 400);

  const data = new Uint8Array(await soubor.arrayBuffer());
  const typ = rozpoznejTyp(data.subarray(0, 16));
  if (!typ) return json({ chyba: "typ", povolene: "PDF, JPG, PNG, HEIC" }, 400);

  const db = admin();
  const nazev = bezpecnyNazev(soubor.name || "soubor", typ.pripona);
  const cesta = `${p.klient_id}/${crypto.randomUUID()}-${nazev}`;

  const up = await db.storage.from("dokumenty").upload(cesta, data, { contentType: typ.mime, upsert: false });
  if (up.error) return json({ chyba: "ulozeni" }, 500);

  const checklist_klic = String(form.get("checklist_klic") || "");
  const dokument_id = String(form.get("dokument_id") || "");
  const radek = {
    nazev: soubor.name || nazev, typ: checklist_klic, stav: "ceka_na_kontrolu",
    storage_path: cesta, mime: typ.mime, velikost: soubor.size,
    nahral_klient: true, nahral: null, checklist_klic, kdy: new Date().toISOString(),
  };

  // Když klient vybral existující položku checklistu bez souboru, doplní se do ní.
  let hotovo = false;
  if (dokument_id) {
    const { data: ex } = await db.from("dokumenty").select("id, storage_path")
      .eq("id", dokument_id).eq("klient_id", p.klient_id).is("smazano", null).maybeSingle();
    if (ex && !ex.storage_path) {
      const { error } = await db.from("dokumenty").update(radek).eq("id", ex.id);
      hotovo = !error;
    }
  }
  if (!hotovo) {
    const { error } = await db.from("dokumenty").insert({ klient_id: p.klient_id, ...radek });
    if (error) return json({ chyba: "zaznam" }, 500);
  }
  return json({ ok: true, nazev: radek.nazev, stav: "ceka_na_kontrolu" });
});
