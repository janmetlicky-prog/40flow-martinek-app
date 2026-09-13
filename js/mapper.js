/* Rozřazení aktivních smluv z klientského formuláře do produktových oblastí karty.
 * Mapování je v config/oblasti.json — sdílí ho formulář (první zadání)
 * i dashboard (import souboru). Karta je pak zdrojem pravdy pro úpravy. */
"use strict";

let OBLASTI_MAPA = null;

async function nactiOblastiMapu() {
  if (OBLASTI_MAPA) return OBLASTI_MAPA;
  const r = await fetch("config/oblasti.json");
  OBLASTI_MAPA = await r.json();
  return OBLASTI_MAPA;
}

/** Vrátí klíč oblasti pro typ smlouvy; nepřiřazené → mapa.vychozi („ostatni"). */
function oblastProTyp(typ, mapa) {
  const t = String(typ || "").toLowerCase();
  for (const m of mapa.mapovani) {
    if (m.klice.some((k) => t.includes(k))) return m.oblast;
  }
  return mapa.vychozi;
}

/**
 * Rozřadí smlouvy z onboardingu do client.oblasti.<klíč>.polozky.
 * Nepřepisuje existující položky — jen přidává ty, které tam ještě nejsou
 * (stejný typ + instituce + platba), aby opakovaný import neduplikoval.
 */
function rozradSmlouvy(client, smlouvy, mapa) {
  let pridano = 0;
  for (const s of smlouvy || []) {
    if (!s.typ && !s.instituce) continue;
    const key = oblastProTyp(s.typ, mapa);
    if (!client.oblasti) client.oblasti = {};
    if (!client.oblasti[key]) {
      client.oblasti[key] = { stav: "", faze: "", faze_historie: [], poznamka: "", polozky: [] };
    }
    const ob = client.oblasti[key];
    if (!Array.isArray(ob.polozky)) ob.polozky = [];
    const uzTam = ob.polozky.some((p) =>
      p.typ === s.typ && p.instituce === s.instituce && p.mesicni_platba === (s.platba || s.mesicni_platba || ""));
    if (!uzTam) {
      ob.polozky.push({
        typ: s.typ || "",
        instituce: s.instituce || "",
        mesicni_platba: s.platba || s.mesicni_platba || "",
        poznamka: s.poznamka || "",
      });
      pridano += 1;
    }
  }
  return pridano;
}
