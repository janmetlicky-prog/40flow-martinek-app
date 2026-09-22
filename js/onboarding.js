/* Vstupní formulář — klientská část údajů.
   Rodné číslo, doklady, bankovní účet, segmentace, daňové rezidentství → vyplňuje
   poradce v kartě klienta, tady záměrně nejsou a ani se nevykreslují.

   Režimy:
     - poradce (přihlášen): předvyplní se z karty, uloží přes Storage.saveClient
     - bez přihlášení: na konci stažení souboru (klientský režim s tokenem = blok B)

   Rozpracované vyplnění se ukládá do localStorage per klient. */
"use strict";

const $ = (sel) => document.querySelector(sel);

const PARAMS = new URLSearchParams(location.search);
const KLIENT_ID = PARAMS.get("klient") || "";
const KLIENT_TOKEN = PARAMS.get("k") || "";          // klientský režim: odkaz s tokenem
const REZIM_KLIENT = !!KLIENT_TOKEN;
const DRAFT_KEY = `40flow_onb_draft_${REZIM_KLIENT ? "k_" : ""}${KLIENT_ID || "novy"}`;
const MAX_FILE_MB = 5;

// ---------------------------------------------------------------------------
// Kroky
// ---------------------------------------------------------------------------
const STEPS = [
  {
    id: "kontakt",
    title: "Kontakt",
    hint: "Údaje, přes které vás poradce zastihne.",
    type: "kontakt",
    fields: [
      { key: "telefon", label: "Telefon", required: true, value: "+420 ", validate: "tel", placeholder: "+420 777 123 456" },
      { key: "email", label: "E-mail", required: true, validate: "email", placeholder: "jmeno@email.cz" },
    ],
  },
  {
    id: "osobni",
    title: "Osobní údaje",
    hint: "",
    fields: [
      { key: "rodinny_stav", label: "Rodinný stav", type: "select",
        options: ["Svobodný/á", "Ženatý / vdaná", "Rozvedený/á", "Vdovec / vdova", "Registrované partnerství"] },
      { key: "povolani", label: "Povolání" },
      { key: "zdroj_prijmu", label: "Zdroj příjmů", type: "radio", options: ["OSVČ", "Zaměstnání"] },
    ],
  },
  {
    id: "bilance",
    title: "Finanční bilance",
    hint: "Měsíční částky. Přidejte tolik položek, kolik potřebujete.",
    type: "bilance",
    groups: [
      { key: "prijmy", label: "Příjmy", placeholder: "např. mzda, nájem z bytu" },
      { key: "vydaje", label: "Výdaje", placeholder: "např. nájem, energie, jídlo" },
      { key: "zavazky", label: "Závazky", placeholder: "např. hypotéka, leasing, půjčka" },
    ],
  },
  {
    id: "smlouvy",
    title: "Aktivní smlouvy",
    hint: "Pojištění, investice, úvěry — co už máte sjednané jinde.",
    type: "smlouvy",
  },
  {
    id: "dokumenty",
    title: "Dokumenty",
    hint: "Které podklady už máme a které ještě potřebujeme. Nahrávání souborů přijde v dalším kroku.",
    type: "dokumenty",
  },
];

const ADRESA_PRAZDNA = () => ({ ulice: "", cislo: "", mesto: "", psc: "" });

let step = 0;
let data = prazdnaData();
let record = null;
let puvodniOnboarding = null;   // režim poradce: co bylo v kartě před úpravou
let DOK_CFG = { polozky: [], stavy: {} };   // config/dokumenty.json
let klientDokumenty = [];       // řádky z karty (s id) — sloučí se s checklistem

function prazdnaData() {
  return {
    adresa_trvala: ADRESA_PRAZDNA(),
    adresa_korespondencni: ADRESA_PRAZDNA(),
    adresa_korespondencni_shodna: true,
    bilance: { prijmy: [], vydaje: [], zavazky: [] },
    smlouvy: [],
    dokumenty: [],
  };
}

// ---------------------------------------------------------------------------
// Validace
// ---------------------------------------------------------------------------
const VALIDATORS = {
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? "" : "Zadejte e-mail ve tvaru jmeno@domena.cz.",
  tel(v) {
    // české formáty: 777 123 456, +420 777 123 456, 00420777123456, 777123456
    const digits = v.replace(/[\s\-().]/g, "").replace(/^00/, "+");
    return /^(\+\d{1,3})?\d{9}$/.test(digits) ? "" : "Telefon zadejte jako 9 číslic, případně s předvolbou +420. Mezery nevadí.";
  },
  psc: (v) => /^\d{5}$/.test(v.replace(/\s/g, "")) ? "" : "PSČ má 5 číslic.",
};

// ---------------------------------------------------------------------------
// Draft — rozpracované uložení a návrat
// ---------------------------------------------------------------------------
function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ step, data, saved_at: new Date().toISOString() }));
  } catch { /* plný storage — draft je jen pohodlí */ }
}

function readDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function applyDraft(draft) {
  data = { ...prazdnaData(), ...draft.data };
  step = Math.min(draft.step ?? 0, STEPS.length - 1);
}

function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* noop */ }
}

function fmtDatum(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleString("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ---------------------------------------------------------------------------
// Peníze
// ---------------------------------------------------------------------------
function castka(v) {
  const n = Number(String(v ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
function fmtKc(n) {
  const abs = Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${n < 0 ? "−" : ""}${abs} Kč`;
}
function soucty() {
  const s = (g) => data.bilance[g].reduce((a, it) => a + castka(it.castka), 0);
  const prijmy = s("prijmy"), vydaje = s("vydaje"), zavazky = s("zavazky");
  return { prijmy, vydaje, zavazky, rozdil: prijmy - vydaje - zavazky };
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch]);
}

function fieldHtml(f) {
  const req = f.required ? ` <span class="req">*</span>` : "";
  const cls = f.full ? "onb-field full" : "onb-field";
  const val = data[f.key] ?? f.value ?? "";

  if (f.type === "radio") {
    const opts = f.options.map((o) => `
      <label><input type="radio" name="${f.key}" value="${esc(o)}" ${val === o ? "checked" : ""}> ${esc(o)}</label>`).join("");
    return `<div class="${cls}" data-key="${f.key}"><label>${f.label}${req}</label><div class="onb-radio-row">${opts}</div><div class="err"></div></div>`;
  }
  if (f.type === "select") {
    const opts = ['<option value="">— vyberte —</option>']
      .concat(f.options.map((o) => `<option ${val === o ? "selected" : ""}>${esc(o)}</option>`)).join("");
    return `<div class="${cls}" data-key="${f.key}"><label>${f.label}${req}</label><select name="${f.key}">${opts}</select><div class="err"></div></div>`;
  }
  return `<div class="${cls}" data-key="${f.key}"><label>${f.label}${req}</label>
    <input type="text" name="${f.key}" value="${esc(val)}" placeholder="${esc(f.placeholder || "")}"><div class="err"></div></div>`;
}

/** Blok adresy: ulice / číslo / město / PSČ. `prefix` = trvala | korespondencni. */
function adresaHtml(prefix, a, povinna) {
  const req = povinna ? ` <span class="req">*</span>` : "";
  return `
    <div class="onb-adresa" data-adresa="${prefix}">
      <div class="onb-field full onb-adresa-hledat" data-suggest="${prefix}">
        <label>Hledat adresu${req}</label>
        <input type="text" class="adr-hledat" placeholder="začněte psát ulici a město…" autocomplete="off">
        <div class="adr-navrhy" hidden></div>
      </div>
      <div class="onb-field"><label>Ulice</label><input class="adr-ulice" value="${esc(a.ulice)}"></div>
      <div class="onb-field"><label>Č. p. / č. o.</label><input class="adr-cislo" value="${esc(a.cislo)}" placeholder="123/4"></div>
      <div class="onb-field"><label>Město</label><input class="adr-mesto" value="${esc(a.mesto)}"></div>
      <div class="onb-field"><label>PSČ</label><input class="adr-psc" value="${esc(a.psc)}" inputmode="numeric" placeholder="110 00"><div class="err"></div></div>
    </div>`;
}

function kontaktHtml(s) {
  const shodna = data.adresa_korespondencni_shodna !== false;
  return `
    <div class="onb-grid">${s.fields.map(fieldHtml).join("")}</div>
    <h4 class="onb-h4">Trvalá adresa <span class="req">*</span></h4>
    ${adresaHtml("trvala", data.adresa_trvala, false)}
    <div class="onb-field full" style="margin-top:14px">
      <label class="check-inline"><input type="checkbox" id="adr-shodna" ${shodna ? "checked" : ""}> Korespondenční adresa je shodná s trvalou</label>
    </div>
    <div id="adr-koresp-blok" ${shodna ? "hidden" : ""}>
      <h4 class="onb-h4">Korespondenční adresa</h4>
      ${adresaHtml("korespondencni", data.adresa_korespondencni, false)}
    </div>`;
}

function bilanceGroupHtml(g) {
  const items = data.bilance[g.key].length ? data.bilance[g.key] : [{ popis: "", castka: "" }];
  const rows = items.map((it, i) => `
    <div class="onb-item-row" data-group="${g.key}" data-idx="${i}">
      <input class="item-popis" value="${esc(it.popis)}" placeholder="${esc(g.placeholder)}">
      <input class="item-castka" value="${esc(it.castka)}" placeholder="Kč/měs" inputmode="numeric">
      <button type="button" class="item-del" title="Odebrat">×</button>
    </div>`).join("");
  return `
    <div class="onb-bilance-group" data-group="${g.key}">
      <div class="onb-group-head"><h4>${g.label}</h4><span class="onb-soucet" data-soucet="${g.key}"></span></div>
      ${rows}
      <button type="button" class="onb-add-btn" data-add-item="${g.key}">+ Přidat položku</button>
    </div>`;
}

function bilanceHtml(s) {
  return `${s.groups.map(bilanceGroupHtml).join("")}
    <div class="onb-bilance-rozdil">
      <span>Měsíční rozdíl (příjmy − výdaje − závazky)</span>
      <strong id="bilance-rozdil"></strong>
    </div>`;
}

function prepocitejBilanci() {
  // čte přímo z polí, ať se součty mění při psaní
  const s = (g) => [...document.querySelectorAll(`.onb-item-row[data-group="${g}"] .item-castka`)]
    .reduce((a, i) => a + castka(i.value), 0);
  const prijmy = s("prijmy"), vydaje = s("vydaje"), zavazky = s("zavazky");
  const rozdil = prijmy - vydaje - zavazky;
  for (const [g, v] of [["prijmy", prijmy], ["vydaje", vydaje], ["zavazky", zavazky]]) {
    const el = document.querySelector(`[data-soucet="${g}"]`);
    if (el) el.textContent = fmtKc(v);
  }
  const r = $("#bilance-rozdil");
  if (r) { r.textContent = fmtKc(rozdil); r.classList.toggle("zaporny", rozdil < 0); }
}

function smlouvyHtml() {
  const items = data.smlouvy.length ? data.smlouvy : [{ typ: "", instituce: "", mesicni_platba: "", poznamka: "" }];
  const rows = items.map((s, i) => `
    <div class="onb-smlouva" data-idx="${i}">
      <div class="onb-grid">
        <div class="onb-field"><label>Typ produktu</label><input class="sm-typ" value="${esc(s.typ)}" placeholder="např. životní pojištění"></div>
        <div class="onb-field"><label>Instituce</label><input class="sm-instituce" value="${esc(s.instituce)}" placeholder="např. pojišťovna, banka"></div>
        <div class="onb-field"><label>Měsíční platba (Kč)</label><input class="sm-platba" value="${esc(s.mesicni_platba ?? s.platba ?? "")}" inputmode="numeric"></div>
        <div class="onb-field"><label>Poznámka</label><input class="sm-poznamka" value="${esc(s.poznamka)}"></div>
      </div>
      <button type="button" class="item-del sm-del" title="Odebrat smlouvu">× Odebrat</button>
    </div>`).join("");
  return `${rows}<button type="button" class="onb-add-btn" id="add-smlouva">+ Přidat další smlouvu</button>`;
}

/** Checklist: položky z configu + vlastní. Stav „čeká na kontrolu" nastavuje jen upload klienta. */
function dokumentyHtml() {
  const stavy = Object.entries(DOK_CFG.stavy || {}).filter(([k]) => k !== "ceka_na_kontrolu");
  const rows = data.dokumenty.map((d, i) => {
    if (d.smazano) return "";
    const opts = stavy.map(([k, v]) => `<option value="${k}" ${d.stav === k ? "selected" : ""}>${esc(v)}</option>`).join("");
    const zamek = d.stav === "ceka_na_kontrolu" ? `<option value="ceka_na_kontrolu" selected>${esc(DOK_CFG.stavy.ceka_na_kontrolu)}</option>` : "";
    if (REZIM_KLIENT) {
      return `<div class="onb-dok-row" data-idx="${i}"><span>${esc(d.nazev)}</span>
        <span class="muted-small">${esc((DOK_CFG.stavy || {})[d.stav] || d.stav)}</span></div>`;
    }
    return `<div class="onb-dok-row" data-idx="${i}">
      <span>${esc(d.nazev)}${d.checklist_klic ? "" : `<span class="dok-vlastni">vlastní</span>`}</span>
      <span><select class="dok-stav">${zamek}${opts}</select>
        ${d.checklist_klic ? "" : `<button type="button" class="item-del dok-del" title="Odebrat">×</button>`}</span>
    </div>`;
  }).join("");
  if (REZIM_KLIENT) return rows || `<p class="muted-small">Zatím žádné dokumenty k dodání.</p>`;
  return `${rows}
    <div class="dok-add-row" style="margin-top:12px">
      <input id="dok-novy" placeholder="další dokument, např. smlouva o dílo">
      <button type="button" id="dok-add" class="onb-add-btn">+ Přidat položku</button>
    </div>`;
}

/** Sloučí položky z configu s tím, co má klient uložené (podle klíče). */
function sestavDokumenty(ulozene) {
  const out = [];
  for (const p of DOK_CFG.polozky || []) {
    const u = (ulozene || []).find((d) => d.checklist_klic === p.klic);
    out.push(u ? { ...u } : { checklist_klic: p.klic, nazev: p.nazev, stav: "nedodano" });
  }
  for (const u of ulozene || []) if (!u.checklist_klic) out.push({ ...u });
  return out;
}

function renderStep() {
  const s = STEPS[step];
  let body;
  if (s.type === "kontakt") body = kontaktHtml(s);
  else if (s.type === "bilance") body = bilanceHtml(s);
  else if (s.type === "smlouvy") body = smlouvyHtml();
  else if (s.type === "dokumenty") body = dokumentyHtml();
  else body = `<div class="onb-grid">${s.fields.map(fieldHtml).join("")}</div>`;

  $("#steps").innerHTML = `
    <div class="onb-step">
      <h2>${s.title}</h2>
      <div class="step-hint">${s.hint}</div>
      ${body}
    </div>`;

  $("#progress").innerHTML = STEPS.map((_, i) =>
    `<div class="seg ${i <= step ? "done" : ""}"></div>`).join("");
  $("#progress-label").textContent = `Krok ${step + 1} z ${STEPS.length} — ${s.title}`;
  $("#btn-prev").style.visibility = step === 0 ? "hidden" : "visible";
  $("#btn-next").textContent = step === STEPS.length - 1 ? (REZIM_KLIENT ? "Odeslat poradci" : "Odeslat") : "Pokračovat →";

  bindStepEvents(s);
}

function bindStepEvents(s) {
  if (s.type === "kontakt") {
    $("#adr-shodna").addEventListener("change", (e) => {
      $("#adr-koresp-blok").hidden = e.target.checked;
      data.adresa_korespondencni_shodna = e.target.checked;
    });
    document.querySelectorAll("[data-suggest]").forEach(zapniNaseptavac);
  }
  if (s.type === "bilance") {
    document.querySelectorAll("[data-add-item]").forEach((btn) => btn.addEventListener("click", () => {
      collectStep();
      data.bilance[btn.dataset.addItem].push({ popis: "", castka: "" });
      renderStep();
    }));
    document.querySelectorAll(".onb-item-row .item-del").forEach((btn) => btn.addEventListener("click", () => {
      const row = btn.closest(".onb-item-row");
      collectStep();
      data.bilance[row.dataset.group].splice(Number(row.dataset.idx), 1);
      renderStep();
    }));
    document.querySelectorAll(".item-castka").forEach((i) => i.addEventListener("input", prepocitejBilanci));
    prepocitejBilanci();
  }
  if (s.type === "smlouvy") {
    $("#add-smlouva")?.addEventListener("click", () => {
      collectStep();
      data.smlouvy.push({ typ: "", instituce: "", mesicni_platba: "", poznamka: "" });
      renderStep();
    });
    document.querySelectorAll(".sm-del").forEach((btn) => btn.addEventListener("click", () => {
      collectStep();
      data.smlouvy.splice(Number(btn.closest(".onb-smlouva").dataset.idx), 1);
      renderStep();
    }));
  }
  if (s.type === "dokumenty" && !REZIM_KLIENT) {
    $("#dok-add").addEventListener("click", () => {
      const nazev = $("#dok-novy").value.trim();
      if (!nazev) return;
      collectStep();
      data.dokumenty.push({ checklist_klic: "", nazev, stav: "nedodano" });
      renderStep();
    });
    document.querySelectorAll(".dok-del").forEach((btn) => btn.addEventListener("click", () => {
      collectStep();
      const i = Number(btn.closest(".onb-dok-row").dataset.idx);
      if (data.dokumenty[i].id) data.dokumenty[i].smazano = true; else data.dokumenty.splice(i, 1);
      renderStep();
    }));
  }
}

// ---------------------------------------------------------------------------
// Našeptávač adres (Mapy.cz). Bez klíče v config/app.json se pole „Hledat
// adresu" schová a adresa se píše ručně — nic dalšího se nemění.
// ---------------------------------------------------------------------------
function zapniNaseptavac(wrap) {
  const klic = APP.mapy && APP.mapy.api_key;
  if (!klic) { wrap.hidden = true; return; }
  const input = wrap.querySelector(".adr-hledat");
  const box = wrap.querySelector(".adr-navrhy");
  const blok = wrap.closest(".onb-adresa");
  let t = null;
  input.addEventListener("input", () => {
    clearTimeout(t);
    const q = input.value.trim();
    if (q.length < 3) { box.hidden = true; return; }
    t = setTimeout(async () => {
      try {
        const u = new URL("https://api.mapy.cz/v1/suggest");
        u.search = new URLSearchParams({ query: q, lang: "cs", limit: "6", type: "regional.address", apikey: klic });
        const r = await fetch(u);
        if (!r.ok) throw new Error(String(r.status));
        const items = (await r.json()).items || [];
        box.innerHTML = items.map((it, i) =>
          `<button type="button" class="adr-navrh" data-i="${i}">${esc(it.name)}<span>${esc(it.location || "")}</span></button>`).join("");
        box.hidden = items.length === 0;
        box.querySelectorAll(".adr-navrh").forEach((b) => b.addEventListener("click", () => {
          const it = items[Number(b.dataset.i)];
          const rs = it.regionalStructure || [];
          const najdi = (typ) => (rs.find((x) => x.type === typ) || {}).name || "";
          blok.querySelector(".adr-ulice").value = najdi("regional.street") || najdi("regional.municipality_part") || "";
          blok.querySelector(".adr-cislo").value = najdi("regional.address") || "";
          blok.querySelector(".adr-mesto").value = najdi("regional.municipality") || "";
          blok.querySelector(".adr-psc").value = (it.zip || "").replace(/\s/g, "");
          input.value = it.name + (it.location ? `, ${it.location}` : "");
          box.hidden = true;
        }));
      } catch { box.hidden = true; }
    }, 250);
  });
  document.addEventListener("click", (e) => { if (!wrap.contains(e.target)) box.hidden = true; });
}

// ---------------------------------------------------------------------------
// Sběr + validace kroku
// ---------------------------------------------------------------------------
function ctiAdresu(prefix) {
  const b = document.querySelector(`.onb-adresa[data-adresa="${prefix}"]`);
  return {
    ulice: b.querySelector(".adr-ulice").value.trim(),
    cislo: b.querySelector(".adr-cislo").value.trim(),
    mesto: b.querySelector(".adr-mesto").value.trim(),
    psc: b.querySelector(".adr-psc").value.replace(/\s/g, ""),
  };
}

function overAdresu(prefix, a, povinna) {
  const b = document.querySelector(`.onb-adresa[data-adresa="${prefix}"]`);
  const err = b.querySelector(".err");
  err.textContent = "";
  const vyplnena = a.ulice || a.cislo || a.mesto || a.psc;
  if (povinna && !(a.mesto && a.psc)) { err.textContent = "Vyplňte alespoň město a PSČ."; return false; }
  if (vyplnena && a.psc) {
    const m = VALIDATORS.psc(a.psc);
    if (m) { err.textContent = m; return false; }
  }
  return true;
}

function collectStep() {
  const s = STEPS[step];
  let ok = true;

  if (s.type === "bilance") {
    for (const g of s.groups) {
      data.bilance[g.key] = [...document.querySelectorAll(`.onb-item-row[data-group="${g.key}"]`)]
        .map((row) => ({
          popis: row.querySelector(".item-popis").value.trim(),
          castka: row.querySelector(".item-castka").value.trim(),
        }))
        .filter((it) => it.popis || it.castka);
    }
    return true;
  }
  if (s.type === "smlouvy") {
    data.smlouvy = [...document.querySelectorAll(".onb-smlouva")]
      .map((el) => ({
        typ: el.querySelector(".sm-typ").value.trim(),
        instituce: el.querySelector(".sm-instituce").value.trim(),
        mesicni_platba: el.querySelector(".sm-platba").value.trim(),
        poznamka: el.querySelector(".sm-poznamka").value.trim(),
      }))
      .filter((sm) => sm.typ || sm.instituce || sm.mesicni_platba);
    return true;
  }
  if (s.type === "dokumenty") {
    if (!REZIM_KLIENT) document.querySelectorAll(".onb-dok-row").forEach((row) => {
      const d = data.dokumenty[Number(row.dataset.idx)];
      const sel = row.querySelector(".dok-stav");
      if (d && sel) d.stav = sel.value;
    });
    return true;
  }

  for (const f of s.fields || []) {
    const wrap = document.querySelector(`[data-key="${f.key}"]`);
    const err = wrap.querySelector(".err");
    err.textContent = "";
    let value;
    if (f.type === "radio") {
      const checked = wrap.querySelector("input:checked");
      value = checked ? checked.value : "";
    } else {
      value = wrap.querySelector("input, select").value.trim();
    }
    data[f.key] = value;
    if (f.required && !value) {
      err.textContent = "Toto pole je povinné.";
      ok = false;
      continue;
    }
    if (value && f.validate) {
      const msg = VALIDATORS[f.validate](value);
      if (msg) { err.textContent = msg; ok = false; }
    }
  }

  if (s.type === "kontakt") {
    data.adresa_trvala = ctiAdresu("trvala");
    data.adresa_korespondencni_shodna = $("#adr-shodna").checked;
    data.adresa_korespondencni = data.adresa_korespondencni_shodna ? ADRESA_PRAZDNA() : ctiAdresu("korespondencni");
    if (!overAdresu("trvala", data.adresa_trvala, true)) ok = false;
    if (!data.adresa_korespondencni_shodna && !overAdresu("korespondencni", data.adresa_korespondencni, false)) ok = false;
  }
  return ok;
}

// ---------------------------------------------------------------------------
// Výstup
// ---------------------------------------------------------------------------
function buildOnboarding() {
  return {
    telefon: data.telefon || "",
    email: data.email || "",
    adresa_trvala: data.adresa_trvala,
    adresa_korespondencni_shodna: data.adresa_korespondencni_shodna !== false,
    adresa_korespondencni: data.adresa_korespondencni_shodna !== false ? null : data.adresa_korespondencni,
    rodinny_stav: data.rodinny_stav || "",
    povolani: data.povolani || "",
    zdroj_prijmu: data.zdroj_prijmu || "",
    bilance: data.bilance,
    smlouvy: data.smlouvy,
  };
}

function buildRecord() {
  return { klient_id: KLIENT_ID, onboarding_submitted_at: new Date().toISOString(), onboarding: buildOnboarding() };
}

function finish() {
  record = buildRecord();
  if (REZIM_KLIENT) { odesliPoradci(); return; }
  $("#onb-form").hidden = true;
  $("#progress").hidden = true;
  $("#progress-label").hidden = true;
  $("#done").hidden = false;
  if (Storage.umiZapisovat && Storage.umiZapisovat()) {
    $("#btn-save-storage").hidden = false;
    $("#done-hint").textContent = "Údaje můžete uložit rovnou do systému, nebo si je stáhnout jako soubor.";
  }
}

/** Klientský režim: odeslání změn přes edge funkci (bez účtu, s tokenem). */
async function odesliPoradci() {
  const btn = $("#btn-next");
  btn.disabled = true; btn.textContent = "Odesílám…";
  try {
    const out = await Storage.klientUlozit(KLIENT_TOKEN, record.onboarding);
    clearDraft();
    $("#onb-form").hidden = true; $("#progress").hidden = true; $("#progress-label").hidden = true;
    const chybi = (out.chybi || []);
    $("#klient-hotovo").hidden = false;
    $("#klient-hotovo-chybi").innerHTML = chybi.length
      ? `<p>Ještě nám chybí:</p><ul>${chybi.map((x) => `<li>${esc(x)}</li>`).join("")}</ul><p class="muted-small">Můžete doplnit kdykoli — odkaz platí dál.</p>`
      : `<p>Máme od vás všechno potřebné. Děkujeme.</p>`;
    window.scrollTo({ top: 0 });
  } catch (err) {
    $("#klient-chyba").textContent = err.message;
    btn.disabled = false; btn.textContent = "Odeslat poradci";
  }
}

/** Klientský režim: načtení vlastní části dat přes token. Neplatný odkaz = jediná hláška. */
async function nactiKlientskyRezim() {
  document.body.classList.add("rezim-klient");
  $("#klient-uvod").hidden = false;
  try {
    const d = await Storage.klientPristup(KLIENT_TOKEN);
    const jm = `${d.klient.jmeno || ""} ${d.klient.prijmeni || ""}`.trim();
    $("#klient-uvod").innerHTML = `Dobrý den${jm ? `, ${esc(jm)}` : ""}, <strong>${esc(d.klient.poradce)}</strong> vás požádal o doplnění údajů. Odkaz platí do ${fmtDatum(d.platnost_do)}.`;
    puvodniOnboarding = d.onboarding;
    naplnZOnboardingu(d.onboarding);
    // dokumenty: klient vidí jen název a stav, nemění je (upload přijde v dalším kroku)
    klientDokumenty = d.dokumenty.map((x) => ({ ...x, checklist_klic: "", jenCteni: true }));
    data.dokumenty = klientDokumenty;
    return true;
  } catch (err) {
    $("#klient-uvod").hidden = true;
    $("#klient-neplatny").hidden = false;
    $("#klient-neplatny-text").textContent = err.message;
    return false;
  }
}

/** Předvyplnění z karty klienta (režim poradce — „Upravit ve formuláři"). */
function naplnZOnboardingu(onb) {
  const adr = (a) => (a && typeof a === "object") ? { ...ADRESA_PRAZDNA(), ...a }
    : (a ? { ...ADRESA_PRAZDNA(), ulice: String(a) } : ADRESA_PRAZDNA());   // starší záznamy měly adresu jako text
  data = {
    ...prazdnaData(),
    telefon: onb.telefon || "", email: onb.email || "",
    rodinny_stav: onb.rodinny_stav || "", povolani: onb.povolani || "", zdroj_prijmu: onb.zdroj_prijmu || "",
    adresa_trvala: adr(onb.adresa_trvala),
    adresa_korespondencni_shodna: onb.adresa_korespondencni_shodna !== false && !onb.adresa_korespondencni,
    adresa_korespondencni: adr(onb.adresa_korespondencni),
    bilance: { prijmy: [], vydaje: [], zavazky: [], ...(onb.bilance || {}) },
    smlouvy: (onb.smlouvy || []).map((s) => ({ ...s, mesicni_platba: s.mesicni_platba ?? s.platba ?? "" })),
    dokumenty: sestavDokumenty(klientDokumenty),
  };
}

async function saveToStorage() {
  const out = $("#save-result");
  out.textContent = "Ukládám…";
  try {
    let client = null;
    if (KLIENT_ID) {
      try { client = await Storage.loadClient(KLIENT_ID); } catch { /* nenalezen → nový */ }
    }
    if (client) {
      client.onboarding = record.onboarding;
      client.onboarding_submitted_at = record.onboarding_submitted_at;
      client.dokumenty = data.dokumenty;   // checklist (server doplní/aktualizuje, nemaže)
    } else {
      const oblasti = {};
      for (const p of CONFIG.productFields) oblasti[p.key] = { stav: "", faze: "", faze_historie: [], poznamka: "" };
      client = {
        id: KLIENT_ID || `onb${Date.now()}`,
        vytvoreno: new Date().toISOString(),
        jmeno: "", prijmeni: "(z onboardingu — doplnit jméno)",
        firma: "", stav: "Nový klient", obchodnik: "", dohoda: "",
        datum: new Date().toISOString().slice(0, 10),
        oblacek: "", bilance: "", sdileni: "", poznamka_nzp: "", poznamky_lenka: "",
        oblasti,
        onboarding: record.onboarding,
        onboarding_submitted_at: record.onboarding_submitted_at,
        poradce: {}, komentare: [], schuzky: [], ida_url: "", cile: [],
        dokumenty: data.dokumenty,
      };
    }
    const mapa = await nactiOblastiMapu();
    rozradSmlouvy(client, record.onboarding.smlouvy, mapa);
    await Storage.saveClient(client, "onboarding");
    clearDraft();   // úspěšně uloženo → rozpracované už není třeba
    out.textContent = "Uloženo do systému ✓ — poradce údaje uvidí v přehledu klientů.";
  } catch (err) {
    out.textContent = err.message;
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  await nactiAppConfig();
  try { DOK_CFG = await (await fetch("config/dokumenty.json")).json(); } catch { /* bez checklistu */ }
  data.dokumenty = sestavDokumenty([]);
  if (typeof Auth !== "undefined") Auth.obnov();
  try { vytvorStorage(APP); } catch { /* formulář jde vyplnit i bez úložiště */ }

  if (REZIM_KLIENT) {
    if (!(Storage.klientPristup) || !(await nactiKlientskyRezim())) return;   // neplatný odkaz: nic dalšího
  }
  // Režim poradce: předvyplnit z karty (upravit existující dotazník)
  if (!REZIM_KLIENT && KLIENT_ID && Storage.umiZapisovat && Storage.umiZapisovat()) {
    try {
      const c = await Storage.loadClient(KLIENT_ID);
      klientDokumenty = c.dokumenty || [];
      if (c.onboarding) { puvodniOnboarding = c.onboarding; naplnZOnboardingu(c.onboarding); }
      else data.dokumenty = sestavDokumenty(klientDokumenty);
      const jm = `${c.jmeno || ""} ${c.prijmeni || ""}`.trim();
      if (jm) $("#klient-jmeno").textContent = `Klient: ${jm}`;
    } catch { /* bez předvyplnění */ }
  }

  // Rozpracované z minula: nabídnout, nevnucovat
  const draft = readDraft();
  if (draft) {
    $("#draft-note").hidden = false;
    $("#draft-note-text").textContent = `Máte rozpracovaný formulář z ${fmtDatum(draft.saved_at)}.`;
    $("#draft-pokracovat").addEventListener("click", () => { applyDraft(draft); $("#draft-note").hidden = true; renderStep(); });
    $("#draft-znovu").addEventListener("click", () => { clearDraft(); $("#draft-note").hidden = true; });
  }
  renderStep();

  $("#btn-next").addEventListener("click", () => {
    if (!collectStep()) return;
    if (step === STEPS.length - 1) { saveDraft(); finish(); return; }
    step += 1;
    saveDraft();   // až po posunu — návrat z draftu má pokračovat dalším krokem, ne opakovat hotový
    renderStep();
    window.scrollTo({ top: 0 });
  });
  $("#btn-prev").addEventListener("click", () => {
    collectStep();
    saveDraft();
    step = Math.max(0, step - 1);
    renderStep();
  });
  $("#btn-save-draft").addEventListener("click", () => {
    collectStep();
    saveDraft();
    $("#draft-status").textContent = "Rozpracováno uloženo — můžete se vrátit později (stejný prohlížeč).";
  });
  $("#btn-clear-draft").addEventListener("click", () => {
    clearDraft();
    data = prazdnaData();
    if (puvodniOnboarding) naplnZOnboardingu(puvodniOnboarding);
    step = 0;
    renderStep();
    $("#draft-status").textContent = "Rozpracované vymazáno.";
  });
  $("#btn-save-storage").addEventListener("click", saveToStorage);
  $("#btn-download").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `onboarding_${KLIENT_ID || "klient"}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
});
