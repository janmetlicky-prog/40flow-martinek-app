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

function logout() {
  sessionStorage.removeItem("40flow_session");
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

function badge(value) {
  if (!value) return `<span class="badge empty">—</span>`;
  const color = CONFIG.stateColors[value] || "var(--text-muted)";
  return `<span class="badge" style="background:${color}">${esc(value)}</span>`;
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
      ${CONFIG.productFields.map((p) => `<td>${badge(oblastStav(c, p.key))}</td>`).join("")}
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

function renderDetail(c) {
  currentClientId = c.id;

  const productRows = CONFIG.productFields.map((p) => {
    const ob = c.oblasti[p.key] || { stav: "", faze: "" };
    const buttons = CONFIG.productStates.map((s) => {
      const active = ob.stav === s;
      const style = active ? `style="background:${CONFIG.stateColors[s]}"` : "";
      return `<button data-field="${p.key}" data-state="${esc(s)}" class="${active ? "active" : ""}" ${style}>${esc(s)}</button>`;
    }).join("");
    const extra = ob.stav && !CONFIG.productStates.includes(ob.stav)
      ? `<span class="badge" style="background:var(--text-muted)">${esc(ob.stav)}</span>` : "";
    return `<div class="product-row"><span class="product-name">${p.label}</span><div class="state-options">${buttons}</div>${extra}</div>`;
  }).join("");

  $("#view-detail").innerHTML = `
    <button class="detail-back" id="back-btn">← Zpět na přehled</button>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <h2>${esc(c.jmeno)} ${esc(c.prijmeni)}</h2>
          <div class="subtitle">${esc(c.firma || "")}</div>
        </div>
        <button class="mode-toggle" id="copy4fin-btn">Kopírovat do 4fin</button>
      </div>
      <div id="copy4fin-panel" hidden></div>
      <div id="normal-panel"></div>
    </div>`;

  $("#normal-panel").innerHTML = `
      <h3>Identifikace</h3>
      <div class="field-grid">
        ${field("Stav", c.stav)}
        ${field("Obchodník", c.obchodnik)}
        ${field("Lead Agent", c.lead_agent)}
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
      panel.innerHTML = `<h3>Přenos do 4fin — pole v pořadí formuláře</h3>${render4finTable(c)}`;
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

  $("#view-list").hidden = true;
  $("#view-detail").hidden = false;
}

// ---------------------------------------------------------------------------
// Karta — sekce podle zdroje dat
// ---------------------------------------------------------------------------
function renderClientData(c) {
  const onb = c.onboarding;
  if (!onb) return `<p class="copy4fin-empty">Klient zatím formulář nevyplnil. Odkaz pro klienta: <code>onboarding.html?klient=${esc(c.id)}</code></p>`;

  const kontakt = `
    <div class="field-grid">
      ${field("Telefon", onb.telefon)}
      ${field("E-mail", onb.email)}
      ${field("Trvalá adresa", onb.adresa_trvala)}
      ${field("Korespondenční adresa", onb.adresa_korespondencni)}
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
    `<tr><td>${esc(s.typ)}</td><td>${esc(s.instituce)}</td><td style="text-align:right">${esc(s.platba)} Kč</td><td>${esc(s.poznamka)}</td></tr>`).join("");
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
  try {
    for (const id of [...dirty]) {
      const c = CLIENTS.get(id);
      if (!c) { dirty.delete(id); continue; }
      await Storage.saveClient(c, session.user);
      dirty.delete(id);
      // aktualizovat řádek v indexu i lokálně
      const i = INDEX.findIndex((k) => k.id === id);
      const entry = indexEntry(c);
      if (i >= 0) INDEX[i] = entry; else INDEX.push(entry);
    }
    updateSaveBar();
    renderList();
    status.textContent = "Uloženo ✓";
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
    markDirty(target.id);
    renderList();
  } catch (err) {
    showError(err);
  }
}

function novyKlient(rec) {
  const oblasti = {};
  for (const p of CONFIG.productFields) oblasti[p.key] = { stav: "", faze: "", faze_historie: [], poznamka: "" };
  return {
    id: rec.klient_id || `onb${Date.now()}`,
    vytvoreno: new Date().toISOString(),
    jmeno: "", prijmeni: "(z onboardingu — doplnit jméno)",
    firma: "", stav: "Nový klient", obchodnik: "", dohoda: "", datum: new Date().toISOString().slice(0, 10),
    lead_agent: "", oblacek: "", bilance: "", sdileni: "",
    poznamka_nzp: "", poznamky_lenka: "",
    oblasti,
    onboarding: rec.onboarding,
    onboarding_submitted_at: rec.onboarding_submitted_at,
    poradce: {}, komentare: [], schuzky: [], ida_url: "", cile: [],
  };
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
async function showApp() {
  $("#view-login").hidden = true;
  $("#view-app").hidden = false;
  $("#user-label").textContent = session.label;
  $("#import-onb").hidden = session.role !== "admin";
  if (!Storage.hasToken()) {
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
  $("#import-onb").addEventListener("click", () => $("#import-onb-file").click());
  $("#import-onb-file").addEventListener("change", (e) => {
    if (e.target.files[0]) importOnboarding(e.target.files[0]);
    e.target.value = "";
  });

  const saved = sessionStorage.getItem("40flow_session");
  if (saved) {
    session = JSON.parse(saved);
    showApp();
  } else {
    $("#view-login").hidden = false;
  }
});
