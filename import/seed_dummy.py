#!/usr/bin/env python3
"""Vygeneruje testovací klienty (dummy data) ve schématu v2 do data/clients/.

Opakovaně spustitelný — přepíše existující dummy soubory.
Žádná ostrá data: všechna jména, čísla i adresy jsou smyšlené.
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CLIENTS_DIR = ROOT / "data" / "clients"

OBLASTI = ["zivot", "investice", "nezivot", "uver", "uver_bydleni"]
FAZE_VYCHOZI = "Nová"


def oblast(stav="", faze="", poznamka=""):
    return {
        "stav": stav,
        "faze": faze or (FAZE_VYCHOZI if stav else ""),
        "faze_historie": (
            [{"faze": faze or FAZE_VYCHOZI, "kdy": "2026-09-10T10:00:00", "kdo": "petr"}]
            if stav else []
        ),
        "poznamka": poznamka,
    }


def klient(id, jmeno, prijmeni, **kw):
    zaklad = {
        "id": id,
        "vytvoreno": "2026-09-10T09:00:00",
        "upraveno": datetime.now().isoformat(timespec="seconds"),
        "upravil": "seed",
        "jmeno": jmeno,
        "prijmeni": prijmeni,
        "firma": "",
        "stav": "Nový klient",
        "obchodnik": "Petr Martínek",
        "dohoda": "",
        "datum": "",
        "lead_agent": "",
        "oblacek": "",
        "bilance": "",
        "sdileni": "",
        "poznamka_nzp": "",
        "poznamky_lenka": "",
        "oblasti": {o: oblast() for o in OBLASTI},
        "onboarding": None,
        "poradce": {},
        "komentare": [],
        "schuzky": [],
        "ida_url": "",
        "cile": [],
    }
    zaklad.update(kw)
    return zaklad


KLIENTI = [
    klient(
        "t0001", "Adam", "Testovací",
        stav="Aktivní klient", dohoda="Podepsána", datum="2026-09-01",
        oblacek="Nahráno u partnera", bilance="Ano", sdileni="Sdíleno",
        oblasti={
            "zivot": oblast("Rozpracováno", "Čekáme na dokumenty", "Nabídka Pojišťovny Vzor odeslána"),
            "investice": oblast("Budeme řešit"),
            "nezivot": oblast("Audit"),
            "uver": oblast(),
            "uver_bydleni": oblast("Rozpracováno", "Čekáme na akceptaci"),
        },
        poradce={"datum_narozeni": "1906-06-19", "osloveni": "Vykání", "segmentace": "A",
                 "statni_prislusnost": "Česká republika"},
        onboarding={
            "telefon": "+420 777 000 001", "email": "adam.testovaci@example.com",
            "adresa_trvala": "Zkušební 1906, Praha, 110 00", "adresa_korespondencni": "",
            "rodinny_stav": "Ženatý / vdaná", "povolani": "Jednatel", "zdroj_prijmu": "OSVČ",
            "bilance": {
                "prijmy": [{"popis": "Podnikání", "castka": "95000"}],
                "vydaje": [{"popis": "Provoz domácnosti", "castka": "40000"}],
                "zavazky": [{"popis": "Hypotéka", "castka": "22000"}],
            },
            "smlouvy": [{"typ": "Životní pojištění", "instituce": "Pojišťovna Vzor",
                         "platba": "1500", "poznamka": "ukázková smlouva"}],
            "dokumenty": [],
        },
        komentare=[{"text": "Volám 3×, nebere — zkusit po 17. hodině.",
                    "autor": "lenka", "kdy": "2026-09-11T14:30:00"}],
        schuzky=[{"datum": "2026-09-11", "typ": "Úvodní schůzka",
                  "souhrn": "Probrána bilance, cíl: renta od 60 let. Klient dodá výpisy.",
                  "odkaz": ""}],
        ida_url="https://example.com/ida/t0001",
        cile=[{"cil": "Renta", "castka": "8 000 000", "termin": "2046"},
              {"cil": "Rekonstrukce chaty", "castka": "1 200 000", "termin": "2029"}],
    ),
    klient(
        "t0002", "Alena", "Zkušební",
        stav="Nový klient",
        oblasti={
            "zivot": oblast("Budeme řešit"),
            "investice": oblast("Rozpracováno", "Čekáme na platbu"),
            "nezivot": oblast(), "uver": oblast(), "uver_bydleni": oblast(),
        },
    ),
    klient(
        "t0003", "Karel", "Vzorek",
        stav="Aktivní klient", obchodnik="Lenka Testová",
        oblasti={
            "zivot": oblast("Hotovo", "Předáno"),
            "investice": oblast(), "nezivot": oblast("Nebudeme řešit"),
            "uver": oblast("Rozpracováno", "Čekáme na dokumenty"), "uver_bydleni": oblast(),
        },
        komentare=[{"text": "Dokumenty slíbil do pátku.", "autor": "petr", "kdy": "2026-09-09T09:15:00"}],
    ),
    klient("t0004", "Marie", "Fiktivní", stav="Nový klient"),
    klient(
        "t0005", "Josef", "Ukázkový",
        stav="Pozastaveno", obchodnik="Lenka Testová",
        oblasti={
            "zivot": oblast("Pozdějí"), "investice": oblast("Pozdějí"),
            "nezivot": oblast(), "uver": oblast(), "uver_bydleni": oblast(),
        },
    ),
]


def index_entry(c):
    return {
        "id": c["id"], "jmeno": c["jmeno"], "prijmeni": c["prijmeni"], "firma": c["firma"],
        "stav": c["stav"], "obchodnik": c["obchodnik"],
        "oblasti": {k: {"stav": v["stav"], "faze": v["faze"]} for k, v in c["oblasti"].items()},
        "upraveno": c["upraveno"],
    }


def push_to_repo():
    """Nahraje data do datového repa přes GitHub API.

    Token se čte VÝHRADNĚ z proměnné prostředí GITHUB_TOKEN — nikdy ho
    nezapisovat do souborů projektu.
    """
    import base64
    import os
    import urllib.request

    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        raise SystemExit("Chybí GITHUB_TOKEN. Spusť: GITHUB_TOKEN=... python3 import/seed_dummy.py --push")

    repo = "janmetlicky-prog/40flow-martinek"
    soubory = sorted(CLIENTS_DIR.glob("*.json")) + [ROOT / "data" / "index.json"]
    for f in soubory:
        cesta = f"data/{f.relative_to(ROOT / 'data')}"
        url = f"https://api.github.com/repos/{repo}/contents/{cesta}"
        hdrs = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}
        # existující SHA (pro přepis)
        sha = None
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=hdrs)) as r:
                sha = json.load(r).get("sha")
        except Exception:
            pass
        payload = {
            "message": f"Seed testovacích dat — {cesta}",
            "content": base64.b64encode(f.read_bytes()).decode(),
        }
        if sha:
            payload["sha"] = sha
        req = urllib.request.Request(url, method="PUT", headers=hdrs,
                                     data=json.dumps(payload).encode())
        with urllib.request.urlopen(req) as r:
            r.read()
        print(f"  push: {cesta}")


def main():
    import sys
    CLIENTS_DIR.mkdir(parents=True, exist_ok=True)
    for c in KLIENTI:
        (CLIENTS_DIR / f"{c['id']}.json").write_text(
            json.dumps(c, ensure_ascii=False, indent=2), encoding="utf-8")
    # index se generuje VŽDY spolu s klienty ze stejných dat — nemůže se rozjet
    index = {"klienti": [index_entry(c) for c in KLIENTI]}
    (ROOT / "data" / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Vygenerováno {len(KLIENTI)} testovacích klientů → data/clients/ + data/index.json")

    # Demo sada pro testovací režim aplikace — jeden soubor, leží v repu
    # aplikace (data jsou smyšlená, mohou být veřejná).
    demo_dir = ROOT / "demo"
    demo_dir.mkdir(exist_ok=True)
    (demo_dir / "klienti.json").write_text(
        json.dumps({"klienti": KLIENTI}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Demo sada → demo/klienti.json")

    if "--push" in sys.argv:
        push_to_repo()


if __name__ == "__main__":
    main()
