/* Přihlášení přes Supabase Auth — magic link, žádná hesla.
 *
 * Postup: uživatel zadá e-mail → přijde mu odkaz → po kliknutí se vrátí
 * na aplikaci s tokenem v adrese → token se uloží a použije pro čtení dat.
 * Účty nevznikají samy (create_user: false) — zakládá je výhradně admin.
 *
 * Po přihlášení se načte řádek z `uzivatele`. Když neexistuje nebo má
 * aktivni = false, přístup se odmítne — samotné ověření e-mailu nestačí.
 */
"use strict";

const AUTH_KEY = "40flow_auth";

const Auth = {
  session: null,   // { access_token, refresh_token, expires_at }
  uzivatel: null,  // řádek z tabulky uzivatele

  _url() { return APP.supabase.url; },
  _anon() { return APP.supabase.anon_key; },

  /** Odešle přihlašovací odkaz na e-mail. */
  async posliOdkaz(email) {
    const r = await fetch(`${this._url()}/auth/v1/otp`, {
      method: "POST",
      headers: { apikey: this._anon(), "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email.trim().toLowerCase(),
        create_user: false,               // účty zakládá jen admin pozvánkou
        options: { email_redirect_to: location.origin + location.pathname },
      }),
    });
    if (r.status === 422 || r.status === 400) {
      throw new Error("Tento e-mail v systému není. Požádejte správce o přidání.");
    }
    if (r.status === 429) {
      throw new Error("Příliš mnoho pokusů. Zkuste to prosím za pár minut.");
    }
    if (!r.ok) throw new Error(`Odeslání odkazu se nezdařilo (${r.status}).`);
  },

  /** Zachytí token z adresy po kliknutí na odkaz z e-mailu. */
  zachytZAdresy() {
    if (!location.hash.includes("access_token")) return false;
    const p = new URLSearchParams(location.hash.slice(1));
    const token = p.get("access_token");
    if (!token) return false;
    this.session = {
      access_token: token,
      refresh_token: p.get("refresh_token") || "",
      expires_at: Date.now() + Number(p.get("expires_in") || 3600) * 1000,
    };
    this._uloz();
    history.replaceState(null, "", location.pathname);  // token pryč z adresního řádku
    return true;
  },

  _uloz() {
    try { sessionStorage.setItem(AUTH_KEY, JSON.stringify(this.session)); } catch { /* noop */ }
  },

  obnov() {
    try {
      const raw = sessionStorage.getItem(AUTH_KEY);
      if (!raw) return false;
      const s = JSON.parse(raw);
      if (!s.access_token || s.expires_at < Date.now()) return false;
      this.session = s;
      return true;
    } catch { return false; }
  },

  token() { return this.session && this.session.access_token; },

  /** Vlastní id přihlášeného (claim `sub` z tokenu). */
  mojeId() {
    const t = this.token();
    if (!t) return null;
    try {
      const p = t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      return JSON.parse(atob(p + "=".repeat((4 - p.length % 4) % 4))).sub || null;
    } catch { return null; }
  },

  /** Načte řádek z `uzivatele` a ověří, že je účet aktivní. */
  async nactiUzivatele() {
    const r = await fetch(`${this._url()}/rest/v1/uzivatele?select=*`, {
      headers: { apikey: this._anon(), Authorization: `Bearer ${this.token()}` },
    });
    if (!r.ok) throw new Error(`Nepodařilo se ověřit účet (${r.status}).`);
    const radky = await r.json();
    // Admin vidí přes RLS všechny řádky — vlastní se pozná podle id z tokenu.
    const ja = radky.find((u) => u.id === this.mojeId()) || null;
    if (!ja || !ja.aktivni) {
      this.odhlas();
      throw new Error("Váš účet není aktivní, kontaktujte správce.");
    }
    this.uzivatel = ja;
    return ja;
  },

  odhlas() {
    this.session = null;
    this.uzivatel = null;
    try { sessionStorage.removeItem(AUTH_KEY); } catch { /* noop */ }
  },
};
