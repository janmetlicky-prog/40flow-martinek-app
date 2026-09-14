# 40Flow Dashboard — Petr Martínek (Bohatněte s rozumem)

> ## ⚠️ Bezpečnostní upozornění — čtěte před nasazením
>
> Onboarding formulář (`onboarding.html`) sbírá **rodné číslo, číslo dokladu totožnosti a číslo bankovního účtu** — zvláštní kategorie osobních údajů.
>
> **V1 je určena výhradně pro testovací data.** Nasazení s reálnými daty klientů vyžaduje:
> 1. **Autentizační vrstvu na úrovni serveru** — klientská autentizace v JS na statickém hostingu data nechrání; kdokoli s URL se dostane ke zdrojům stránky.
> 2. **Uzavřenou zpracovatelskou smlouvu** (čl. 28 GDPR) s provozovatelem hostingu a všemi zpracovateli.
> 3. Šifrování dat v klidu a přenosová vrstva výhradně HTTPS.
>
> Do splnění těchto podmínek do systému nevkládejte žádné skutečné osobní údaje.

Klientský dashboard nad databází klientů. Nezávislý zdroj pravdy paralelně vedle systému Forffin. Čisté HTML/CSS/JS bez build kroku — hostovatelné přímo z privátního GitHub repa (GitHub Pages).

## Struktura

## Supabase — ruční nastavení v dashboardu (checklist)

Tyhle kroky nejdou udělat z kódu, musí je proklikat člověk s přístupem k účtu. Pořadí odpovídá závislostem.

| # | Kde | Co | Hotovo |
|---|---|---|---|
| 1 | Zakládání projektu | Region **Central EU (Frankfurt)** — po založení už nejde změnit | ☐ |
| 2 | SQL Editor | Spustit `supabase/migrations/001_schema.sql` … `004_rls.sql` **v tomto pořadí** | ☐ |
| 3 | Authentication → Providers | Povolit **Email**, zapnout *Magic Link*, vypnout *Confirm password* | ☐ |
| 4 | Authentication → Providers | Vypnout **Allow new users to sign up** — účty zakládá jen admin pozvánkou | ☐ |
| 5 | Authentication → URL Configuration | *Site URL* = adresa aplikace; do *Redirect URLs* přidat tutéž adresu | ☐ |
| 6 | Storage | Vytvořit bucket **`dokumenty`**, nastavit **Private** (nikdy public) | ☐ |
| 7 | Settings → API | Zkopírovat *Project URL* a *anon public* klíč do `config/app.json` | ☐ |
| 8 | Settings → API | *service_role* klíč **nikam do repa** — jen do `.env` (seed) a do edge funkcí | ☐ |

### Proměnné prostředí a kde se plní

| Proměnná | Kde žije | K čemu |
|---|---|---|
| `supabase.url`, `supabase.anon_key` | `config/app.json` (v repu, veřejné) | Frontend. Anon klíč je veřejný záměrně — data chrání RLS politiky, ne utajení klíče. |
| `SUPABASE_SERVICE_KEY` | `.env` lokálně (v `.gitignore`), Edge Functions → Secrets | Seed skript a edge funkce. Obchází RLS, **nikdy ne do frontendu ani do repa**. |
| `GITHUB_TOKEN` | jen prostředí shellu při seedu | Zápis ukázkových dat do prototypového GitHub úložiště. |

## Mapování polí z Excelu do databáze

Kde skončila která kolonka z původního listu „Klienti", aby se to dalo za tři měsíce dohledat.

| Excel | Kam | Poznámka |
|---|---|---|
| Jméno, Příjmení, Firma | `klienti.jmeno / prijmeni / firma` | |
| Stav | `klienti.stav_vztahu` | Nový klient / Aktivní klient / Pozastaveno. **Není to** `klienti.stav` — ten řídí retenci (`aktivni` / `ukonceny` + `datum_ukonceni`) a s Excelem nesouvisí. |
| Obchodník | `klienti.obchodnik_id` → `uzivatele` | Text z Excelu se při seedu mapuje na řádek uživatele. |
| Lead Agent | `klienti.lead_agent` (uuid) | **Pozor:** v Excelu je to příznak ANO/NE („je klient u Petra v LA?"), ne jméno. Nic se tedy nenamapuje a původní hodnota zůstává v `poradce->>'lead_agent_puvodni'`. Až Petr upřesní význam, sloupec se buď naplní, nebo zruší. |
| Dohoda, Datum, Obláček, Bilance, Sdílení, Poznámka NŽP, Poznámky od Lenky | `klienti.poradce` (jsonb) | Interní pracovní pole, jejichž finální podobu Petr teprve upřesní — jako sloupce by znamenaly migraci při každé změně. |
| Život, Investice, Neživot, Úvěr, Úvěr na bydlení | `oblasti` (řádek na oblast) | `klic` = zivot / investice / nezivot / uver / uver_bydleni; hodnota z Excelu jde do `oblasti.stav`. |

Kontakt (e-mail, telefon) a adresy vyplňuje klient ve vstupním dotazníku → `klienti.onboarding` (jsonb). Sloupce `klienti.email` a `klienti.telefon` jsou z něj **odvozené** — plní je `save_klient` při každém uložení a slouží jen pro hledání a řazení. Z rozhraní se do nich nikdy nezapisuje, takže nemůže vzniknout otázka „který údaj platí".

## Převod na vlastní účet (pro Petra / jeho IT)

Systém je schválně postavený tak, aby ho šlo převzít celý, bez nás.

1. **Databáze.** V Supabase → Settings → General → *Transfer project* převést projekt na účet firmy. Data, uživatelé i nastavení zůstávají. Alternativa při zakládání načisto: založit nový projekt (region Frankfurt) a spustit `supabase/migrations/*.sql` v pořadí — schéma je v repu, nic se neklikalo ručně.
2. **Aplikace.** Je to statické HTML/CSS/JS bez build kroku — nahraje se kamkoli (GitHub Pages, Netlify, vlastní server). Po přesunu upravit v `config/app.json` `supabase.url` a `supabase.anon_key` a v Supabase → Authentication → URL Configuration nastavit novou adresu.
3. **Přístupy.** První admin se zakládá přes edge funkci `pozvat_uzivatele` (potřebuje service klíč). Další uživatele pak přidává admin přímo v aplikaci.
4. **Co se nikam nekopíruje.** Service klíč, obsah bucketu `dokumenty` a `.env`. Bucket je součástí projektu a přesune se s ním; service klíč se po převodu vygeneruje nový a starý zneplatní.

## Pro Petra — jak testovat

Otevři si odkaz, který jsem ti poslal, a přihlas se jménem a heslem, které máš ode mě v samostatné zprávě. Nic si nikam neinstaluješ a nic nenastavuješ — všechno běží v prohlížeči. Systém je zatím testovací: klienti, které uvidíš, jsou vymyšlení (Adam Testovací, Alena Zkušební a další) a všechno, co v něm naklikáš, zůstává jen v tvém prohlížeči. Proto tam prosím nevkládej žádné skutečné údaje o klientech — nahoře na to upozorňuje žlutý pruh.

Projdi si to takhle: v přehledu klientů zkus hledání a filtry, pak klikni na kteréhokoli klienta. V jeho kartě rozklikni produktovou oblast (Život, Investice, Úvěr…) — uvidíš fázi rozpracovanosti, poznámku a seznam smluv, všechno se dá měnit. Níž v kartě je místo na komentáře (třeba „volal jsem třikrát, nebere"), historie schůzek, odkaz na investiční dotazník a časová osa cílů. Nakonec zkus vpravo nahoře tlačítko „Kopírovat do 4fin" — vypíše všechna pole v tom pořadí, jak je máte ve 4finu, a u každého je tlačítko na zkopírování. Změny se ukládají tlačítkem „Uložit" v pruhu dole. Samostatně se pak podívej na vstupní dotazník (odkaz je ve druhé zprávě) — to je formulář, který dostane klient e-mailem a vyplní si ho sám.

Zpětnou vazbu posílej prosím po obrazovkách: udělej screenshot a napiš k němu „tady doplnit…" nebo „tady bych to měl jinak…". Nejvíc mi pomůže, když u každé obrazovky zvlášť označíš, **která pole má vidět a vyplňovat klient a která jen tvůj tým** — to je jediné, co potřebuju vědět dřív, než se to napojí na ostrou databázi. Klidně posílej i drobnosti, které ti přijdou hloupé (špatný název pole, nejasné tlačítko) — přesně ty teď hledám.

## Branding

Vizuál „Bohatněte s rozumem": černý text (`--ink`), žlutý kruhový akcent (`--accent: #F5C518`), bílé pozadí (`--bg`). Vše ostatní se odvozuje z těchto tří proměnných + šedé škály v `css/style.css` → `:root`. Výměna palety = jeden zásah.

## Onboarding — dvoudílný podle toho, kdo data zadává

**Klientský formulář** (`onboarding.html`) — odkaz posílá poradce klientovi po schůzce, ideálně s parametrem `?klient=<id>` pro automatické spárování. Sbírá jen to, co klient sám dodává: kontakt (telefon, e-mail, adresy), osobní údaje (rodinný stav, povolání, zdroj příjmů), finanční bilanci po položkách (příjmy / výdaje / závazky), aktivní smlouvy a nahrání dokumentů (max 5 MB/soubor, ukládají se do JSON jako base64). Wizard 5 sekcí s ukazatelem postupu, rozpracované uložení do localStorage („Uložit a dokončit později") a návrat ve stejném prohlížeči. Validace e-mailu a telefonu.

**Do klientského formuláře záměrně NEPATŘÍ:** rodné číslo, číslo a platnost dokladu, bankovní účet, segmentace, daňové rezidentství, AML údaje. Ty vyplňuje poradce v kartě klienta — sekce **„Údaje doplňované poradcem"** (editovatelná přímo v kartě, ukládá se s ostatními změnami).

Karta klienta zobrazuje obojí, vizuálně odlišené: žlutá linka + štítek „vyplnil klient" vs. černá linka + štítek „doplňuje poradce".

Tok dat: klient vyplní → stáhne JSON → pošle poradci → admin v dashboardu „Nahrát onboarding" → záznam se připojí k existujícímu klientovi podle `klient_id`, jinak vznikne nový.

V kartě klienta je režim **„Kopírovat do 4fin"** — všechna pole přesně v pořadí formuláře CRM 4fin (kombinuje základní kartu, klientský formulář i data od poradce, u každého pole původ), každé s tlačítkem kopírování do schránky. API napojení na 4fin není — tenhle režim ruční přepis maximálně zkracuje.

```
index.html              SPA — login, přehled klientů, karta klienta
onboarding.html         klientský vstupní dotazník (wizard)
js/onboarding.js        logika formuláře + validace
css/style.css           styly; brand barvy jako CSS proměnné v :root
js/config.js            uživatelé, GitHub repo, produktové stavy
js/app.js               aplikační logika
data/clients.json       databáze klientů (generuje import)
import/import_clients.py  import z Excelu (list „Klienti")
output/                 zálohy JSON při reimportu
```

## Import dat z Excelu

```bash
python3 import/import_clients.py /cesta/k/Obchody.xlsx
```

Opakovaně spustitelný — před přepsáním zazálohuje stávající `data/clients.json` do `output/`. Čte list „Klienti", hlavičky na řádku 2, data od řádku 3. Prázdné řádky (bez jména, příjmení i firmy) přeskakuje.

## Přihlášení

> Login `petr` / `martinek2026` je **testovací placeholder** — v ostré verzi ho nahradí back-end autentizace (serverová). Přístupový token k datům žije výhradně v localStorage prohlížeče; není v URL, není v kódu, není v repu.

Dvě úrovně (v1): `petr` (admin) a `tym` (uživatel). Hesla v `js/config.js` jako SHA-256 hash — výchozí hesla `martinek2026` / `tym2026`, **před nasazením změnit** (návod v komentáři config.js).

Pozn.: klientská autentizace na statickém hostingu chrání proti náhodnému přístupu, ne proti cílenému útoku. Repo musí zůstat privátní; plné role přijdou v další fázi.

## Ukládání změn

Přepínání produktových stavů v kartě klienta → tlačítko „Uložit do repa" zapíše `data/clients.json` přes GitHub Contents API (potřeba fine-grained PAT s `contents:write`; token se ukládá jen do localStorage). Alternativa: „Stáhnout JSON" a nahrát ručně.

Před prvním použitím doplň v `js/config.js` → `github.owner` a `github.repo`.

## Nasazení

1. Vytvoř privátní GitHub repo, pushni obsah.
2. Settings → Pages → deploy z `main` (u privátního repa vyžaduje GitHub Pro/Team, jinak hostuj přes jiný statický hosting s přístupem do privátního repa).
3. Doplň `github.owner`/`repo` v config.js, změň hesla.

## Výměna brandu

Logo a barvy: jen `css/style.css` → `:root` blok (`--brand-primary`, `--brand-accent`, `--brand-logo-url`).

## Mimo rozsah v1

Napojení na Forffin API, notifikace, workflow fáze mezi členy týmu, klientský portál — další fáze.
