/* Klientský onboarding — sbírá JEN to, co klient sám dodává.
   Rodné číslo, doklady, bankovní účet, segmentace, daňové rezidentství → vyplňuje
   poradce v kartě klienta, tady záměrně nejsou.
   Rozpracované vyplnění se průběžně ukládá do localStorage (návrat později). */
"use strict";

const $ = (sel) => document.querySelector(sel);

const DRAFT_KEY = "40flow_onb_draft";
const KLIENT_ID = new URLSearchParams(location.search).get("klient") || "";
const MAX_FILE_MB = 5;

// ---------------------------------------------------------------------------
// Kroky
// ---------------------------------------------------------------------------
const STEPS = [
  {
    id: "kontakt",
    title: "Kontakt",
    hint: "Údaje, přes které vás poradce zastihne.",
    fields: [
      { key: "telefon", label: "Telefon", required: true, value: "+420 ", validate: "tel", placeholder: "+420 777 123 456" },
      { key: "email", label: "E-mail", required: true, validate: "email", placeholder: "jmeno@email.cz" },
      { key: "adresa_trvala", label: "Trvalá adresa (ulice a č.p., město, PSČ)", required: true, full: true },
      { key: "adresa_korespondencni", label: "Korespondenční adresa (pokud se liší)", full: true },
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
    hint: `Doklad totožnosti, výpisy, stávající smlouvy. Max ${MAX_FILE_MB} MB na soubor.`,
    type: "dokumenty",
  },
];

let step = 0;
let data = {
  bilance: { prijmy: [], vydaje: [], zavazky: [] },
  smlouvy: [],
  dokumenty: [],
};
let record = null;

// ---------------------------------------------------------------------------
// Validace
// ---------------------------------------------------------------------------
const VALIDATORS = {
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? "" : "Neplatný e-mail.",
  tel(v) {
    const digits = v.replace(/[\s\-()]/g, "");
    return /^(\+\d{1,3})?\d{9}$/.test(digits) ? "" : "Telefon: 9 číslic, volitelně s předvolbou (+420).";
  },
};

// ---------------------------------------------------------------------------
// Draft — rozpracované uložení a návrat
// ---------------------------------------------------------------------------
function saveDraft() {
  try {
    // dokumenty (base64) do draftu nepatří — localStorage má malý limit
    const { dokumenty, ...rest } = data;
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ step, data: rest, saved_at: new Date().toISOString() }));
  } catch { /* plný storage — draft je jen pohodlí */ }
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return false;
    const draft = JSON.parse(raw);
    data = { ...data, ...draft.data, dokumenty: [] };
    step = Math.min(draft.step ?? 0, STEPS.length - 1);
    return true;
  } catch { return false; }
}

function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* noop */ }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
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
      <h4>${g.label}</h4>
      ${rows}
      <button type="button" class="onb-add-btn" data-add-item="${g.key}">+ Přidat položku</button>
    </div>`;
}

function smlouvyHtml() {
  const items = data.smlouvy.length ? data.smlouvy : [{ typ: "", instituce: "", platba: "", poznamka: "" }];
  const rows = items.map((s, i) => `
    <div class="onb-smlouva" data-idx="${i}">
      <div class="onb-grid">
        <div class="onb-field"><label>Typ produktu</label><input class="sm-typ" value="${esc(s.typ)}" placeholder="např. životní pojištění"></div>
        <div class="onb-field"><label>Instituce</label><input class="sm-instituce" value="${esc(s.instituce)}" placeholder="např. Kooperativa"></div>
        <div class="onb-field"><label>Měsíční platba (Kč)</label><input class="sm-platba" value="${esc(s.platba)}" inputmode="numeric"></div>
        <div class="onb-field"><label>Poznámka</label><input class="sm-poznamka" value="${esc(s.poznamka)}"></div>
      </div>
      <button type="button" class="item-del sm-del" title="Odebrat smlouvu">× Odebrat</button>
    </div>`).join("");
  return `${rows}<button type="button" class="onb-add-btn" id="add-smlouva">+ Přidat další smlouvu</button>`;
}

function dokumentyHtml() {
  const list = data.dokumenty.map((d, i) => `
    <div class="onb-doc-row" data-idx="${i}">
      <span>📄 ${esc(d.nazev)} <span class="doc-size">(${(d.velikost / 1024).toFixed(0)} kB)</span></span>
      <button type="button" class="item-del doc-del">×</button>
    </div>`).join("");
  return `
    <div class="onb-field full">
      <label>Nahrát soubory (doklad totožnosti, výpisy, smlouvy)</label>
      <input type="file" id="doc-input" multiple accept=".pdf,.jpg,.jpeg,.png,.heic">
      <div class="err" id="doc-err"></div>
    </div>
    <div id="doc-list">${list}</div>`;
}

function renderStep() {
  const s = STEPS[step];
  let body;
  if (s.type === "bilance") body = s.groups.map(bilanceGroupHtml).join("");
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
  $("#btn-next").textContent = step === STEPS.length - 1 ? "Odeslat" : "Pokračovat →";

  bindStepEvents(s);
}

function bindStepEvents(s) {
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
  }
  if (s.type === "smlouvy") {
    $("#add-smlouva")?.addEventListener("click", () => {
      collectStep();
      data.smlouvy.push({ typ: "", instituce: "", platba: "", poznamka: "" });
      renderStep();
    });
    document.querySelectorAll(".sm-del").forEach((btn) => btn.addEventListener("click", () => {
      collectStep();
      data.smlouvy.splice(Number(btn.closest(".onb-smlouva").dataset.idx), 1);
      renderStep();
    }));
  }
  if (s.type === "dokumenty") {
    $("#doc-input").addEventListener("change", async (e) => {
      $("#doc-err").textContent = "";
      for (const file of e.target.files) {
        if (file.size > MAX_FILE_MB * 1024 * 1024) {
          $("#doc-err").textContent = `${file.name}: soubor je větší než ${MAX_FILE_MB} MB.`;
          continue;
        }
        const b64 = await new Promise((res) => {
          const r = new FileReader();
          r.onload = () => res(r.result);
          r.readAsDataURL(file);
        });
        data.dokumenty.push({ nazev: file.name, typ: file.type, velikost: file.size, data: b64 });
      }
      e.target.value = "";
      renderStep();
    });
    document.querySelectorAll(".doc-del").forEach((btn) => btn.addEventListener("click", () => {
      data.dokumenty.splice(Number(btn.closest(".onb-doc-row").dataset.idx), 1);
      renderStep();
    }));
  }
}

// ---------------------------------------------------------------------------
// Sběr + validace kroku
// ---------------------------------------------------------------------------
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
        platba: el.querySelector(".sm-platba").value.trim(),
        poznamka: el.querySelector(".sm-poznamka").value.trim(),
      }))
      .filter((sm) => sm.typ || sm.instituce || sm.platba);
    return true;
  }
  if (s.type === "dokumenty") return true;

  for (const f of s.fields) {
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
      err.textContent = "Povinné pole.";
      ok = false;
      continue;
    }
    if (value && f.validate) {
      const msg = VALIDATORS[f.validate](value);
      if (msg) { err.textContent = msg; ok = false; }
    }
  }
  return ok;
}

// ---------------------------------------------------------------------------
// Výstup — záznam pro import do dashboardu
// ---------------------------------------------------------------------------
function buildRecord() {
  return {
    klient_id: KLIENT_ID, // z odkazu od poradce; párování v dashboardu
    onboarding_submitted_at: new Date().toISOString(),
    onboarding: {
      telefon: data.telefon || "",
      email: data.email || "",
      adresa_trvala: data.adresa_trvala || "",
      adresa_korespondencni: data.adresa_korespondencni || "",
      rodinny_stav: data.rodinny_stav || "",
      povolani: data.povolani || "",
      zdroj_prijmu: data.zdroj_prijmu || "",
      bilance: data.bilance,
      smlouvy: data.smlouvy,
      dokumenty: data.dokumenty,
    },
  };
}

function finish() {
  record = buildRecord();
  clearDraft();
  $("#onb-form").hidden = true;
  $("#progress").hidden = true;
  $("#progress-label").hidden = true;
  $("#done").hidden = false;
  // Uložení přímo do systému — jen když je v prohlížeči token (testování týmem).
  // Klient token nemá → stáhne soubor a pošle poradci.
  if (Storage.hasToken()) $("#btn-save-storage").hidden = false;
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
    } else {
      const oblasti = {};
      for (const p of CONFIG.productFields) oblasti[p.key] = { stav: "", faze: "", faze_historie: [], poznamka: "" };
      client = {
        id: KLIENT_ID || `onb${Date.now()}`,
        vytvoreno: new Date().toISOString(),
        jmeno: "", prijmeni: "(z onboardingu — doplnit jméno)",
        firma: "", stav: "Nový klient", obchodnik: "", dohoda: "",
        datum: new Date().toISOString().slice(0, 10),
        lead_agent: "", oblacek: "", bilance: "", sdileni: "",
        poznamka_nzp: "", poznamky_lenka: "",
        oblasti,
        onboarding: record.onboarding,
        onboarding_submitted_at: record.onboarding_submitted_at,
        poradce: {}, komentare: [], schuzky: [], ida_url: "", cile: [],
      };
    }
    await Storage.saveClient(client, "onboarding");
    out.textContent = "Uloženo do systému ✓ — poradce údaje uvidí v přehledu klientů.";
  } catch (err) {
    out.textContent = err.message;
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  const resumed = loadDraft();
  if (resumed) $("#draft-note").hidden = false;
  renderStep();

  $("#btn-next").addEventListener("click", () => {
    if (!collectStep()) return;
    saveDraft();
    if (step === STEPS.length - 1) { finish(); return; }
    step += 1;
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
