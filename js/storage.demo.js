/* Demo úložiště — testovací režim bez jakéhokoli přihlašování k datům.
 *
 * Výchozí data se načtou z demo/klienti.json (smyšlení klienti, uložení
 * v repu aplikace). Změny se ukládají do localStorage prohlížeče, takže:
 *   - uživatel nepotřebuje žádný token ani účet,
 *   - nic neodchází ze zařízení,
 *   - „Vrátit demo data do původního stavu" obnoví výchozí sadu.
 *
 * Slouží k proklikání aplikace. Ostrým úložištěm bude Supabase.
 */
"use strict";

const DEMO_KEY = "40flow_demo_data";

class DemoStorage {
  constructor() {
    this._data = null; // id → klient
  }

  // Demo režim žádný token nepotřebuje — UI se podle toho řídí.
  hasToken() { return true; }
  setToken() { /* nepoužívá se */ }
  /** Zápis do prohlížeče je vždy k dispozici. */
  umiZapisovat() { return true; }

  async _nacti() {
    if (this._data) return this._data;
    let ulozene = null;
    try {
      const raw = localStorage.getItem(DEMO_KEY);
      if (raw) ulozene = JSON.parse(raw);
    } catch { /* poškozený obsah → spadne se na výchozí sadu */ }

    if (ulozene) {
      this._data = ulozene;
      return this._data;
    }
    let vychozi;
    try {
      const r = await fetch("demo/klienti.json", { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      vychozi = await r.json();
    } catch {
      throw new StorageError("demo_nenacteno",
        "Nepodařilo se načíst ukázková data. Obnovte stránku (F5).");
    }
    this._data = {};
    for (const k of vychozi.klienti || []) this._data[k.id] = k;
    this._zapis();
    return this._data;
  }

  _zapis() {
    try {
      localStorage.setItem(DEMO_KEY, JSON.stringify(this._data));
    } catch {
      throw new StorageError("demo_plno",
        "Prohlížeč nemá místo pro uložení změn. Zkuste obnovit demo data v sekci Administrace.");
    }
  }

  async listClients() {
    const d = await this._nacti();
    return Object.values(d)
      .map(indexEntry)
      .sort((a, b) => (a.prijmeni || "").localeCompare(b.prijmeni || "", "cs"));
  }

  async loadClient(id) {
    const d = await this._nacti();
    if (!d[id]) throw new StorageError("nenalezen", `Klient ${id} nebyl nalezen.`);
    // kopie, aby se rozdělaná editace nepropsala do úložiště bez uložení
    return JSON.parse(JSON.stringify(d[id]));
  }

  async saveClient(client, kdo) {
    const d = await this._nacti();
    client.upraveno = new Date().toISOString();
    client.upravil = kdo || "neznámý";
    d[client.id] = JSON.parse(JSON.stringify(client));
    this._zapis();
  }

  async rebuildIndex() {
    this._data = null;
    return this.listClients();
  }

  /** Zahodí místní změny a vrátí výchozí ukázkovou sadu. */
  async resetDemo() {
    try { localStorage.removeItem(DEMO_KEY); } catch { /* noop */ }
    this._data = null;
    return this.listClients();
  }
}
