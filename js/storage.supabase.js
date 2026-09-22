/* Supabase úložiště — cílové řešení.
 *
 * Stejné rozhraní jako ostatní implementace (listClients / loadClient /
 * saveClient / rebuildIndex). UI o Supabase neví nic, stejně jako nevědělo
 * o GitHubu.
 *
 * Data chrání RLS politiky na straně databáze, ne aplikace: bez přihlášení
 * a bez aktivního řádku v `uzivatele` nevrátí server nic.
 */
"use strict";

class SupabaseStorage {
  constructor(cfg) {
    this.url = cfg.url;
    this.anon = cfg.anon_key;
  }

  // Přihlašování řeší Auth (magic link) — token od uživatele se nezadává.
  hasToken() { return true; }
  setToken() { /* nepoužívá se */ }

  /** Zapisovat může jen přihlášený člen týmu. Klient bez účtu ne —
   *  přístup klienta přes odkaz s tokenem řeší až edge funkce (úkol 3). */
  umiZapisovat() { return typeof Auth !== "undefined" && !!Auth.token(); }

  _hlavicky() {
    const t = Auth.token();
    if (!t) throw new StorageError("neprihlasen", "Nejste přihlášeni. Přihlaste se prosím znovu.");
    return {
      apikey: this.anon,
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
    };
  }

  async _rest(cesta, init = {}) {
    let r;
    try {
      r = await fetch(`${this.url}/rest/v1/${cesta}`, { ...init, headers: this._hlavicky() });
    } catch {
      throw new StorageError("offline", "Nelze se připojit — zkontrolujte internetové připojení.");
    }
    if (r.status === 401 || r.status === 403) {
      throw new StorageError("neopravnen",
        "Nemáte oprávnění k těmto datům. Zkuste se odhlásit a přihlásit znovu.");
    }
    if (!r.ok) {
      const telo = await r.text();
      // Zámek proti přepsání ze save_klient()
      if (telo.includes("KONFLIKT")) {
        throw new StorageError("konflikt",
          "Záznam mezitím upravil někdo jiný. Načtěte klienta znovu a proveďte úpravu na aktuální verzi.");
      }
      throw new StorageError("chyba", `Operace se nezdařila (${r.status}).`);
    }
    return r.status === 204 ? null : r.json();
  }

  async listClients() {
    const radky = await this._rest("klienti_prehled?select=*&order=prijmeni.asc");
    return radky.map((r) => ({
      id: r.id, jmeno: r.jmeno, prijmeni: r.prijmeni, firma: r.firma || "",
      stav: r.stav_vztahu || "",      // v tabulce se zobrazuje pracovní stav z Excelu
      stav_retence: r.stav,
      obchodnik: r.obchodnik || "",
      oblasti: r.oblasti || {},
      upraveno: r.upraveno,
    }));
  }

  async loadClient(id) {
    const vyber = [
      "*",
      // klienti mají na uzivatele dva FK (obchodnik_id, lead_agent) — nutno říct který
      "obchodnik_uzivatel:uzivatele!klienti_obchodnik_id_fkey(jmeno)",
      "oblasti(*,oblasti_polozky(*),faze_historie(*))",
      // jména autorů se přibalí přes FK, ať karta neukazuje uuid
      "komentare(*,autor_uzivatel:uzivatele(jmeno))",
      "schuzky(*,kdo_uzivatel:uzivatele(jmeno))",
      "cile(*)",
    ].join(",");
    const radky = await this._rest(`klienti?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(vyber)}`);
    if (!radky.length) throw new StorageError("nenalezen", `Klient ${id} nebyl nalezen.`);
    return zTabulek(radky[0]);
  }

  async saveClient(client, kdo) {
    const payload = doTabulek(client, kdo);
    const nove = await this._rest("rpc/save_klient", {
      method: "POST",
      body: JSON.stringify({ p: payload }),
    });
    // server vrátí nové `upraveno` — uložíme pro další kontrolu zámku
    client.upraveno = nove;
    client.upravil = kdo || "";
  }

  /** Přehled je databázový pohled — nemá se s čím rozejít, není co obnovovat. */
  async rebuildIndex() {
    return this.listClients();
  }
}

// ---------------------------------------------------------------------------
// Převod mezi tvarem tabulek a tvarem, se kterým pracuje UI
// ---------------------------------------------------------------------------

function zTabulek(r) {
  const oblasti = {};
  for (const o of r.oblasti || []) {
    oblasti[o.klic] = {
      stav: o.stav || "", faze: o.faze || "", poznamka: o.poznamka || "",
      polozky: (o.oblasti_polozky || []).map((p) => ({
        typ: p.typ, instituce: p.instituce, mesicni_platba: p.mesicni_platba, poznamka: p.poznamka,
      })),
      faze_historie: (o.faze_historie || [])
        .slice().sort((a, b) => String(a.kdy).localeCompare(String(b.kdy)))
        .map((h) => ({ faze: h.faze, kdy: h.kdy, kdo: h.kdo })),
    };
  }
  return {
    id: r.id, jmeno: r.jmeno, prijmeni: r.prijmeni, firma: r.firma,
    stav: r.stav_vztahu || "",          // UI zobrazuje pracovní stav
    stav_retence: r.stav, datum_ukonceni: r.datum_ukonceni,
    obchodnik_id: r.obchodnik_id, lead_agent: r.lead_agent === true,
    obchodnik: (r.obchodnik_uzivatel && r.obchodnik_uzivatel.jmeno) || "",
    ida_url: r.ida_url || "",
    onboarding: r.onboarding && Object.keys(r.onboarding).length ? r.onboarding : null,
    poradce: r.poradce || {},
    oblasti,
    komentare: (r.komentare || [])
      .slice().sort((a, b) => String(a.kdy).localeCompare(String(b.kdy)))
      .map((k) => ({
        text: k.text, autor_id: k.autor_id, kdy: k.kdy,
        autor: (k.autor_uzivatel && k.autor_uzivatel.jmeno) || "",
      })),
    schuzky: (r.schuzky || []).map((s) => ({
      id: s.id, datum: s.datum, typ: s.typ, kdo: s.kdo,
      kdo_jmeno: (s.kdo_uzivatel && s.kdo_uzivatel.jmeno) || "",
      souhrn: s.souhrn, odkaz: s.odkaz, zdroj: s.zdroj, plaud_file_id: s.plaud_file_id,
    })),
    cile: (r.cile || []).map((c) => ({ cil: c.cil, castka: c.castka, termin: c.termin, stav: c.stav })),
    upraveno: r.upraveno, upravil: r.upravil,
    // Excelová pole zůstávají v poradce jsonb, UI je čte odtud
    ...vybaleneExcelove(r.poradce || {}),
  };
}

const EXCEL_POLE = ["dohoda", "datum", "oblacek", "bilance", "sdileni", "poznamka_nzp", "poznamky_lenka"];

function jeUuid(v) {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function vybaleneExcelove(poradce) {
  const out = {};
  for (const k of EXCEL_POLE) out[k] = poradce[k] || "";
  return out;
}

function doTabulek(c, kdo) {
  const poradce = { ...(c.poradce || {}) };
  for (const k of EXCEL_POLE) {
    if (c[k]) poradce[k] = c[k];
  }
  return {
    id: c.id,
    jmeno: c.jmeno || "", prijmeni: c.prijmeni || "", firma: c.firma || "",
    stav: c.stav_retence || "aktivni",
    datum_ukonceni: c.datum_ukonceni || "",
    stav_vztahu: c.stav || "",
    obchodnik_id: c.obchodnik_id || "",
    lead_agent: c.lead_agent === true,
    ida_url: c.ida_url || "",
    onboarding: c.onboarding || {},
    poradce,
    oblasti: Object.entries(c.oblasti || {}).map(([klic, o]) => ({
      klic, stav: o.stav || "", faze: o.faze || "", poznamka: o.poznamka || "",
      polozky: o.polozky || [], faze_historie: o.faze_historie || [],
    })),
    komentare: (c.komentare || []).map((k) => ({
      text: k.text, autor_id: jeUuid(k.autor_id) ? k.autor_id : null, kdy: k.kdy,
    })),
    // `kdo` je FK na uzivatele — cokoli, co není uuid (e-mail, jméno), by
    // zápis celého klienta shodilo. Radši prázdné než chyba.
    schuzky: (c.schuzky || []).map((s) => ({
      id: s.id, datum: s.datum, typ: s.typ,
      kdo: jeUuid(s.kdo) ? s.kdo : null,
      souhrn: s.souhrn, odkaz: s.odkaz, zdroj: s.zdroj, plaud_file_id: s.plaud_file_id,
    })),
    cile: c.cile || [],
    upravil: kdo || "",
    upraveno: c.upraveno || null,   // zámek: server porovná s uloženou hodnotou
  };
}
