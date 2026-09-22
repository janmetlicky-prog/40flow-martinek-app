/* Dashboard — přehled klientů, karta klienta, ukládání přes storage vrstvu.
   O GitHubu ví výhradně js/storage.js; tady se volá jen Storage.*. */
"use strict";

let INDEX = [];              // souhrny klientů pro tabulku (z indexu)
const CLIENTS = new Map();   // id → plný záznam (načtený na vyžádání)
let session = null;
let dirty = new Set();
let currentClientId = null;

const $ = (sel) => document.querySelector(sel);

// ---------------------------------------------------------------------------
// Přihlášení
// ---------------------------------------------------------------------------
async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function tryLogin() {
  const user = $("#login-user").value.trim().toLowerCase();
  const pass = $("#login-pass").value;
  const account = CONFIG.users[user];
  if (!account || (await sha256(pass)) !== account.passwordHash) {
    $("#login-error").textContent = "Neplatné jméno nebo heslo.";
    return;
  }
  session = { user, role: account.role, label: account.label };
  sessionStorage.setItem("40flow_session", JSON.stringify(session));
  showApp();
}

/** Ostrý režim: odeslání přihlašovacího odkazu na e-mail. */
async function posliMagicLink() {
  const btn = $("#login-magic-btn");
  const email = $("#login-email").value.trim();
  $("#login-error").textContent = "";
  if (!email.includes("@")) {
    $("#login-error").textContent = "Zadejte prosím platný e-mail.";
    return;
  }
  btn.disabled = true;
  btn.textContent = "Odesílám…";
  try {
    await Auth.posliOdkaz(email);
    $("#login-magic").innerHTML =
      `<p class="login-hint" style="font-size:13px;color:var(--text)">
         Odkaz je na cestě na <strong>${esc(email)}</strong>.
         Otevřete ho na tomto počítači — přihlásí vás rovnou do aplikace.
         Pokud nedorazí do pár minut, mrkněte i do spamu.
       </p>`;
  } catch (err) {
    $("#login-error").textContent = err.message;
    btn.disabled = false;
    btn.textContent = "Poslat přihlašovací odkaz";
  }
}

/** Ostrý režim: e-mail + heslo. */
async function prihlasHeslem() {
  const btn = $("#login-heslem-btn");
  const email = $("#login-email").value.trim();
  const heslo = $("#login-heslo-input").value;
  $("#login-error").textContent = "";
  if (!email.includes("@") || !heslo) {
    $("#login-error").textContent = "Zadejte e-mail i heslo.";
    return;
  }
  btn.disabled = true;
  btn.textContent = "Přihlašuji…";
  try {
    await Auth.prihlasHeslem(email, heslo);
    await dokonciMagicLink();
  } catch (err) {
    $("#login-error").textContent = err.message;
    btn.disabled = false;
    btn.textContent = "Přihlásit se";
  }
}

/** Přihlášení po návratu z e-mailového odkazu. */
async function dokonciMagicLink() {
  try {
    const u = await Auth.nactiUzivatele();
    session = { user: u.email, role: u.role, label: `${u.jmeno} (${u.role})`, id: u.id, jmeno: u.jmeno };
    showApp();
  } catch (err) {
    Auth.odhlas();
    $("#view-login").hidden = false;
    $("#login-error").textContent = err.message;
  }
}

function logout() {
  sessionStorage.removeItem("40flow_session");
  Auth.odhlas();
  location.reload();
}

// ---------------------------------------------------------------------------
// Chybové hlášky (banner místo console.log)
// ---------------------------------------------------------------------------
function showError(err) {
  const el = $("#error-banner");
  el.textContent = err instanceof Error ? err.message : String(err);
  el.hidden = false;
  clearTimeout(showError._t);
  showError._t = setTimeout(() => { el.hidden = true; }, 8000);
}

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------
function askToken() {
  const t = prompt("Vložte přístupový token k datovému úložišti.\nUloží se jen v tomto prohlížeči, nikam jinam se neposílá.");
  if (t) {
    Storage.setToken(t);
    loadAndRender();
  }
}

// ---------------------------------------------------------------------------
// Konfigurace (config/*.json — edituje Petr, ne kód)
// ---------------------------------------------------------------------------
let FAZE = [];
let SCHUZKY_TYPY = [];

async function loadConfigs() {
  try {
    const [f, s] = await Promise.all([
      fetch("config/faze.json").then((r) => r.json()),
      fetch("config/schuzky.json").then((r) => r.json()),
    ]);
    FAZE = f.faze || [];
    SCHUZKY_TYPY = s.typy || [];
  } catch {
    showError(new Error("Nepodařilo se načíst konfiguraci (config/*.json)."));
  }
}

// ---------------------------------------------------------------------------
// Načtení dat
// ---------------------------------------------------------------------------
async function loadAndRender() {
  try {
    INDEX = await Storage.listClients();
    initFilters();
    renderList();
  } catch (err) {
    $("#client-rows").innerHTML = "";
    showError(err);
  }
}

async function getClient(id) {
  if (!CLIENTS.has(id)) CLIENTS.set(id, await Storage.loadClient(id));
  return CLIENTS.get(id);
}

// ---------------------------------------------------------------------------
// Seznam + filtry
// ---------------------------------------------------------------------------
function uniqueValues(field) {
  return [...new Set(INDEX.map((c) => c[field]).filter(Boolean))].sort();
}

function initFilters() {
  const selStav = $("#filter-stav"), selObch = $("#filter-obchodnik");
  selStav.length = 1; selObch.length = 1;
  for (const v of uniqueValues("stav")) selStav.add(new Option(v, v));
  for (const v of uniqueValues("obchodnik")) selObch.add(new Option(v, v));
  const selProd = $("#filter-product");
  if (selProd.length === 1) {
    for (const p of CONFIG.productFields) selProd.add(new Option(p.label, p.key));
    for (const s of CONFIG.productStates) $("#filter-product-state").add(new Option(s, s));
  }
}

function oblastStav(c, key) {
  return (c.oblasti && c.oblasti[key] && c.oblasti[key].stav) || "";
}

function filteredClients() {
  const q = $("#search").value.trim().toLowerCase();
  const stav = $("#filter-stav").value;
  const obch = $("#filter-obchodnik").value;
  const prod = $("#filter-product").value;
  const prodState = $("#filter-product-state").value;

  return INDEX.filter((c) => {
    if (q && !`${c.jmeno} ${c.prijmeni} ${c.firma}`.toLowerCase().includes(q)) return false;
    if (stav && c.stav !== stav) return false;
    if (obch && c.obchodnik !== obch) return false;
    if (prod) {
      const s = oblastStav(c, prod);
      if (prodState && s !== prodState) return false;
      if (!prodState && !s) return false;
    }
    return true;
  });
}

function badge(value, nove) {
  if (!value) {
    // Klient něco poslal, ale poradce oblast ještě nezařadil.
    return nove
      ? `<span class="badge nove" title="Klient poslal podklady k této oblasti — čeká na zařazení">nové</span>`
      : `<span class="badge empty">—</span>`;
  }
  const color = CONFIG.stateColors[value] || "var(--text-muted)";
  return `<span class="badge" style="background:${color}">${esc(value)}</span>`;
}

/** Oblast, kam klient poslal položku, ale poradce ji zatím nezařadil. */
function jeNova(ob) {
  if (!ob) return false;
  const pocet = ob.polozek != null ? Number(ob.polozek) : (ob.polozky || []).length;
  return !ob.stav && pocet > 0;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch]);
}

function renderList() {
  const rows = filteredClients();
  $("#result-count").textContent = `${rows.length} z ${INDEX.length} klientů`;
  $("#client-rows").innerHTML = rows.map((c) => `
    <tr data-id="${c.id}">
      <td><span class="name">${esc(c.jmeno)} ${esc(c.prijmeni)}</span></td>
      <td class="muted">${esc(c.firma || "")}</td>
      <td class="muted">${esc(c.stav || "")}</td>
      <td class="muted">${esc(c.obchodnik || "")}</td>
      ${CONFIG.productFields.map((p) => `<td>${badge(oblastStav(c, p.key), jeNova(c.oblasti && c.oblasti[p.key]))}</td>`).join("")}
    </tr>`).join("");
}

// ---------------------------------------------------------------------------
// Karta klienta
// ---------------------------------------------------------------------------
function field(label, value) {
  return `<div class="field"><label>${label}</label><div class="value">${esc(value || "—")}</div></div>`;
}

async function openDetail(id) {
  try {
    const c = await getClient(id);
    renderDetail(c);
  } catch (err) {
    showError(err);
  }
}

let expandedOblast = null;   // rozbalený detail oblasti v kartě
let editovanaSchuzka = null; // index právě editované schůzky (null = nová)

function fmtCas(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function renderDetail(c) {
  currentClientId = c.id;

  // Oblast „Ostatní" vzniká rozřazením smluv, které nikam nepatří — zobrazit, pokud existuje
  const oblastiSeznam = [...CONFIG.productFields];
  if (c.oblasti && c.oblasti.ostatni) oblastiSeznam.push({ key: "ostatni", label: "Ostatní" });

  const productRows = oblastiSeznam.map((p) => {
    const ob = (c.oblasti && c.oblasti[p.key]) || { stav: "", faze: "", faze_historie: [], poznamka: "" };
    const buttons = CONFIG.productStates.map((s) => {
      const active = ob.stav === s;
      const style = active ? `style="background:${CONFIG.stateColors[s]}"` : "";
      return `<button data-field="${p.key}" data-state="${esc(s)}" class="${active ? "active" : ""}" ${style}>${esc(s)}</button>`;
    }).join("");
    const extra = ob.stav && !CONFIG.productStates.includes(ob.stav)
      ? `<span class="badge" style="background:var(--text-muted)">${esc(ob.stav)}</span>` : "";
    const open = expandedOblast === p.key;
    const fazeBadge = ob.faze ? `<span class="faze-badge">Fáze: ${esc(ob.faze)}</span>` : "";
    const noveBadge = jeNova(ob)
      ? `<span class="badge nove" title="Klient poslal podklady k této oblasti — zmizí, jakmile nastavíte stav">nové</span>`
      : "";

    let detail = "";
    if (open) {
      const fazeOpts = ['<option value="">— bez fáze —</option>']
        .concat(FAZE.map((f) => `<option ${ob.faze === f ? "selected" : ""}>${esc(f)}</option>`)).join("");
      const historie = (ob.faze_historie || []).slice().reverse().map((h) =>
        `<div class="faze-hist-row"><span>${esc(h.faze)}</span><span class="muted-small">${fmtCas(h.kdy)} · ${esc(h.kdo || "")}</span></div>`).join("")
        || `<div class="muted-small">Zatím žádná změna fáze.</div>`;
      const polozky = (ob.polozky || []).map((pol, i) => `
        <tr class="polozka-row" data-oblast="${p.key}" data-idx="${i}">
          <td><input class="pol-typ" value="${esc(pol.typ)}" placeholder="typ"></td>
          <td><input class="pol-instituce" value="${esc(pol.instituce)}" placeholder="instituce"></td>
          <td><input class="pol-platba" value="${esc(pol.mesicni_platba)}" placeholder="Kč/měs" inputmode="numeric"></td>
          <td><input class="pol-poznamka" value="${esc(pol.poznamka)}" placeholder="poznámka"></td>
          <td><button class="item-del pol-del">×</button></td>
        </tr>`).join("");
      detail = `
        <div class="oblast-detail">
          <div class="onb-field"><label>Fáze rozpracovanosti</label>
            <select data-faze="${p.key}">${fazeOpts}</select></div>
          <div class="onb-field"><label>Poznámka k oblasti</label>
            <textarea data-oblast-poznamka="${p.key}" rows="2">${esc(ob.poznamka || "")}</textarea></div>
          <div class="onb-field"><label>Smlouvy / položky oblasti</label>
            <table class="mini-table polozky-table">
              <thead><tr><th>Typ</th><th>Instituce</th><th>Měs. platba</th><th>Poznámka</th><th></th></tr></thead>
              <tbody>${polozky || `<tr><td colspan="5" class="muted-small">Zatím žádné smlouvy v této oblasti.</td></tr>`}</tbody>
            </table>
            <button class="onb-add-btn" data-pridat-polozku="${p.key}">+ Přidat položku</button></div>
          <div class="onb-field"><label>Historie fází</label>${historie}</div>
        </div>`;
    }
    return `
      <div class="product-row ${open ? "open" : ""}">
        <button class="product-name product-toggle" data-oblast="${p.key}">${p.label} ${open ? "▾" : "▸"}</button>
        <div class="state-options">${buttons}</div>${noveBadge}${fazeBadge}${extra}
      </div>${detail}`;
  }).join("");

  $("#view-detail").innerHTML = `
    <button class="detail-back" id="back-btn">← Zpět na přehled</button>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div id="jmeno-zobraz">
            <h2>${esc(c.jmeno)} ${esc(c.prijmeni)}
              <button class="onb-add-btn jmeno-upravit" id="jmeno-upravit" title="Upravit jméno, příjmení nebo firmu">Upravit</button>
            </h2>
            <div class="subtitle">${esc(c.firma || "")}</div>
          </div>
          <div id="jmeno-edit" class="onb-grid jmeno-edit" hidden>
            <div class="onb-field"><label>Jméno</label><input id="je-jmeno" value="${esc(c.jmeno || "")}"></div>
            <div class="onb-field"><label>Příjmení</label><input id="je-prijmeni" value="${esc(c.prijmeni || "")}"></div>
            <div class="onb-field full"><label>Firma</label><input id="je-firma" value="${esc(c.firma || "")}"></div>
            <div class="onb-field full"><button class="mode-toggle active" id="je-hotovo">Hotovo</button></div>
          </div>
        </div>
        <div>
          <a class="mode-toggle" id="formular-otevrit" target="_blank" rel="noopener"
             href="onboarding.html?klient=${esc(c.id)}"
             title="${c.onboarding ? "Otevře formulář předvyplněný údaji z karty — upravíte a uložíte." : "Otevře vstupní dotazník tohoto klienta — vyplníte ho vy na schůzce."}">${c.onboarding ? "Upravit ve formuláři" : "Vyplnit vstupní formulář"}</a>
          <button class="mode-toggle" id="formular-odkaz"
             title="Zkopíruje odkaz na dotazník, který pošlete klientovi">Kopírovat odkaz pro klienta</button>
          <button class="mode-toggle" id="copy4fin-btn" title="Zobrazí všechna pole v pořadí formuláře 4fin, aby se daly rychle přenést do CRM">Kopírovat do 4fin</button>
        </div>
      </div>
      <div id="copy4fin-panel" hidden></div>
      <div id="normal-panel"></div>
    </div>`;

  $("#normal-panel").innerHTML = `
      <h3>Identifikace</h3>
      <div class="field-grid">
        ${field("Stav", c.stav)}
        ${field("Obchodník", c.obchodnik)}
        <div class="field">
          <label>Lead Agent <span class="help" title="Externí portál pro hromadné SMS, e-maily a landing pages. Zaškrtnuto = klient je v něm nahraný.">?</span></label>
          <label class="check-inline"><input type="checkbox" id="lead-agent" ${c.lead_agent === true ? "checked" : ""}> V Lead Agentu</label>
        </div>
      </div>

      <h3>Dohoda a podklady</h3>
      <div class="field-grid">
        ${field("Dohoda", c.dohoda)}
        ${field("Datum", c.datum)}
        ${field("Obláček", c.oblacek)}
        ${field("Bilance", c.bilance)}
        ${field("Sdílení", c.sdileni)}
      </div>

      <h3>Produktové oblasti</h3>
      ${productRows}

      <h3>Komentáře</h3>
      <div id="komentare-list">
        ${(c.komentare || []).map((k) => `
          <div class="koment-row"><div>${esc(k.text)}</div>
          <div class="muted-small">${esc(k.autor || "")} · ${fmtCas(k.kdy)}</div></div>`).join("")
          || `<div class="muted-small">Zatím žádné komentáře.</div>`}
      </div>
      <div class="koment-form">
        <textarea id="koment-text" rows="2" placeholder="např. Volám 3×, nebere — zkusit večer"></textarea>
        <button id="koment-add" class="mode-toggle">Přidat komentář</button>
      </div>

      <h3>Historie schůzek</h3>
      <div id="schuzky-list">
        ${(c.schuzky || []).map((s, i) => `
          <div class="schuzka-row" data-idx="${i}">
            <div><strong>${esc(s.datum)}</strong> — ${esc(s.typ)} · ${esc(s.kdo_jmeno || s.kdo || "")}${s.zdroj === "plaud" ? ` <span class="src-badge advisor">Plaud</span>` : ""}</div>
            <div>${esc(s.souhrn)}</div>
            ${s.odkaz ? `<a class="doc-link" href="${esc(s.odkaz)}" target="_blank" rel="noopener">Plný zápis</a>` : ""}
            <div class="schuzka-akce">
              <button class="onb-add-btn schuzka-edit">Upravit</button>
              <button class="item-del schuzka-del">× Smazat</button>
            </div>
          </div>`).join("") || `<div class="muted-small">Zatím žádné schůzky.</div>`}
      </div>
      <div class="schuzka-form onb-grid">
        <div class="onb-field"><label>Datum</label><input type="date" id="schuzka-datum"></div>
        <div class="onb-field"><label>Typ schůzky</label>
          <select id="schuzka-typ">${SCHUZKY_TYPY.map((t) => `<option>${esc(t)}</option>`).join("")}</select></div>
        <div class="onb-field"><label>Obchodník</label><input id="schuzka-kdo" value="${esc(session.jmeno || session.user)}" ${session.id ? "readonly" : ""}></div>
        <div class="onb-field full"><label>Souhrn</label><textarea id="schuzka-souhrn" rows="2"></textarea></div>
        <div class="onb-field full"><label>Odkaz na plný zápis (URL)</label><input type="url" id="schuzka-odkaz" placeholder="https://…"></div>
        <div class="onb-field full"><button id="schuzka-add" class="mode-toggle">Přidat schůzku</button></div>
      </div>

      <h3>IDA / investiční dotazník</h3>
      <div class="onb-field"><label>Odkaz (URL)</label>
        <input type="url" id="ida-url" value="${esc(c.ida_url || "")}" placeholder="https://…"></div>

      <h3>Časová osa cílů</h3>
      <div id="cile-list">
        ${(c.cile || []).map((g, i) => `
          <div class="cil-row ${g.stav === "splněno" ? "cil-splneno" : ""}" data-idx="${i}">
            <input class="cil-nazev" value="${esc(g.cil)}" placeholder="cíl">
            <input class="cil-castka" value="${esc(g.castka)}" placeholder="částka">
            <input class="cil-termin" value="${esc(g.termin)}" placeholder="termín (rok)">
            <select class="cil-stav">
              <option ${(g.stav || "aktivní") === "aktivní" ? "selected" : ""}>aktivní</option>
              <option ${g.stav === "splněno" ? "selected" : ""}>splněno</option>
            </select>
            <button class="item-del cil-del">×</button>
          </div>`).join("")}
      </div>
      <button id="cil-add" class="onb-add-btn">+ Přidat cíl</button>

      <div class="src-section src-client">
        <h3>Z klientského formuláře <span class="src-badge client">vyplnil klient</span></h3>
        ${renderClientData(c)}
      </div>

      <div class="src-section src-advisor">
        <h3>Údaje doplňované poradcem <span class="src-badge advisor">doplňuje poradce</span></h3>
        <div class="advisor-grid" id="advisor-grid">${renderAdvisorFields(c)}</div>
      </div>

      <h3>Poznámky</h3>
      <div class="note-block"><label>Poznámka NŽP</label>${esc(c.poznamka_nzp || "—")}</div>
      <div class="note-block"><label>Poznámky od Lenky</label>${esc(c.poznamky_lenka || "—")}</div>`;

  $("#back-btn").addEventListener("click", showListView);
  $("#formular-odkaz").addEventListener("click", async () => {
    const url = new URL(`onboarding.html?klient=${encodeURIComponent(c.id)}`, location.href).href;
    await navigator.clipboard.writeText(url);
    const b = $("#formular-odkaz");
    b.textContent = "Odkaz zkopírován ✓";
    setTimeout(() => { b.textContent = "Kopírovat odkaz pro klienta"; }, 1500);
  });
  $("#lead-agent").addEventListener("change", (e) => {
    c.lead_agent = e.target.checked;
    markDirty(c.id);
  });
  // Úprava jména / příjmení / firmy přímo v kartě
  $("#jmeno-upravit").addEventListener("click", () => {
    $("#jmeno-zobraz").hidden = true;
    $("#jmeno-edit").hidden = false;
    $("#je-jmeno").focus();
  });
  $("#je-hotovo").addEventListener("click", () => {
    c.jmeno = $("#je-jmeno").value.trim();
    c.prijmeni = $("#je-prijmeni").value.trim();
    c.firma = $("#je-firma").value.trim();
    markDirty(c.id);
    renderDetail(c);
  });
  $("#view-detail").querySelectorAll(".state-options button").forEach((btn) => {
    btn.addEventListener("click", () => toggleState(c, btn.dataset.field, btn.dataset.state));
  });
  $("#copy4fin-btn").addEventListener("click", () => {
    const panel = $("#copy4fin-panel");
    panel.hidden = !panel.hidden;
    $("#normal-panel").hidden = !panel.hidden;
    $("#copy4fin-btn").classList.toggle("active", !panel.hidden);
    if (!panel.hidden) {
      // přegenerovat s aktuálními daty (poradce mohl právě editovat)
      panel.innerHTML = `
        <h3>Přenos do 4fin — pole v pořadí formuláře</h3>
        <button class="mode-toggle" id="copy4fin-all">Kopírovat celý blok</button>
        ${render4finTable(c)}`;
      $("#copy4fin-all").addEventListener("click", async () => {
        const sources = { base: c, onboarding: c.onboarding || {}, poradce: c.poradce || {} };
        const text = CONFIG.copy4finFields.map((f) => {
          let v = sources[f.source][f.key] ?? "";
          if (Array.isArray(v)) v = v.join(", ");
          return `${f.label}: ${v || "—"}`;
        }).join("\n");
        await navigator.clipboard.writeText(text);
        $("#copy4fin-all").textContent = "Zkopírováno ✓";
        setTimeout(() => { $("#copy4fin-all").textContent = "Kopírovat celý blok"; }, 1500);
      });
      panel.querySelectorAll(".copy-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          await navigator.clipboard.writeText(btn.dataset.value);
          btn.textContent = "✓";
          btn.classList.add("copied");
          setTimeout(() => { btn.textContent = "Kopírovat"; btn.classList.remove("copied"); }, 1200);
        });
      });
    }
  });
  $("#advisor-grid").querySelectorAll("input, select").forEach((el) => {
    el.addEventListener("change", () => {
      if (!c.poradce) c.poradce = {};
      c.poradce[el.name] = el.value.trim();
      markDirty(c.id);
    });
  });

  // Detail oblasti: rozbalení, fáze (s historií), poznámka
  document.querySelectorAll(".product-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      expandedOblast = expandedOblast === btn.dataset.oblast ? null : btn.dataset.oblast;
      renderDetail(c);
    });
  });
  document.querySelectorAll("[data-faze]").forEach((sel) => {
    sel.addEventListener("change", () => {
      const ob = zajistiOblast(c, sel.dataset.faze);
      ob.faze = sel.value;
      if (!Array.isArray(ob.faze_historie)) ob.faze_historie = [];
      ob.faze_historie.push({ faze: sel.value || "(bez fáze)", kdy: new Date().toISOString(), kdo: session.jmeno || session.user });
      markDirty(c.id);
      renderDetail(c);
    });
  });
  document.querySelectorAll("[data-oblast-poznamka]").forEach((ta) => {
    ta.addEventListener("change", () => {
      zajistiOblast(c, ta.dataset.oblastPoznamka).poznamka = ta.value.trim();
      markDirty(c.id);
    });
  });

  // Komentáře
  $("#koment-add").addEventListener("click", () => {
    const text = $("#koment-text").value.trim();
    if (!text) return;
    if (!Array.isArray(c.komentare)) c.komentare = [];
    // autor_id jde do databáze (FK), jméno je jen pro okamžité zobrazení
    c.komentare.push({
      text, autor_id: session.id || null, autor: session.jmeno || session.user,
      kdy: new Date().toISOString(),
    });
    markDirty(c.id);
    renderDetail(c);
  });

  // Položky oblastí (smlouvy v oblasti)
  document.querySelectorAll("[data-pridat-polozku]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ob = zajistiOblast(c, btn.dataset.pridatPolozku);
      if (!Array.isArray(ob.polozky)) ob.polozky = [];
      ob.polozky.push({ typ: "", instituce: "", mesicni_platba: "", poznamka: "" });
      renderDetail(c);
    });
  });
  document.querySelectorAll(".polozka-row").forEach((row) => {
    const ob = zajistiOblast(c, row.dataset.oblast);
    const i = Number(row.dataset.idx);
    row.querySelectorAll("input").forEach((inp) => {
      inp.addEventListener("change", () => {
        ob.polozky[i] = {
          typ: row.querySelector(".pol-typ").value.trim(),
          instituce: row.querySelector(".pol-instituce").value.trim(),
          mesicni_platba: row.querySelector(".pol-platba").value.trim(),
          poznamka: row.querySelector(".pol-poznamka").value.trim(),
        };
        markDirty(c.id);
      });
    });
    row.querySelector(".pol-del").addEventListener("click", () => {
      ob.polozky.splice(i, 1);
      markDirty(c.id);
      renderDetail(c);
    });
  });

  // Schůzky — přidání / editace / smazání
  $("#schuzka-add").addEventListener("click", () => {
    const datum = $("#schuzka-datum").value;
    const souhrn = $("#schuzka-souhrn").value.trim();
    if (!datum || !souhrn) { showError(new Error("Schůzka potřebuje alespoň datum a souhrn.")); return; }
    if (!Array.isArray(c.schuzky)) c.schuzky = [];
    // V ostrém režimu je `kdo` id přihlášeného (FK), jméno jen pro zobrazení.
    // V ukázkovém režimu zůstává volný text.
    const data = {
      datum, typ: $("#schuzka-typ").value, souhrn,
      kdo: session.id || ($("#schuzka-kdo").value.trim() || session.user),
      kdo_jmeno: session.id ? (session.jmeno || session.user) : "",
      odkaz: $("#schuzka-odkaz").value.trim(),
    };
    if (editovanaSchuzka !== null) {
      Object.assign(c.schuzky[editovanaSchuzka], data);
      editovanaSchuzka = null;
    } else {
      c.schuzky.push({ id: crypto.randomUUID(), ...data, zdroj: "rucni", plaud_file_id: "" });
    }
    markDirty(c.id);
    renderDetail(c);
  });
  document.querySelectorAll(".schuzka-row").forEach((row) => {
    const i = Number(row.dataset.idx);
    row.querySelector(".schuzka-edit").addEventListener("click", () => {
      const s = c.schuzky[i];
      editovanaSchuzka = i;
      $("#schuzka-datum").value = s.datum || "";
      $("#schuzka-typ").value = s.typ || SCHUZKY_TYPY[0];
      $("#schuzka-kdo").value = s.kdo_jmeno || s.kdo || session.jmeno || session.user;
      $("#schuzka-souhrn").value = s.souhrn || "";
      $("#schuzka-odkaz").value = s.odkaz || "";
      $("#schuzka-add").textContent = "Uložit změnu schůzky";
      $("#schuzka-add").scrollIntoView({ block: "center" });
    });
    row.querySelector(".schuzka-del").addEventListener("click", () => {
      c.schuzky.splice(i, 1);
      editovanaSchuzka = null;
      markDirty(c.id);
      renderDetail(c);
    });
  });

  // IDA + cíle
  $("#ida-url").addEventListener("change", () => {
    c.ida_url = $("#ida-url").value.trim();
    markDirty(c.id);
  });
  $("#cil-add").addEventListener("click", () => {
    if (!Array.isArray(c.cile)) c.cile = [];
    c.cile.push({ cil: "", castka: "", termin: "" });
    renderDetail(c);
  });
  document.querySelectorAll(".cil-row").forEach((row) => {
    const i = Number(row.dataset.idx);
    row.querySelectorAll("input, select").forEach((inp) => {
      inp.addEventListener("change", () => {
        c.cile[i] = {
          cil: row.querySelector(".cil-nazev").value.trim(),
          castka: row.querySelector(".cil-castka").value.trim(),
          termin: row.querySelector(".cil-termin").value.trim(),
          stav: row.querySelector(".cil-stav").value,
        };
        markDirty(c.id);
        if (inp.classList.contains("cil-stav")) renderDetail(c);
      });
    });
    row.querySelector(".cil-del").addEventListener("click", () => {
      c.cile.splice(i, 1);
      markDirty(c.id);
      renderDetail(c);
    });
  });

  $("#view-list").hidden = true;
  $("#view-detail").hidden = false;
}

function zajistiOblast(c, key) {
  if (!c.oblasti) c.oblasti = {};
  if (!c.oblasti[key]) c.oblasti[key] = { stav: "", faze: "", faze_historie: [], poznamka: "" };
  return c.oblasti[key];
}

// ---------------------------------------------------------------------------
// Karta — sekce podle zdroje dat
// ---------------------------------------------------------------------------
function renderClientData(c) {
  const onb = c.onboarding;
  if (!onb) return `<p class="copy4fin-empty">Klient zatím formulář nevyplnil. Otevřete ho tlačítkem „Vstupní formulář" nahoře, nebo klientovi pošlete odkaz („Kopírovat odkaz pro klienta").</p>`;

  const adresa = (a) => {
    if (!a) return "";
    if (typeof a === "string") return a;   // starší záznamy
    return [[a.ulice, a.cislo].filter(Boolean).join(" "), a.mesto, a.psc].filter(Boolean).join(", ");
  };
  const kontakt = `
    <div class="field-grid">
      ${field("Telefon", onb.telefon)}
      ${field("E-mail", onb.email)}
      ${field("Trvalá adresa", adresa(onb.adresa_trvala))}
      ${field("Korespondenční adresa", onb.adresa_korespondencni_shodna !== false && !onb.adresa_korespondencni ? "shodná s trvalou" : adresa(onb.adresa_korespondencni))}
      ${field("Rodinný stav", onb.rodinny_stav)}
      ${field("Povolání", onb.povolani)}
      ${field("Zdroj příjmů", onb.zdroj_prijmu)}
    </div>`;

  const bilanceRows = (group, label) => ((onb.bilance && onb.bilance[group]) || [])
    .map((it) => `<tr><td>${label}</td><td>${esc(it.popis)}</td><td style="text-align:right">${esc(it.castka)} Kč</td></tr>`).join("");
  const bilanceBody = bilanceRows("prijmy", "Příjem") + bilanceRows("vydaje", "Výdaj") + bilanceRows("zavazky", "Závazek");
  const bilance = bilanceBody
    ? `<h3 style="border:none;margin-bottom:4px">Finanční bilance</h3>
       <table class="mini-table"><thead><tr><th>Typ</th><th>Položka</th><th style="text-align:right">Měsíčně</th></tr></thead><tbody>${bilanceBody}</tbody></table>`
    : "";

  const smlouvyBody = (onb.smlouvy || []).map((s) =>
    `<tr><td>${esc(s.typ)}</td><td>${esc(s.instituce)}</td><td style="text-align:right">${esc(s.mesicni_platba ?? s.platba ?? "")} Kč</td><td>${esc(s.poznamka)}</td></tr>`).join("");
  const smlouvy = smlouvyBody
    ? `<h3 style="border:none;margin-bottom:4px">Aktivní smlouvy</h3>
       <table class="mini-table"><thead><tr><th>Produkt</th><th>Instituce</th><th style="text-align:right">Platba</th><th>Poznámka</th></tr></thead><tbody>${smlouvyBody}</tbody></table>`
    : "";

  const docs = (onb.dokumenty || []).map((d) =>
    `<a class="doc-link" href="${d.data}" download="${esc(d.nazev)}">📄 ${esc(d.nazev)}</a>`).join(" · ");
  const dokumenty = docs ? `<h3 style="border:none;margin-bottom:4px">Dokumenty</h3><div style="font-size:13px">${docs}</div>` : "";

  return kontakt + bilance + smlouvy + dokumenty;
}

function renderAdvisorFields(c) {
  const p = c.poradce || {};
  return CONFIG.advisorFields.map((f) => {
    const val = p[f.key] ?? "";
    let input;
    if (f.type === "select") {
      const opts = ['<option value="">—</option>']
        .concat(f.options.map((o) => `<option ${val === o ? "selected" : ""}>${esc(o)}</option>`)).join("");
      input = `<select name="${f.key}">${opts}</select>`;
    } else {
      input = `<input type="${f.type === "date" ? "date" : "text"}" name="${f.key}" value="${esc(val)}" placeholder="${esc(f.placeholder || "")}">`;
    }
    return `<div class="onb-field"><label>${f.label}</label>${input}</div>`;
  }).join("");
}

// ---------------------------------------------------------------------------
// Režim „Kopírovat do 4fin"
// ---------------------------------------------------------------------------
function render4finTable(c) {
  const sources = { base: c, onboarding: c.onboarding || {}, poradce: c.poradce || {} };
  const rows = CONFIG.copy4finFields.map((f) => {
    let value = sources[f.source][f.key] ?? "";
    if (Array.isArray(value)) value = value.join(", ");
    const srcBadge = f.source === "onboarding"
      ? `<span class="src-badge client">klient</span>`
      : f.source === "poradce" ? `<span class="src-badge advisor">poradce</span>` : "";
    const display = value ? esc(value) : `<span class="copy4fin-empty">—</span>`;
    const btn = value ? `<button class="copy-btn" data-value="${esc(value)}">Kopírovat</button>` : "";
    return `<tr><td>${f.label} ${srcBadge}</td><td>${display}</td><td>${btn}</td></tr>`;
  }).join("");
  return `<table class="copy4fin-table">${rows}</table>`;
}

// ---------------------------------------------------------------------------
// Změny stavů + ukládání
// ---------------------------------------------------------------------------
function toggleState(client, oblastKey, state) {
  const ob = client.oblasti[oblastKey] || (client.oblasti[oblastKey] = { stav: "", faze: "", faze_historie: [], poznamka: "" });
  ob.stav = ob.stav === state ? "" : state; // opakovaný klik = zrušit
  markDirty(client.id);
  renderDetail(client);
}

function markDirty(id) {
  dirty.add(id);
  updateSaveBar();
}

function updateSaveBar() {
  $("#dirty-count").textContent = dirty.size;
  $("#save-bar").classList.toggle("visible", dirty.size > 0);
}

async function saveAll() {
  const status = $("#save-status");
  status.textContent = "Ukládám…";
  let indexVaroval = false;
  try {
    for (const id of [...dirty]) {
      const c = CLIENTS.get(id);
      if (!c) { dirty.delete(id); continue; }
      try {
        await Storage.saveClient(c, session.user);
      } catch (err) {
        if (err.kod === "index_neaktualizovan") { indexVaroval = true; }
        else throw err;
      }
      dirty.delete(id);
    }
    // přehled přenačíst z úložiště — sedí i po zápisech z jiného tabu
    try { INDEX = await Storage.listClients(); } catch { /* banner níže řeší index */ }
    updateSaveBar();
    renderList();
    if (indexVaroval) {
      showError(new Error("Klient uložen, přehled se nepodařilo aktualizovat — obnovte stránku."));
      status.textContent = "";
    } else {
      status.textContent = "Uloženo ✓";
    }
  } catch (err) {
    status.textContent = "";
    showError(err);
  }
}

async function rebuildIndex() {
  const status = $("#save-status");
  status.textContent = "Přegenerovávám přehled…";
  try {
    INDEX = await Storage.rebuildIndex();
    initFilters();
    renderList();
    status.textContent = "Přehled přegenerován ✓";
  } catch (err) {
    status.textContent = "";
    showError(err);
  }
}

function downloadJson() {
  const payload = currentClientId && CLIENTS.get(currentClientId)
    ? CLIENTS.get(currentClientId)
    : { klienti: INDEX };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = currentClientId ? `klient_${currentClientId}.json` : "klienti_index.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

function showListView() {
  currentClientId = null;
  $("#view-detail").hidden = true;
  $("#view-list").hidden = false;
  renderList();
}

// ---------------------------------------------------------------------------
// Import onboarding JSON (soubor od klienta)
// ---------------------------------------------------------------------------
async function importOnboarding(file) {
  try {
    const rec = JSON.parse(await file.text());
    if (!rec.onboarding) throw new Error("Soubor není záznam z onboarding formuláře.");
    let target = null;
    if (rec.klient_id) {
      try { target = await getClient(rec.klient_id); } catch { /* nenalezen → nový */ }
    }
    if (target) {
      target.onboarding = rec.onboarding;
      target.onboarding_submitted_at = rec.onboarding_submitted_at;
      $("#save-status").textContent = `Onboarding připojen ke klientovi ${target.jmeno} ${target.prijmeni}. Nezapomeňte uložit.`;
    } else {
      target = novyKlient(rec);
      CLIENTS.set(target.id, target);
      INDEX.push(indexEntry(target));
      $("#save-status").textContent = "Onboarding nahrán jako nový klient — doplňte jméno a uložte.";
    }
    // aktivní smlouvy rozřadit do produktových oblastí (config/oblasti.json)
    const mapa = await nactiOblastiMapu();
    rozradSmlouvy(target, rec.onboarding.smlouvy, mapa);
    markDirty(target.id);
    renderList();
  } catch (err) {
    showError(err);
  }
}

/** Prázdná karta klienta ve tvaru, se kterým pracuje UI. */
function prazdnyKlient(id, { jmeno = "", prijmeni = "", firma = "" } = {}) {
  const oblasti = {};
  for (const p of CONFIG.productFields) oblasti[p.key] = { stav: "", faze: "", faze_historie: [], poznamka: "" };
  return {
    id,
    vytvoreno: new Date().toISOString(),
    jmeno, prijmeni, firma,
    stav: "Nový klient", stav_retence: "aktivni",
    // obchodník = kdo kartu založil (v ostrém režimu id → FK, jméno jen pro zobrazení)
    obchodnik_id: session.id || null, obchodnik: session.jmeno || "",
    dohoda: "", datum: new Date().toISOString().slice(0, 10),
    lead_agent: "", oblacek: "", bilance: "", sdileni: "",
    poznamka_nzp: "", poznamky_lenka: "",
    oblasti, onboarding: null,
    poradce: {}, komentare: [], schuzky: [], ida_url: "", cile: [],
  };
}

function novyKlient(rec) {
  const c = prazdnyKlient(rec.klient_id || `onb${Date.now()}`, { prijmeni: "(z onboardingu — doplnit jméno)" });
  c.onboarding = rec.onboarding;
  c.onboarding_submitted_at = rec.onboarding_submitted_at;
  return c;
}

/** Ruční založení klienta z panelu „+ Nový klient". Uloží hned, pak otevře kartu. */
async function zalozKlienta() {
  const jmeno = $("#nk-jmeno").value.trim();
  const prijmeni = $("#nk-prijmeni").value.trim();
  const firma = $("#nk-firma").value.trim();
  $("#nk-chyba").textContent = "";
  if (!prijmeni && !firma) {
    $("#nk-chyba").textContent = "Zadejte alespoň příjmení, nebo název firmy.";
    return;
  }
  const btn = $("#nk-zalozit");
  btn.disabled = true;
  btn.textContent = "Zakládám…";
  try {
    const c = prazdnyKlient(crypto.randomUUID(), { jmeno, prijmeni, firma });
    await Storage.saveClient(c, session.user);
    CLIENTS.set(c.id, c);
    try { INDEX = await Storage.listClients(); } catch { INDEX.push(indexEntry(c)); }
    initFilters();
    $("#novy-klient-panel").hidden = true;
    ["nk-jmeno", "nk-prijmeni", "nk-firma"].forEach((i) => { $(`#${i}`).value = ""; });
    renderList();
    await openDetail(c.id);
    $("#save-status").textContent = "Karta založena ✓";
  } catch (err) {
    $("#nk-chyba").textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Založit kartu";
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
async function showApp() {
  $("#view-login").hidden = true;
  $("#view-app").hidden = false;
  $("#user-label").textContent = session.label;
  $("#import-onb").hidden = session.role !== "admin";
  $("#admin-section").hidden = session.role !== "admin";
  await nactiAppConfig();
  try {
    vytvorStorage(APP);
  } catch (err) {
    showError(err);
    return;
  }
  // Tlačítko na token má smysl jen v GitHub režimu — jinak se vůbec nezobrazí.
  $("#token-btn").hidden = !storagePotrebujeToken();
  $("#demo-reset").hidden = APP.storage !== "demo" || session.role !== "admin";
  // „Přegenerovat přehled" řeší rozpadlý index v GitHub režimu — jinde nedává smysl
  $("#rebuild-index").hidden = APP.storage !== "github";

  await loadConfigs();
  if (storagePotrebujeToken() && !Storage.hasToken()) {
    showError(new Error("Chybí přístupový token k datům — nastavte ho tlačítkem ‚Nastavit token'."));
    return;
  }
  await loadAndRender();
}

document.addEventListener("DOMContentLoaded", () => {
  $("#login-btn").addEventListener("click", tryLogin);
  $("#login-pass").addEventListener("keydown", (e) => { if (e.key === "Enter") tryLogin(); });
  $("#logout-btn").addEventListener("click", logout);
  $("#token-btn").addEventListener("click", askToken);
  $("#search").addEventListener("input", renderList);
  for (const id of ["filter-stav", "filter-obchodnik", "filter-product-state"]) {
    $(`#${id}`).addEventListener("change", renderList);
  }
  $("#filter-product").addEventListener("change", () => {
    $("#filter-product-state").hidden = !$("#filter-product").value;
    if (!$("#filter-product").value) $("#filter-product-state").value = "";
    renderList();
  });
  $("#client-rows").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-id]");
    if (tr) openDetail(tr.dataset.id);
  });
  $("#save-github").addEventListener("click", saveAll);
  $("#save-download").addEventListener("click", downloadJson);
  $("#rebuild-index").addEventListener("click", rebuildIndex);
  $("#demo-reset").addEventListener("click", async () => {
    if (!confirm("Opravdu zahodit všechny změny a vrátit ukázková data do původního stavu?")) return;
    try {
      INDEX = await Storage.resetDemo();
      CLIENTS.clear();
      dirty.clear();
      updateSaveBar();
      showListView();
      $("#save-status").textContent = "Ukázková data obnovena ✓";
    } catch (err) {
      showError(err);
    }
  });
  $("#novy-klient").addEventListener("click", () => {
    const p = $("#novy-klient-panel");
    p.hidden = !p.hidden;
    if (!p.hidden) {
      $("#nk-obchodnik-info").textContent = session.jmeno
        ? `Obchodník: ${session.jmeno} (přihlášený). Změnit půjde později v kartě.`
        : "";
      $("#nk-jmeno").focus();
    }
  });
  $("#nk-zrusit").addEventListener("click", () => { $("#novy-klient-panel").hidden = true; });
  $("#nk-zalozit").addEventListener("click", zalozKlienta);
  $("#nk-prijmeni").addEventListener("keydown", (e) => { if (e.key === "Enter") zalozKlienta(); });
  $("#import-onb").addEventListener("click", () => $("#import-onb-file").click());
  $("#import-onb-file").addEventListener("change", (e) => {
    if (e.target.files[0]) importOnboarding(e.target.files[0]);
    e.target.value = "";
  });

  $("#login-heslem-btn").addEventListener("click", prihlasHeslem);
  $("#login-heslo-input").addEventListener("keydown", (e) => { if (e.key === "Enter") prihlasHeslem(); });
  $("#login-email").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#login-heslo-input").focus(); });
  $("#login-magic-btn").addEventListener("click", (e) => { e.preventDefault(); posliMagicLink(); });

  start();
});

/** Rozhodne, jak se přihlašuje — podle režimu úložiště v config/app.json. */
async function start() {
  await nactiAppConfig();
  const ostry = APP.storage === "supabase";
  $("#login-magic").hidden = !ostry;
  $("#login-heslo").hidden = ostry;

  if (ostry) {
    // Odkaz odolný vůči skenerům: ověřit až po kliknutí člověka.
    const th = Auth.tokenHashZAdresy();
    if (th) {
      $("#view-login").hidden = false;
      $("#login-magic").hidden = true;
      $("#login-potvrzeni").hidden = false;
      const btn = $("#login-potvrdit-btn");
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = "Přihlašuji…";
        try {
          await Auth.potvrdOdkaz(th);
          await dokonciMagicLink();
        } catch (err) {
          $("#login-potvrzeni").hidden = true;
          $("#login-magic").hidden = false;
          $("#login-error").textContent = err.message;
          $("#login-email").focus();
        }
      }, { once: true });
      return;
    }

    // Odkaz, který už nejde použít — vysvětlit, ne mlčky ukázat přihlášení.
    const chyba = Auth.zachytChybu();
    if (chyba) {
      $("#view-login").hidden = false;
      $("#login-error").textContent = chyba;
      $("#login-email").focus();
      return;
    }
    // návrat z e-mailového odkazu, nebo obnovení běžícího přihlášení
    if (Auth.zachytZAdresy() || Auth.obnov()) {
      await dokonciMagicLink();
      return;
    }
    $("#view-login").hidden = false;
    return;
  }

  const saved = sessionStorage.getItem("40flow_session");
  if (saved) {
    session = JSON.parse(saved);
    showApp();
  } else {
    $("#view-login").hidden = false;
  }
}
