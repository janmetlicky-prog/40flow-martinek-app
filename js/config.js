/**
 * Konfigurace dashboardu.
 *
 * PŘIHLÁŠENÍ (v1 — základní řešení):
 * Hesla jsou uložena jako SHA-256 hash. Nový hash vygeneruješ v konzoli prohlížeče:
 *   crypto.subtle.digest("SHA-256", new TextEncoder().encode("mojeheslo"))
 *     .then(b => console.log([...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("")))
 *
 * Výchozí hesla (ZMĚNIT před nasazením!):
 *   admin / martinek2026
 *   tym   / tym2026
 *
 * POZOR: klientská autentizace na statickém hostingu není plnohodnotné zabezpečení —
 * chrání proti náhodnému přístupu, ne proti útočníkovi. Repo proto musí zůstat privátní
 * a plné řešení rolí přijde v další fázi.
 */
const CONFIG = {
  users: {
    petr: {
      role: "admin",
      label: "Petr (admin)",
      passwordHash: "8556217b435ca748d6364f49f3c65dba6b2388ec1113d8c757fa8d2cd1f00d2d", // martinek2026
    },
    tym: {
      role: "user",
      label: "Tým",
      passwordHash: "1516317ecf8738d251ef94c3290c7b48a661775a0c63b8b37216c7ff220ff0ec", // tym2026
    },
  },

  // Datové úložiště — privátní repo, čte/zapisuje výhradně js/storage.js.
  // Token (PAT s právem repo/contents:write) se zadává v aplikaci
  // a ukládá jen do localStorage prohlížeče, nikdy do kódu.
  github: {
    owner: "janmetlicky-prog",
    repo: "40flow-martinek",
    branch: "main",
  },

  productFields: [
    { key: "zivot", label: "Život" },
    { key: "investice", label: "Investice" },
    { key: "nezivot", label: "Neživot" },
    { key: "uver", label: "Úvěr" },
    { key: "uver_bydleni", label: "Úvěr na bydlení" },
  ],

  productStates: [
    "Budeme řešit", "Audit", "Nebudeme řešit", "Pozdějí",
    "Rozpracováno", "Předáno", "Hotovo",
  ],

  // Údaje doplňované poradcem v kartě klienta (klient je NIKDY nevyplňuje).
  // Ukládají se do client.poradce.
  advisorFields: [
    { key: "nazev_rodiny", label: "Název rodiny" },
    { key: "typ_klienta", label: "Typ klienta", type: "select",
      options: ["Fyzická osoba", "Fyzická osoba podnikatel", "Právnická osoba"] },
    { key: "rodne_cislo", label: "Rodné číslo" },
    { key: "pohlavi", label: "Pohlaví", type: "select", options: ["Muž", "Žena"] },
    { key: "datum_narozeni", label: "Datum narození", type: "date" },
    { key: "misto_narozeni", label: "Místo narození" },
    { key: "statni_prislusnost", label: "Státní příslušnost", placeholder: "Česká republika" },
    { key: "typ_dokladu", label: "Typ dokladu", type: "select",
      options: ["Občanský průkaz", "Pas", "Průkaz rezidenta", "Nemá doklad"] },
    { key: "cislo_dokladu", label: "Číslo dokladu" },
    { key: "doklad_vydal", label: "Vydal" },
    { key: "doklad_platnost_od", label: "Platnost od", type: "date" },
    { key: "doklad_platnost_do", label: "Platnost do", type: "date" },
    { key: "bankovni_ucet", label: "Číslo bankovního účtu" },
    { key: "segmentace", label: "Segmentace", type: "select", options: ["A", "B", "C", "N"] },
    { key: "danovy_rezident_usa", label: "Daňový rezident USA", type: "select", options: ["Ne", "Ano"] },
    { key: "osloveni", label: "Oslovení", type: "select", options: ["Vykání", "Tykání"] },
  ],

  // Režim „Kopírovat do 4fin" — pole PŘESNĚ v pořadí formuláře CRM 4fin.
  // source: base = základní karta, onboarding = klientský formulář, poradce = doplněno poradcem
  copy4finFields: [
    { key: "nazev_rodiny", label: "Název rodiny", source: "poradce" },
    { key: "typ_klienta", label: "Typ klienta", source: "poradce" },
    { key: "jmeno", label: "Jméno", source: "base" },
    { key: "prijmeni", label: "Příjmení", source: "base" },
    { key: "rodne_cislo", label: "Rodné číslo", source: "poradce" },
    { key: "pohlavi", label: "Pohlaví", source: "poradce" },
    { key: "datum_narozeni", label: "Datum narození", source: "poradce" },
    { key: "misto_narozeni", label: "Místo narození", source: "poradce" },
    { key: "statni_prislusnost", label: "Státní příslušnost", source: "poradce" },
    { key: "rodinny_stav", label: "Rodinný stav", source: "onboarding" },
    { key: "typ_dokladu", label: "Typ dokladu", source: "poradce" },
    { key: "cislo_dokladu", label: "Číslo dokladu", source: "poradce" },
    { key: "doklad_vydal", label: "Vydal", source: "poradce" },
    { key: "doklad_platnost_od", label: "Platnost od", source: "poradce" },
    { key: "doklad_platnost_do", label: "Platnost do", source: "poradce" },
    { key: "adresa_trvala", label: "Trvalá adresa", source: "onboarding" },
    { key: "adresa_korespondencni", label: "Korespondenční adresa", source: "onboarding" },
    { key: "telefon", label: "Telefon", source: "onboarding" },
    { key: "email", label: "E-mail", source: "onboarding" },
    { key: "povolani", label: "Povolání", source: "onboarding" },
    { key: "zdroj_prijmu", label: "Zdroj příjmů", source: "onboarding" },
    { key: "bankovni_ucet", label: "Číslo bankovního účtu", source: "poradce" },
    { key: "danovy_rezident_usa", label: "Daňový rezident USA", source: "poradce" },
    { key: "osloveni", label: "Oslovení", source: "poradce" },
    { key: "segmentace", label: "Segmentace", source: "poradce" },
  ],

  stateColors: {
    "Budeme řešit": "var(--state-budeme)",
    "Audit": "var(--state-audit)",
    "Nebudeme řešit": "var(--state-nebudeme)",
    "Pozdějí": "var(--state-pozdeji)",
    "Rozpracováno": "var(--state-rozpracovano)",
    "Předáno": "var(--state-predano)",
    "Hotovo": "var(--state-hotovo)",
  },
};
