#!/usr/bin/env python3
"""Nahraje ukázkové klienty do Supabase (cílové schéma).

Spuštění:  python3 import/seed_supabase.py
Potřebuje v .env: SUPABASE_ACCESS_TOKEN (Management API).

Opakovaně spustitelný — save_klient přepíše existující záznam.
Převádí tvar z GitHub prototypu na cílové schéma:
  - Excelový `stav` → `stav_vztahu`; `stav` se nastaví na retenční 'aktivni'
  - Excelová pracovní pole → `poradce` jsonb
  - `lead_agent` (v Excelu ANO/NE, ne osoba) → poradce.lead_agent_puvodni
  - `oblasti` ze slovníku na pole záznamů s klíčem `klic`
  - jména obchodníků a autorů komentářů → FK na řádky v `uzivatele`
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REF = "ftovpafugbvahadtpmxb"

# Stabilní uuid pro seed uživatele — opakovaný běh nevytvoří duplicity.
NS = uuid.UUID("40f10000-0000-4000-8000-000000000000")

# Jména z ukázkových dat → řádky v `uzivatele`. Účty jsou neaktivní a bez
# přihlášení; pozvánka jim doplní auth id a nastaví aktivni = true.
UZIVATELE = {
    "Petr Martínek": {"email": "petr.martinek@siriusfinance.cz", "role": "admin"},
    "Lenka Testová": {"email": "lenka.testova@example.com", "role": "poradce"},
}
# Zkratky používané v ukázkových datech u komentářů
PREZDIVKY = {"petr": "Petr Martínek", "lenka": "Lenka Testová"}

EXCEL_POLE = ["dohoda", "datum", "oblacek", "bilance", "sdileni",
              "poznamka_nzp", "poznamky_lenka", "firma_poznamka"]


def uid(jmeno: str) -> str:
    return str(uuid.uuid5(NS, jmeno))


def sql(query: str, token: str):
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{REF}/database/query",
        method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        data=json.dumps({"query": query}).encode(),
    )
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read() or b"[]")
    except urllib.error.HTTPError as e:
        raise SystemExit(f"SQL selhalo: {e.read().decode()[:400]}")


def prevod(c: dict) -> dict:
    """Z tvaru GitHub prototypu do vstupu pro save_klient()."""
    poradce = dict(c.get("poradce") or {})
    for k in EXCEL_POLE:
        if c.get(k):
            poradce[k] = c[k]
    # V Excelu je Lead Agent příznak ANO/NE, ne osoba — hodnotu jen uchováme.
    if c.get("lead_agent"):
        poradce["lead_agent_puvodni"] = c["lead_agent"]

    oblasti = []
    for klic, o in (c.get("oblasti") or {}).items():
        oblasti.append({
            "klic": klic,
            "stav": o.get("stav", ""),
            "faze": o.get("faze", ""),
            "poznamka": o.get("poznamka", ""),
            "polozky": o.get("polozky", []),
            "faze_historie": o.get("faze_historie", []),
        })

    komentare = []
    for k in c.get("komentare") or []:
        jmeno = PREZDIVKY.get(str(k.get("autor", "")).lower())
        komentare.append({
            "text": k.get("text", ""),
            "autor_id": uid(jmeno) if jmeno else None,
            "kdy": k.get("kdy"),
        })

    schuzky = []
    for s in c.get("schuzky") or []:
        jmeno = PREZDIVKY.get(str(s.get("kdo", "")).lower()) or c.get("obchodnik")
        schuzky.append({
            "id": s.get("id") or str(uuid.uuid4()),
            "datum": s.get("datum"), "typ": s.get("typ", ""),
            "kdo": uid(jmeno) if jmeno in UZIVATELE else None,
            "souhrn": s.get("souhrn", ""), "odkaz": s.get("odkaz", ""),
            "zdroj": s.get("zdroj", "rucni"), "plaud_file_id": s.get("plaud_file_id", ""),
        })

    obchodnik = c.get("obchodnik")
    return {
        "id": c["id"],
        "jmeno": c.get("jmeno", ""), "prijmeni": c.get("prijmeni", ""),
        "firma": c.get("firma", ""),
        "stav": "aktivni",                       # retence — ukázkoví klienti jsou aktivní
        "stav_vztahu": c.get("stav", ""),        # pracovní stav z Excelu
        "obchodnik_id": uid(obchodnik) if obchodnik in UZIVATELE else None,
        "lead_agent": None,                      # viz poznámka výše
        "ida_url": c.get("ida_url", ""),
        "onboarding": c.get("onboarding") or {},
        "poradce": poradce,
        "oblasti": oblasti, "komentare": komentare, "schuzky": schuzky,
        "cile": c.get("cile") or [],
        "upravil": "seed",
        "upraveno": None,                        # nový záznam → bez kontroly zámku
    }


def main() -> None:
    env = dict(l.strip().split("=", 1) for l in open(ROOT / ".env") if "=" in l)
    token = env.get("SUPABASE_ACCESS_TOKEN")
    if not token:
        sys.exit("Chybí SUPABASE_ACCESS_TOKEN v .env")

    # 1) uživatelé pro FK (neaktivní, bez auth účtu)
    radky = ", ".join(
        f"('{uid(j)}'::uuid, {esc(j)}, {esc(v['email'])}, {esc(v['role'])}, false)"
        for j, v in UZIVATELE.items()
    )
    sql(f"""insert into uzivatele (id, jmeno, email, role, aktivni)
            values {radky}
            on conflict (email) do update set jmeno = excluded.jmeno;""", token)
    print(f"✓ uživatelé pro FK: {', '.join(UZIVATELE)}")

    # 2) klienti přes save_klient (stejná cesta, jakou používá aplikace)
    demo = json.loads((ROOT / "demo" / "klienti.json").read_text())
    for c in demo["klienti"]:
        payload = json.dumps(prevod(c), ensure_ascii=False)
        sql(f"select save_klient({esc(payload)}::jsonb);", token)
        print(f"✓ klient {c['id']} — {c['jmeno']} {c['prijmeni']}")

    pocet = sql("select count(*) c from klienti;", token)[0]["c"]
    print(f"\nHotovo: {pocet} klientů v databázi.")


def esc(s: str) -> str:
    """Bezpečné vložení textu do SQL literálu."""
    return "'" + str(s).replace("'", "''") + "'"


if __name__ == "__main__":
    main()
