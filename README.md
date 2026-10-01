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
| 9 | Authentication → SMTP | Nastavit **vlastní SMTP** (viz varování níže) — bez něj se nedá pozvat nikdo mimo tým projektu | ☐ |

> **Přihlášení proto běží e-mailem a heslem** — heslo nastavuje správce (admin API), na doručení pošty nic nezávisí. Magic link zůstává v aplikaci jako druhá cesta pro dobu, kdy bude SMTP.
>
> **Vestavěný odesílatel e-mailů nestačí.** Supabase bez vlastního SMTP posílá přihlašovací odkazy **jen členům projektu** a povolí přibližně 2–3 e-maily za hodinu. Pozvánka na adresu mimo tým buď nedorazí, nebo skončí ve spamu — odesílatelem je obecná adresa Supabase. Před ostrým provozem je potřeba připojit vlastní SMTP (firemní doména), jinak se nový poradce nepřihlásí.

### Přihlašovací e-mail — odolný vůči skenerům pošty

**Problém:** výchozí e-mail Supabase vede odkazem rovnou na ověření. Firemní pošta (a někdy i Gmail) odkazy v e-mailech předem „otevírá", aby zkontrolovala, jestli nejsou škodlivé — a tím jednorázový odkaz spotřebuje. Člověk pak klikne na odkaz, který už nejde použít.

**Řešení:** odkaz vede na aplikaci s `?token_hash=…`, aplikace ukáže tlačítko „Přihlásit se do aplikace" a ověří se až po kliknutí. Skener stránku jen načte, na tlačítko neklikne, token přežije. Strana aplikace je hotová; zbývá jednorázově přepnout šablonu:

1. Supabase → **Authentication → Emails → Magic Link**
2. *Subject:* `Přihlášení do přehledu klientů`
3. *Body:* celý obsah souboru [`supabase/email_magic_link.html`](supabase/email_magic_link.html)
4. Uložit

Rozhodující je řádek s odkazem: `{{ .SiteURL }}?token_hash={{ .TokenHash }}&type=email`. **Nesmí** tam zůstat `{{ .ConfirmationURL }}` — to je právě ten odkaz, který skener spotřebuje.

### Edge funkce — nasazení a Secrets

Zdrojáky jsou v `supabase/functions/<nazev>/index.ts`, sdílený kód v `supabase/functions/_shared/`. Nasazení na jakýkoli projekt (vyžaduje access token v prostředí):

```bash
export SUPABASE_ACCESS_TOKEN=sbp_…            # Account → Access Tokens; nikdy do repa
npx supabase@latest secrets set APP_URL=https://<adresa-aplikace> --project-ref <ref>
for f in klient_pristup klient_ulozit klient_upload; do
  npx supabase@latest functions deploy $f --project-ref <ref> --no-verify-jwt
done
```

| Secret | Kdo ho nastaví | K čemu |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` | Supabase automaticky pro každou funkci | přístup k databázi pod service rolí — **nikdy v kódu, nikdy v repu** |
| `APP_URL` | ručně (příkaz výše) | funkce z něj čtou `config/oblasti.json` pro rozřazení smluv |

`--no-verify-jwt` je záměr: klient nemá účet, ověřuje se tokenem z odkazu (SHA-256 v `klient_pristup`). Bez toho by funkce vyžadovaly přihlášení.

### Dokumenty — jak funguje upload a kontrola typu

- Bucket `dokumenty` je **privátní**. Soubory leží pod `<klient_id>/<uuid>-<bezpečný-název>`; název se odvozuje z obsahu (přípona podle rozpoznaného typu), diakritika a mezery se nahradí.
- **Typ se posuzuje z obsahu souboru (magic bytes), ne z přípony ani Content-Type.** `%PDF-` → PDF, `FF D8 FF` → JPG, `89 50 4E 47…` → PNG, ISO-BMFF `ftyp` + brand `heic/heix/mif1…` → HEIC. Soubor `faktura.pdf` s obsahem EXE server odmítne (`400`). Max 15 MB (`413`). Stejná kontrola běží i v prohlížeči (`js/soubor.js`), ale jen kvůli rychlé hlášce — rozhoduje server (`supabase/functions/_shared/soubor.ts`).
- **Klient** nahrává přes edge funkci `klient_upload` (multipart: `token`, `soubor`, volitelně `dokument_id`). Složka je odvozená z tokenu, klient ji nemůže zvolit. Řádek v `dokumenty` dostane `nahral_klient = true`, `stav = ceka_na_kontrolu`. Klient nikdy nedostane URL ke stažení — vidí jen „nahráno, čeká na kontrolu". Signed upload URL se záměrně nepoužívá: má pevnou platnost 2 h a obsah by šlo ověřit až po nahrání.
- **Tým** nahrává přímo do bucketu (RLS na `storage.objects`: `select/insert/update` jen `je_tym()`, `delete` jen admin, anon nic) a řádek uloží s kartou přes `save_klient`. „Otevřít" = signed URL na 60 minut; u souboru od klienta se tím zapíše `zobrazeno_kdy`. „Smazat" je měkké (`smazano`), soubor v bucketu zůstává — retence se řeší zvlášť.
- Přehled ukazuje štítek „N nových dokumentů" = `nahral_klient and zobrazeno_kdy is null` (pohled `klienti_prehled`).
- Test: `node tests/test_upload.mjs` (EXE v .pdf → 400, 20 MB → 413, cesta ve složce klienta, anon bez signed URL, smazaný se klientovi nevrací; uklízí i soubory v bucketu).

### Odkaz pro klienta — jak funguje a co klient vidí

Netechnicky, pro Petra: V kartě klienta je tlačítko **„Vytvořit odkaz pro klienta"**. Vznikne jednorázová adresa, kterou klientovi pošlete (SMS, e-mail). Klient na ní **nic nehledá a nikam se nepřihlašuje** — otevře se mu rovnou jeho vstupní dotazník s tím, co už o něm máte, a doplní zbytek: kontakt, adresy, osobní údaje, bilanci, smlouvy. Může nahrát dokumenty (foto dokladu, smlouvu). Nevidí nic z vaší práce: žádné komentáře, fáze, interní poznámky ani seznam smluv rozřazený do oblastí. Odkaz **platí 30 dní**, zobrazí se jen jednou (hned ho zkopírujte), a „Zneplatnit odkaz" ho kdykoli zruší. Jeden klient má vždy nejvýš jeden platný odkaz — nový ruší starý.

Co se stane, když klient něco upraví: karta ukáže pruh **„Klient upravil N polí"** s výpisem starých a nových hodnot. Dokumenty od klienta mají stav *čeká na kontrolu* a v přehledu je u klienta štítek „N nových dokumentů". Na *dodáno* je přepíná jen poradce.

**Heslo na odkaz (volitelné).** Před vytvořením zaškrtněte „Chránit odkaz heslem" a zadejte heslo (min. 4 znaky). Heslo klientovi sdělte jinou cestou než odkazem — telefonicky, SMS. Po vytvoření už ho nikde neuvidíte (v databázi je jen bcrypt hash, `klient_pristup.heslo_hash`). Klient při otevření odkazu nejdřív zadá heslo; po **3 špatných pokusech se odkaz na 15 minut zablokuje**. Blokace je vázaná na odkaz (token), ne na IP adresu — klient za firemní sítí tak neblokuje kolegy a naopak. Heslo se ověřuje jen na serveru (`over_heslo`, migrace `011`, volá ji jen edge funkce pod service rolí). Test: `node tests/test_heslo.mjs`.

Technicky: tabulka `klient_pristup` (hash tokenu, platnost, heslo, počítadla), edge funkce `klient_pristup` (čtení), `klient_ulozit` (zápis jen povolených polí + záznam změn do `onboarding_zmeny`), `klient_upload` (soubory). Co klient smí měnit, určuje `ALLOWED_ONBOARDING` v `_shared/klient.ts` — nic jiného server nepřijme.

### Fotky od klienta — komprese před nahráním

Fotky dokladů z mobilu mívají 4–8 MB. Prohlížeč je před odesláním zmenší (`js/soubor.js` → `zkomprimujObrazek`): soubory nad 1,5 MB se přeškálují na max. 2000 px delší strany a uloží jako JPEG 85 %. Typicky 5 MB → 400–700 kB. PDF a soubory pod prahem se nemění. Platí pro klienta i tým. Limit 15 MB na serveru zůstává jako pojistka.

### Stažení karty jako PDF

Tlačítko **„Stáhnout PDF"** v kartě otevře tiskový pohled a dialog tisku — v něm zvolte „Uložit jako PDF". Obsah: základní údaje, kontakt, bilance, oblasti s položkami a fázemi, dokumenty se stavy, cíle. **Bez komentářů a interních poznámek** — PDF je určené pro klienta nebo do spisu. Záměrně se používá tisk prohlížeče místo knihovny (jsPDF apod.): systémové fonty zvládnou češtinu bez vkládání fontů (ověřeno na „Žluťoučký kůň"), výstup má textovou vrstvu a jde vyhledávat. Generátor je čistá funkce `sestavKartuProTisk` v `js/export_pdf.js` — jde otestovat bez prohlížeče.

### Produktové oblasti navíc

Kromě pěti základních (Život, Investice, Neživot, Úvěr, Úvěr na bydlení) existují **EUCS (likvidace pojistných událostí)**, **Podnikatelská rizika** a **Penze** (penzijní spoření; DIP zůstává v Investicích). V kartě se ukazují **jen když mají obsah** (stav, fázi nebo položku) — jinak by karta rostla do nekonečna. Smlouvy od klienta se do nich rozřazují podle `config/oblasti.json`, co nikam nesedí, končí v „Ostatní".

> **CORS je zatím `*`** (`_shared/klient.ts` → `CORS`). Přístup chrání token, ne origin, takže to teď neblokuje. **Před ostrým provozem omezit na doménu aplikace** — jeden řádek, hodnota `Access-Control-Allow-Origin`.

Rate limit: 20 volání za hodinu na jeden token (klouzavé okno v `klient_pristup.volani_pocet/volani_od`). Ověřuje test `tests/test_klient_pristup.mjs` reálně — 21 voláními.

### Dvě věci, na kterých se dá naletět

**Politiky RLS nestačí.** Politika říká, které řádky role uvidí; *grant* říká, jestli na tabulku vůbec smí. Bez grantů vrátí server „permission denied" i při dokonale nastavených politikách — a politiky se ani nevyhodnotí. Proto existuje `005_grants.sql`; při zakládání dalších tabulek na něj nezapomeňte. Totéž platí pro `service_role` (edge funkce): tabulky založené migrací přes Management API výchozí granty nedostanou — `009_grants_service_role.sql`. Příznak: funkce vrací „neplatný odkaz" i s platným tokenem.

**Pozvánka nesmí měnit primární klíč.** Když už řádek v `uzivatele` existuje (například ze seedu) a odkazují na něj cizí klíče, nejde mu přepsat `id` na nově vzniklé auth id — databáze to odmítne. Správný postup je opačný: auth účet se zakládá **s uuid existujícího řádku** (`POST /auth/v1/admin/users` s polem `id`). Tím zůstanou historie komentářů i přiřazení klientů napojené. Edge funkce `pozvat_uzivatele` to musí dělat takto.

### Proměnné prostředí a kde se plní

| Proměnná | Kde žije | K čemu |
|---|---|---|
| `supabase.url`, `supabase.anon_key` | `config/app.json` (v repu, veřejné) | Frontend. Anon klíč je veřejný záměrně — data chrání RLS politiky, ne utajení klíče. |
| `SUPABASE_SERVICE_KEY` | `.env` lokálně (v `.gitignore`), Edge Functions → Secrets | Seed skript a edge funkce. Obchází RLS, **nikdy ne do frontendu ani do repa**. |
| `GITHUB_TOKEN` | jen prostředí shellu při seedu | Zápis ukázkových dat do prototypového GitHub úložiště. |

## Před nasazením ověř

Automatické testy (`node tests/run.mjs`) hlídají databázi. Tohle jsou věci, které pozná jen člověk u prohlížeče — projdi je po každé změně, která sahá na formulář, kartu nebo ukládání. Odhadem 10 minut.

1. **Přihlášení e-mailem a heslem** — dostaneš se do přehledu. Špatné heslo musí hlásit „Nesprávný e-mail nebo heslo", deaktivovaný účet (`aktivni = false`) hlášku „Váš účet není aktivní".
2. **Přehled se naplní** — tabulka ukazuje klienty, sedí obchodník a stavy oblastí. Žádná výzva na token, žádná prázdná tabulka.
3. **Klient bez účtu tlačítko nevidí** — otevři formulář v anonymním okně: po odeslání smí nabídnout **jen** stažení souboru, nikdy „Uložit do systému". (Nabídka, která by pak selhala, je horší než žádná.)
4. **Formulář uloží** — přihlášený vyplní formulář s `?klient=<id>` a uloží. Hláška o úspěchu se smí objevit jen tehdy, když data opravdu odešla.
5. **Karta ukáže** — u téhož klienta v kartě sedí kontakt, bilance, smlouvy i povolání a zmizela hláška „klient formulář nevyplnil".
6. **Přehled sedí** — po uložení formuláře se řádek v přehledu aktualizoval bez obnovení stránky a **obchodník nezmizel**.
7. **Označení „nové"** — oblast, kam klient poslal smlouvu a poradce ji ještě nezařadil, má v přehledu i v kartě žlutý štítek. Po nastavení stavu zmizí.
8. **Reload drží změnu** — změň fázi, ulož, zmáčkni F5. Změna tam musí být i po přenačtení (ne jen v paměti prohlížeče).
9. **Dva taby** — otevři téhož klienta ve dvou oknech, ulož v obou. Druhý musí dostat hlášku o konfliktu, ne tiše přepsat kolegovu práci.
10. **Varovný pruh** — na všech obrazovkách svítí „Testovací prostředí". Před ostrým provozem se vypíná v `config/app.json` (`testovaci_rezim: false`), ne mazáním kódu.
11. **Formulář v obou režimech** — (a) jako poradce `?klient=<id>` z karty, (b) jako klient přes vygenerovaný odkaz v anonymním okně. V klientském režimu musí jít Pokračovat/Zpět po zadání hesla, klient nesmí vidět interní pole ani checklist dokumentů s přepínáním stavu.
12. **Upload** — v klientském režimu nahraj JPG z mobilu (nad 1,5 MB): v kartě se objeví „čeká na kontrolu", velikost je po kompresi menší. Nahrání `.exe` přejmenovaného na `.pdf` server odmítne.
13. **Heslo na odkaz** — vytvoř chráněný odkaz, otevři ho: bez hesla se formulář neukáže, špatné heslo hlásí zbývající pokusy, správné pustí dál.
14. **PDF** — „Stáhnout PDF" otevře tiskový náhled s diakritikou v pořádku; v náhledu nejsou komentáře.

## Testy

```bash
node tests/run.mjs                  # vše
node tests/test_neuplny_zapis.mjs   # po každé změně save_klient
node tests/test_dva_taby.mjs        # po každé změně zámku proti přepsání
node tests/test_klient_pristup.mjs  # token, omezení polí, rate limit (reálných 21 volání)
node tests/test_upload.mjs          # magic bytes, limit, cesta ve složce klienta
node tests/test_heslo.mjs           # heslo na odkaz, blokace po 3 pokusech
```

Testy běží proti živé databázi jako přihlášený uživatel, takže procházejí i politikami RLS — stejnou cestou jako aplikace. Potřebují `.env` se service klíčem (přihlášení testovacího uživatele) a vyplněný `config/app.json`.

**Pravidlo pro každý test:** nikdy nezapisuje na klienty, které vidí tým (ukázkoví t0001–t0005 ani nic jiného). Test si založí vlastního klienta s prefixem `test-` a po sobě ho smaže — i když spadne uprostřed. Vynucuje to `tests/lib.mjs`: `db().save()` a `smaz()` odmítnou id bez prefixu `test-`, a `sTestovacimiKlienty(d, ids, fn)` uklidí ve `finally`. Nový test pište vždy přes tuhle pomůcku. (Pravidlo vzniklo poté, co test dvou tabů přepsal položky ukázkového klienta, se kterým zrovna pracoval tým.)

`test_neuplny_zapis.mjs` existuje kvůli chybě, která by se jinak vrátila: `save_klient` původně přepisoval všechny sloupce z payloadu, takže zápis jen s částí dat tiše smazal obchodníka i podřízené záznamy. **Po každé úpravě `save_klient` ho spusť** — je to jediná pojistka, že se to nestane znovu.

## Mapování polí z Excelu do databáze

Kde skončila která kolonka z původního listu „Klienti", aby se to dalo za tři měsíce dohledat.

| Excel | Kam | Poznámka |
|---|---|---|
| Jméno, Příjmení, Firma | `klienti.jmeno / prijmeni / firma` | |
| Stav | `klienti.stav_vztahu` | Nový klient / Aktivní klient / Pozastaveno. **Není to** `klienti.stav` — ten řídí retenci (`aktivni` / `ukonceny` + `datum_ukonceni`) a s Excelem nesouvisí. |
| Obchodník | `klienti.obchodnik_id` → `uzivatele` | Text z Excelu se při seedu mapuje na řádek uživatele. |
| Lead Agent | `klienti.lead_agent` (boolean) | Lead Agent je **externí portál** na hromadné SMS/e-maily a landing pages. Pole znamená „je klient v Lead Agentu nahraný?" — Excel „Ano" → `true`, jinak `false`. V kartě zaškrtávátko. (Původně omylem modelováno jako odkaz na uživatele; opraveno migrací `006`.) |
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

Otevři si odkaz, který jsem ti poslal, a přihlas se svým e-mailem a heslem, které máš ode mě v samostatné zprávě. Nic si nikam neinstaluješ a nic nenastavuješ — všechno běží v prohlížeči. Systém je zatím testovací: klienti, které uvidíš, jsou vymyšlení (Adam Testovací, Alena Zkušební a další) a všechno, co v něm naklikáš, zůstává jen v tvém prohlížeči. Proto tam prosím nevkládej žádné skutečné údaje o klientech — nahoře na to upozorňuje žlutý pruh.

Projdi si to takhle: v přehledu klientů zkus hledání a filtry, pak klikni na kteréhokoli klienta. V jeho kartě rozklikni produktovou oblast (Život, Investice, Úvěr…) — uvidíš fázi rozpracovanosti, poznámku a seznam smluv, všechno se dá měnit. Níž v kartě je místo na komentáře (třeba „volal jsem třikrát, nebere"), historie schůzek, odkaz na investiční dotazník a časová osa cílů. Nakonec zkus vpravo nahoře tlačítko „Kopírovat do 4fin" — vypíše všechna pole v tom pořadí, jak je máte ve 4finu, a u každého je tlačítko na zkopírování. Změny se ukládají tlačítkem „Uložit" v pruhu dole. Nového člověka založíš tlačítkem „+ Nový klient" nad tabulkou — stačí příjmení, karta se otevře hned a v ní je tlačítko „Vyplnit vstupní formulář" pro schůzku bez Plaudu. Samostatně se pak podívej na vstupní dotazník: v kartě „Vytvořit odkaz pro klienta" (klidně s heslem), odkaz otevři v anonymním okně — tohle uvidí klient a vyplní si sám, včetně nahrání fotky dokladu. Nakonec zkus „Stáhnout PDF" — výpis karty bez interních poznámek, třeba pro klienta nebo do spisu.

Zpětnou vazbu posílej prosím po obrazovkách: udělej screenshot a napiš k němu „tady doplnit…" nebo „tady bych to měl jinak…". Nejvíc mi pomůže, když u každé obrazovky zvlášť označíš, **která pole má vidět a vyplňovat klient a která jen tvůj tým** — to je jediné, co potřebuju vědět dřív, než se to napojí na ostrou databázi. Klidně posílej i drobnosti, které ti přijdou hloupé (špatný název pole, nejasné tlačítko) — přesně ty teď hledám.

## Branding

Vizuál „Bohatněte s rozumem": černý text (`--ink`), žlutý kruhový akcent (`--accent: #F5C518`), bílé pozadí (`--bg`). Vše ostatní se odvozuje z těchto tří proměnných + šedé škály v `css/style.css` → `:root`. Výměna palety = jeden zásah.

## Onboarding — dvoudílný podle toho, kdo data zadává

**Klientský formulář** (`onboarding.html`) — odkaz posílá poradce klientovi po schůzce, ideálně s parametrem `?klient=<id>` pro automatické spárování. Sbírá jen to, co klient sám dodává: kontakt (telefon, e-mail, adresy), osobní údaje (rodinný stav, povolání, zdroj příjmů), finanční bilanci po položkách (příjmy / výdaje / závazky), aktivní smlouvy a nahrání dokumentů (do 15 MB/soubor, do privátního bucketu — viz „Dokumenty"). Druhý krok sbírá i partnera, počet a věk dětí, povolání a zaměstnavatele (karta → „Základní údaje"). Tlačítko „Zpět" je velké vedle „Pokračovat", ne schované pod formulářem. Wizard 5 sekcí s ukazatelem postupu, rozpracované uložení do localStorage („Uložit a dokončit později") a návrat ve stejném prohlížeči. Validace e-mailu a telefonu.

**Do klientského formuláře záměrně NEPATŘÍ:** rodné číslo, číslo a platnost dokladu, bankovní účet, segmentace, daňové rezidentství, AML údaje. Ty vyplňuje poradce v kartě klienta — sekce **„Údaje doplňované poradcem"** (editovatelná přímo v kartě, ukládá se s ostatními změnami).

Karta klienta zobrazuje obojí, vizuálně odlišené: žlutá linka + štítek „vyplnil klient" vs. černá linka + štítek „doplňuje poradce".

Tok dat (Supabase): klient vyplní přes odkaz s tokenem → `klient_ulozit` zapíše do karty a zaloguje změny → poradce v kartě vidí „Klient upravil N polí". Stažení JSON zůstává jako záloha pro režim bez úložiště.

V kartě klienta je režim **„Kopírovat do 4fin"** — všechna pole přesně v pořadí formuláře CRM 4fin (kombinuje základní kartu, klientský formulář i data od poradce, u každého pole původ), každé s tlačítkem kopírování do schránky. API napojení na 4fin není — tenhle režim ruční přepis maximálně zkracuje.

```
index.html              SPA — login, přehled klientů, karta klienta
onboarding.html         klientský vstupní dotazník (wizard)
js/onboarding.js        logika formuláře + validace (režim poradce i klient)
js/export_pdf.js        karta klienta → tiskový pohled / PDF
js/soubor.js            kontrola typu souboru, komprese fotek
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

## Nasazení — Cloudflare Pages

**Adresa:** `https://bohatnete-klienti.pages.dev` (projekt `bohatnete-klienti`, účet Cloudflare Jana; bez vlastní domény). Repo je privátní. Starý hosting na GitHub Pages je vypnutý.

**Jak deploy funguje.** Hosting je statický: nahrává se jen to, co prohlížeč potřebuje — `index.html`, `onboarding.html`, `_headers`, `js/`, `css/`, `config/`, `demo/`. Testy, migrace, edge funkce, `.env` ani README na hosting nejdou. Cloudflare Pages dělá „čisté URL": `onboarding.html` se přesměruje (308) na `/onboarding`, proto odkazy pro klienty míří rovnou na `/onboarding` (`config/app.json` → `klient_url`).

Dvě cesty nasazení, stejný výsledek:

1. **Automaticky** — GitHub Action `.github/workflows/deploy.yml`: každý push do `main` nahraje balík přes `wrangler pages deploy`. Potřebuje dva secrets v repu (Settings → Secrets and variables → Actions): `CLOUDFLARE_API_TOKEN` (právo *Cloudflare Pages: Edit*) a `CLOUDFLARE_ACCOUNT_ID`.
2. **Ručně z počítače** — stejný příkaz, token z `.env`:
   ```bash
   npm run deploy
   ```
   (skládá `dist/` a volá `wrangler pages deploy`; `dist/` je v `.gitignore`).

Každý deploy má vlastní náhledovou adresu `https://<hash>.bohatnete-klienti.pages.dev`; produkční je bez hashe. Rollback = Cloudflare → Workers & Pages → bohatnete-klienti → Deployments → „Rollback" u staršího nasazení.

**`_headers`** nastavuje bezpečnostní hlavičky (nosniff, `X-Frame-Options: DENY`, Referrer-Policy) a `no-cache` na `config/`, aby se změna konfigurace projevila hned (skripty řeší `?v=` v HTML).

**Co visí na adrese aplikace (při změně adresy projít):**

| Kde | Co | Proč |
|---|---|---|
| `config/app.json` → `klient_url` | adresa klientského formuláře | odkazy pro klienty |
| Supabase → Authentication → URL Configuration | Site URL + Redirect URLs (`https://…/**`) | přihlašovací odkaz e-mailem |
| Supabase → Edge Functions → Secrets → `APP_URL` | adresa aplikace | `klient_ulozit` si z ní čte `config/oblasti.json` |
| `supabase/functions/_shared/klient.ts` → `CORS` | povolený origin | zatím `*`, zúžit před ostrým provozem |
| developer.mapy.cz → klíč | povolené domény (referrer) | našeptávač adres |

### Přechod na vlastní doménu

1. Doménu přidat do Cloudflare (Add a domain, plán Free) a u registrátora přepnout nameservery.
2. Workers & Pages → bohatnete-klienti → Custom domains → přidat `app.<doména>` (tým) a `klient.<doména>` (klientský formulář). DNS záznamy Cloudflare založí sám.
3. Projít tabulku výše: `klient_url` → `https://klient.<doména>/onboarding`, Supabase URL, `APP_URL`, CORS, Mapy.cz.
4. `pages.dev` adresa dál funguje — nechat jako zálohu, nebo v Pages vypnout.

### Cloudflare Access (až bude)

Zero Trust (plán Free do 50 uživatelů) chce při aktivaci platební kartu, proto zatím není. Doplní se před předáním na Petrův účet. Plán:

- **Aplikace „tým":** hostname aplikace, politika *Allow* pro e-maily týmu, přihlášení One-time PIN (kód e-mailem, bez SMTP). Kdo není v seznamu, neuvidí ani přihlašovací stránku. Supabase login zůstává jako druhá vrstva (řídí práva v datech).
- **Klientský formulář mimo Access:** s vlastní doménou je to triviální — `klient.<doména>` do Access nepatří. Na `pages.dev` by to byla druhá aplikace s politikou *Bypass* pro `/onboarding`, `/js/*`, `/css/*`, `/config/*` (Access bere nejkonkrétnější shodu).
- **Náhledová nasazení** `*.bohatnete-klienti.pages.dev` za Access celá (Pages → Settings → Access policy).
- Přidat člena týmu = e-mail do politiky + řádek v `uzivatele`.

## Výměna brandu

Logo a barvy: jen `css/style.css` → `:root` blok (`--brand-primary`, `--brand-accent`, `--brand-logo-url`).

## Mimo rozsah v1

Napojení na Forffin API, notifikace, workflow fáze mezi členy týmu, klientský portál — další fáze.
