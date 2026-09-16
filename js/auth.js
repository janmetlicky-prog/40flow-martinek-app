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

  /**
   * Zachytí chybu z adresy po kliknutí na odkaz, který už nejde použít.
   *
   * Odkaz je jednorázový a platí omezenou dobu. Když už byl použitý nebo
   * vypršel, server místo tokenu vrátí `#error_code=…`. Bez téhle kontroly
   * aplikace člověka mlčky vrátila na přihlášení a nikdo nevěděl proč.
   *
   * Nejčastější příčina u firemní pošty: bezpečnostní filtr odkaz „otevře"
   * kvůli kontrole dřív než člověk, a tím ho spotřebuje.
   */
  zachytChybu() {
    if (!location.hash.includes("error")) return null;
    const p = new URLSearchParams(location.hash.slice(1));
    const kod = p.get("error_code") || p.get("error") || "";
    history.replaceState(null, "", location.pathname);  // chybu z adresního řádku pryč
    if (kod === "otp_expired" || kod === "access_denied") {
      return "Tento přihlašovací odkaz už nejde použít — platí jen jednou a jen omezenou dobu. "
           + "Zadejte níže svůj e-mail a nechte si poslat nový.";
    }
    return "Přihlášení se nepodařilo. Zadejte níže svůj e-mail a nechte si poslat nový odkaz.";
  },

  /**
   * Odkaz odolný vůči skenerům pošty.
   *
   * Firemní pošta odkazy v e-mailech předem „otevírá", aby zkontrolovala,
   * jestli nejsou škodlivé. Když odkaz vede rovnou na ověření, skener ho tím
   * spotřebuje a člověku pak přijde už použitý. Proto odkaz vede na aplikaci
   * s `?token_hash=…` a ověření proběhne až kliknutím na tlačítko (POST) —
   * skener stránku jen načte, na tlačítko neklikne.
   *
   * Vyžaduje upravenou e-mailovou šablonu, viz README → Přihlašovací e-mail.
   */
  tokenHashZAdresy() {
    const p = new URLSearchParams(location.search);
    const th = p.get("token_hash");
    return th ? { token_hash: th, type: p.get("type") || "email" } : null;
  },

  async potvrdOdkaz({ token_hash, type }) {
    const r = await fetch(`${this._url()}/auth/v1/verify`, {
      method: "POST",
      headers: { apikey: this._anon(), "Content-Type": "application/json" },
      body: JSON.stringify({ type, token_hash }),
    });
    history.replaceState(null, "", location.pathname);  // token pryč z adresy
    if (!r.ok) {
      throw new Error("Tento přihlašovací odkaz už nejde použít — platí jen jednou a jen omezenou dobu. "
                    + "Zadejte níže svůj e-mail a nechte si poslat nový.");
    }
    const d = await r.json();
    this.session = {
      access_token: d.access_token,
      refresh_token: d.refresh_token || "",
      expires_at: Date.now() + Number(d.expires_in || 3600) * 1000,
    };
    this._uloz();
  },

  /**
   * Přihlášení e-mailem a heslem — bez závislosti na doručení pošty.
   * Heslo nastavuje správce (admin API), uživatel ho dostane jinou cestou.
   * Magic link zůstává jako druhá možnost, až bude vlastní SMTP.
   */
  async prihlasHeslem(email, heslo) {
    let r;
    try {
      r = await fetch(`${this._url()}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: this._anon(), "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password: heslo }),
      });
    } catch {
      throw new Error("Nelze se připojit — zkontrolujte internetové připojení.");
    }
    if (r.status === 400 || r.status === 401) {
      throw new Error("Nesprávný e-mail nebo heslo.");
    }
    if (r.status === 429) {
      throw new Error("Příliš mnoho pokusů. Zkuste to prosím za pár minut.");
    }
    if (!r.ok) throw new Error(`Přihlášení se nezdařilo (${r.status}).`);
    const d = await r.json();
    this.session = {
      access_token: d.access_token,
      refresh_token: d.refresh_token || "",
      expires_at: Date.now() + Number(d.expires_in || 3600) * 1000,
    };
    this._uloz();
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
