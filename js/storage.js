/* Storage vrstva — JEDINÉ místo, které ví o GitHubu.
 *
 * Rozhraní (UI volá výhradně tohle):
 *   Storage.listClients()          → [{id, jmeno, prijmeni, stav, obchodnik, ...souhrn}]
 *   Storage.loadClient(id)         → kompletní záznam klienta
 *   Storage.saveClient(client, kdo)→ zapíše klienta + aktualizuje index
 *   Storage.hasToken() / setToken()
 *
 * Implementace #1: GitHubStorage — privátní repo přes Contents API,
 * token jen v localStorage prohlížeče, nikdy v kódu.
 * Později lze doplnit implementaci #2 (vlastní back-end) se stejným
 * rozhraním bez zásahu do UI.
 *
 * Vzor převzatý z EFL Kalkulace: SHA se drží v paměti per soubor,
 * při konfliktu (409/422) se soubor přenačte a zápis zopakuje jednou.
 */
"use strict";

const TOKEN_KEY = "40flow_gh_token";

class GitHubStorage {
  constructor({ owner, repo, branch }) {
    this.owner = owner;
    this.repo = repo;
    this.branch = branch || "main";
    this._sha = {};        // cesta → SHA posledního známého stavu
    this._indexCache = null;
  }

  // --- token ---------------------------------------------------------------
  hasToken() {
    try { return !!localStorage.getItem(TOKEN_KEY); } catch { return false; }
  }
  setToken(token) {
    try { localStorage.setItem(TOKEN_KEY, token.trim()); } catch { /* soukromý režim */ }
  }
  clearToken() {
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* noop */ }
  }
  _token() {
    let t = null;
    try { t = localStorage.getItem(TOKEN_KEY); } catch { /* noop */ }
    if (!t) throw new StorageError("chybi_token",
      "Chybí přístupový token. Vložte ho tlačítkem ‚Nastavit token' vpravo nahoře.");
    return t;
  }

  // --- nízká úroveň: čtení/zápis souboru -----------------------------------
  _api(path) {
    return `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${path}`;
  }
  _headers() {
    return {
      Authorization: `Bearer ${this._token()}`,
      Accept: "application/vnd.github+json",
    };
  }

  async _readFile(path) {
    let res;
    try {
      res = await fetch(`${this._api(path)}?ref=${this.branch}&t=${Date.now()}`, { headers: this._headers() });
    } catch {
      throw new StorageError("offline", "Nelze se připojit — zkontrolujte internetové připojení.");
    }
    if (res.status === 404) return null;
    if (res.status === 401) throw new StorageError("neplatny_token",
      "Token byl odmítnut. Nastavte platný token (tlačítko ‚Nastavit token').");
    if (!res.ok) throw new StorageError("cteni_selhalo", `Čtení dat selhalo (${res.status}).`);
    const body = await res.json();
    this._sha[path] = body.sha;
    const text = decodeURIComponent(escape(atob(body.content.replace(/\n/g, ""))));
    return JSON.parse(text);
  }

  async _writeFile(path, obj, message, retry = true) {
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(obj, null, 2))));
    const payload = { message, content, branch: this.branch };
    if (this._sha[path]) payload.sha = this._sha[path];

    let res;
    try {
      res = await fetch(this._api(path), {
        method: "PUT", headers: this._headers(), body: JSON.stringify(payload),
      });
    } catch {
      throw new StorageError("offline", "Uložení se nepodařilo — zkontrolujte internetové připojení. Změny zůstávají v prohlížeči, zkuste to znovu.");
    }
    if (res.status === 401) throw new StorageError("neplatny_token",
      "Token byl odmítnut. Nastavte platný token (tlačítko ‚Nastavit token').");
    if ((res.status === 409 || res.status === 422) && retry) {
      // konflikt verzí: někdo mezitím uložil — přenačíst SHA a zkusit jednou znovu
      await this._readFile(path);
      return this._writeFile(path, obj, message, false);
    }
    if (res.status === 409 || res.status === 422) throw new StorageError("konflikt",
      "Konflikt verzí — kolega mezitím uložil jinou změnu. Obnovte stránku (data se přenačtou) a proveďte úpravu znovu.");
    if (!res.ok) throw new StorageError("zapis_selhal", `Uložení selhalo (${res.status}).`);
    const body = await res.json();
    this._sha[path] = body.content.sha;
  }

  // --- veřejné rozhraní ------------------------------------------------------
  async listClients() {
    const index = await this._readFile("data/index.json");
    this._indexCache = index || { klienti: [] };
    return this._indexCache.klienti;
  }

  async loadClient(id) {
    const client = await this._readFile(`data/clients/${id}.json`);
    if (!client) throw new StorageError("nenalezen", `Klient ${id} nebyl v úložišti nalezen.`);
    return client;
  }

  async saveClient(client, kdo) {
    client.upraveno = new Date().toISOString();
    client.upravil = kdo || "neznámý";
    await this._writeFile(
      `data/clients/${client.id}.json`, client,
      `Klient ${client.jmeno} ${client.prijmeni} (${client.id}) — ${kdo}`,
    );
    try {
      await this._updateIndex(client);
    } catch {
      throw new StorageError("index_neaktualizovan",
        "Klient uložen, přehled se nepodařilo aktualizovat — obnovte stránku.");
    }
  }

  /**
   * Aktualizace přehledu: index se vždy ČERSTVĚ načte z úložiště a nahradí se
   * jen položka ukládaného klienta — zápis ze zastaralého tabu tak nepřepíše
   * změny kolegů. Při konfliktu (souběžný zápis) celé čtení+merge 1× zopakovat.
   */
  async _updateIndex(client, retry = true) {
    const index = (await this._readFile("data/index.json")) || { klienti: [] };
    const souhrn = indexEntry(client);
    const i = index.klienti.findIndex((k) => k.id === client.id);
    if (i >= 0) index.klienti[i] = souhrn; else index.klienti.push(souhrn);
    this._indexCache = index;
    try {
      await this._writeFile("data/index.json", index, `Index — ${client.id}`, false);
    } catch (err) {
      if (err.kod === "konflikt" && retry) return this._updateIndex(client, false);
      throw err;
    }
  }

  /** Záchrana: postaví index znovu ze všech souborů v data/clients/. */
  async rebuildIndex() {
    let res;
    try {
      res = await fetch(`${this._api("data/clients")}?ref=${this.branch}&t=${Date.now()}`, { headers: this._headers() });
    } catch {
      throw new StorageError("offline", "Nelze se připojit — zkontrolujte internetové připojení.");
    }
    if (!res.ok) throw new StorageError("cteni_selhalo", `Výpis klientů selhal (${res.status}).`);
    const files = (await res.json()).filter((f) => f.name.endsWith(".json"));
    const klienti = [];
    for (const f of files) {
      const c = await this._readFile(`data/clients/${f.name}`);
      if (c && c.id) klienti.push(indexEntry(c));
    }
    klienti.sort((a, b) => a.id.localeCompare(b.id));
    const index = { klienti };
    await this._readFile("data/index.json"); // čerstvé SHA pro přepis
    await this._writeFile("data/index.json", index, "Přegenerování přehledu");
    this._indexCache = index;
    return klienti;
  }
}

/** Souhrn klienta pro tabulku přehledu (index.json). */
function indexEntry(c) {
  const oblasti = {};
  for (const [k, v] of Object.entries(c.oblasti || {})) {
    oblasti[k] = { stav: v.stav || "", faze: v.faze || "" };
  }
  return {
    id: c.id, jmeno: c.jmeno, prijmeni: c.prijmeni, firma: c.firma || "",
    stav: c.stav || "", obchodnik: c.obchodnik || "", oblasti,
    upraveno: c.upraveno || "",
  };
}

class StorageError extends Error {
  constructor(kod, zprava) {
    super(zprava);
    this.kod = kod;
  }
}

// Jediná instance pro celou aplikaci — konfigurace z CONFIG.github
// (owner/repo datového repa; UI o GitHubu jinak neví).
const Storage = new GitHubStorage(CONFIG.github);
