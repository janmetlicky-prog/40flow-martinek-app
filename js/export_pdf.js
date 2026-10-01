/* Karta klienta jako PDF — generuje se v prohlížeči přes tisk (Uložit jako PDF).
 *
 * Proč tisk a ne knihovna: tisk prohlížeče používá systémové fonty, takže
 * čeština (ř, ů, ě…) funguje bez vkládání fontů; knihovny typu jsPDF
 * diakritiku bez vlastního fontu rozbíjejí.
 *
 * Obsah: základní údaje, kontakt, bilance, oblasti s položkami a fázemi,
 * dokumenty se stavy, cíle. BEZ komentářů a interních poznámek.
 */
"use strict";

function pdfEsc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

/** Vrátí kompletní HTML dokument karty pro tisk. Čisté funkce — jde otestovat bez prohlížeče. */
function sestavKartuProTisk(c, cfg) {
  const e = pdfEsc;
  const onb = c.onboarding || {};
  const adresa = (a) => !a ? "" : typeof a === "string" ? a : [[a.ulice, a.cislo].filter(Boolean).join(" "), a.mesto, a.psc].filter(Boolean).join(", ");
  const kc = (v) => { const n = Number(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
  const fmtKc = (n) => `${n < 0 ? "−" : ""}${Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} Kč`;
  const dnes = new Date().toLocaleDateString("cs-CZ");

  const radek = (l, v) => v ? `<tr><th>${e(l)}</th><td>${e(v)}</td></tr>` : "";
  const zakladni = [
    radek("Jméno", `${c.jmeno || ""} ${c.prijmeni || ""}`.trim()), radek("Firma", c.firma),
    radek("Stav vztahu", c.stav), radek("Obchodník", c.obchodnik),
    radek("Partner / partnerka", onb.partner), radek("Děti", onb.deti_pocet ? `${onb.deti_pocet}${onb.deti_veky ? ` (věk ${onb.deti_veky})` : ""}` : ""),
    radek("Povolání", onb.povolani), radek("Zaměstnavatel", onb.zamestnavatel), radek("Rodinný stav", onb.rodinny_stav),
  ].join("");
  const kontakt = [
    radek("Telefon", onb.telefon), radek("E-mail", onb.email),
    radek("Trvalá adresa", adresa(onb.adresa_trvala)),
    radek("Korespondenční adresa", onb.adresa_korespondencni_shodna !== false && !onb.adresa_korespondencni ? (onb.adresa_trvala ? "shodná s trvalou" : "") : adresa(onb.adresa_korespondencni)),
  ].join("");

  const b = onb.bilance || {};
  const skup = (klic, nazev) => (b[klic] || []).map((it) => `<tr><th>${e(nazev)}</th><td>${e(it.popis)}</td><td class="num">${fmtKc(kc(it.castka))}</td></tr>`).join("");
  const sum = (klic) => (b[klic] || []).reduce((a, it) => a + kc(it.castka), 0);
  const bilanceRadky = skup("prijmy", "Příjem") + skup("vydaje", "Výdaj") + skup("zavazky", "Závazek");
  const rozdil = sum("prijmy") - sum("vydaje") - sum("zavazky");
  const bilance = bilanceRadky
    ? `<table class="tab">${bilanceRadky}<tr class="sum"><th colspan="2">Měsíční rozdíl</th><td class="num ${rozdil < 0 ? "zap" : ""}">${fmtKc(rozdil)}</td></tr></table>`
    : `<p class="pozn">Bilance zatím nevyplněna.</p>`;

  const nazvy = Object.fromEntries([...(cfg.productFields || []), ...(cfg.extraOblasti || [])].map((p) => [p.key, p.label]));
  const oblasti = Object.entries(c.oblasti || {}).filter(([, o]) => o && (o.stav || o.faze || (o.polozky || []).length)).map(([k, o]) => `
    <div class="oblast">
      <div class="oblast-h"><strong>${e(nazvy[k] || k)}</strong>${o.stav ? ` <span class="pill">${e(o.stav)}</span>` : ""}${o.faze ? ` <span class="pill faze">Fáze: ${e(o.faze)}</span>` : ""}</div>
      ${(o.polozky || []).length ? `<table class="tab"><tr><th>Typ</th><th>Instituce</th><th class="num">Měs. platba</th><th>Poznámka</th></tr>
        ${o.polozky.map((p) => `<tr><td>${e(p.typ)}</td><td>${e(p.instituce)}</td><td class="num">${p.mesicni_platba ? fmtKc(kc(p.mesicni_platba)) : ""}</td><td>${e(p.poznamka)}</td></tr>`).join("")}</table>` : ""}
    </div>`).join("") || `<p class="pozn">Žádná oblast zatím není rozpracovaná.</p>`;

  const stavy = (cfg.dokumentyStavy || {});
  const dokumenty = (c.dokumenty || []).filter((d) => !d.smazano).map((d) =>
    `<tr><td>${e(d.nazev)}</td><td>${e(stavy[d.stav] || d.stav)}</td><td>${d.storage_path ? "soubor nahrán" : ""}</td></tr>`).join("");
  const cile = (c.cile || []).map((g) => `<tr><td>${e(g.cil)}</td><td class="num">${e(g.castka)}</td><td>${e(g.termin)}</td><td>${e(g.stav || "aktivní")}</td></tr>`).join("");

  return `<!doctype html><html lang="cs"><head><meta charset="utf-8">
<title>Karta klienta — ${e(`${c.jmeno || ""} ${c.prijmeni || ""}`.trim())}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  body { font-family: "Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif; color: #111; font-size: 11pt; line-height: 1.4; margin: 0; }
  .hl { display: flex; align-items: center; gap: 10px; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 14px; }
  .mark { width: 28px; height: 28px; border-radius: 50%; background: #F5C518; display: inline-flex; align-items: center; justify-content: center; font-weight: 800; }
  h1 { font-size: 18pt; margin: 0; } .meta { color: #666; font-size: 9pt; margin-left: auto; text-align: right; }
  h2 { font-size: 10pt; text-transform: uppercase; letter-spacing: 0.08em; color: #555; border-bottom: 1px solid #ddd; margin: 16px 0 6px; padding-bottom: 3px; break-after: avoid; }
  .tab { width: 100%; border-collapse: collapse; margin-bottom: 6px; } .tab th, .tab td { text-align: left; padding: 3px 6px; border-bottom: 1px solid #eee; vertical-align: top; }
  .tab th { width: 34%; color: #555; font-weight: 600; } .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .sum th, .sum td { border-top: 2px solid #111; font-weight: 700; } .zap { color: #b02020; }
  .oblast { margin: 6px 0 10px; break-inside: avoid; } .oblast-h { margin-bottom: 4px; }
  .pill { display: inline-block; border: 1px solid #bbb; border-radius: 10px; padding: 0 7px; font-size: 9pt; margin-left: 4px; } .pill.faze { background: #f4f4f4; }
  .pozn { color: #777; font-style: italic; } .pata { margin-top: 20px; color: #888; font-size: 8.5pt; border-top: 1px solid #ddd; padding-top: 6px; }
</style></head><body>
  <div class="hl"><span class="mark">B</span><h1>${e(`${c.jmeno || ""} ${c.prijmeni || ""}`.trim() || "Klient")}</h1><div class="meta">Bohatněte s rozumem<br>Karta klienta · ${dnes}</div></div>
  <h2>Základní údaje</h2><table class="tab">${zakladni}</table>
  <h2>Kontakt</h2>${kontakt ? `<table class="tab">${kontakt}</table>` : `<p class="pozn">Kontakt zatím nevyplněn.</p>`}
  <h2>Finanční bilance (měsíčně)</h2>${bilance}
  <h2>Produktové oblasti</h2>${oblasti}
  <h2>Dokumenty</h2>${dokumenty ? `<table class="tab"><tr><th>Dokument</th><th>Stav</th><th></th></tr>${dokumenty}</table>` : `<p class="pozn">Žádné dokumenty.</p>`}
  <h2>Cíle</h2>${cile ? `<table class="tab"><tr><th>Cíl</th><th class="num">Částka</th><th>Termín</th><th>Stav</th></tr>${cile}</table>` : `<p class="pozn">Žádné cíle.</p>`}
  <div class="pata">Výpis z interního systému. Neobsahuje komentáře ani interní poznámky týmu. Vygenerováno ${dnes}.</div>
</body></html>`;
}

/** Otevře tiskový pohled v novém okně a spustí tisk (uživatel zvolí ‚Uložit jako PDF‘). */
function stahniKartuJakoPdf(c, cfg) {
  const html = sestavKartuProTisk(c, cfg);
  const w = window.open("", "_blank");
  if (!w) { alert("Prohlížeč zablokoval nové okno. Povolte vyskakovací okna pro tuto stránku."); return; }
  w.document.open(); w.document.write(html); w.document.close();
  w.addEventListener("load", () => { w.focus(); w.print(); });
  setTimeout(() => { try { w.focus(); w.print(); } catch { /* již vytištěno */ } }, 600);
}
