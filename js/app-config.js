/* Načtení config/app.json + varovný pruh testovacího prostředí.
 *
 * Pruh je v HTML viditelný od začátku a JS ho teprve SKRÝVÁ, pokud je
 * testovaci_rezim vypnutý. Když se config nenačte nebo selže JS, varování
 * zůstane — chyba tak nikdy nevede k tomu, že by pruh zmizel omylem.
 */
"use strict";

let APP = { storage: "github", testovaci_rezim: true, supabase: { url: "", anon_key: "" } };

async function nactiAppConfig() {
  try {
    const r = await fetch("config/app.json", { cache: "no-store" });
    if (r.ok) APP = { ...APP, ...(await r.json()) };
  } catch {
    // ponechá se výchozí nastavení (testovací režim zapnutý)
  }
  const pruh = document.querySelector("#test-banner");
  if (pruh && APP.testovaci_rezim === false) pruh.hidden = true;
  return APP;
}

document.addEventListener("DOMContentLoaded", nactiAppConfig);
