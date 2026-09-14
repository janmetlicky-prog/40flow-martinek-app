-- 001_schema.sql — základní schéma
--
-- Zásada: formulářová data, jejichž podobu Petr teprve upřesní, zůstávají
-- v jsonb (onboarding, poradce). Sloupce jsou jen tam, kde se podle nich
-- vyhledává, řadí nebo spojuje. Sloupce email/telefon jsou ODVOZENÉ z jsonb
-- (plní je save_klient), nikdy se do nich nezapisuje přímo z UI.

create extension if not exists "pgcrypto";

-- Uživatelé systému (tým). id = auth.users.id, doplní se při první pozvánce.
create table if not exists uzivatele (
  id          uuid primary key,
  jmeno       text not null,
  email       text not null unique,
  role        text not null check (role in ('admin', 'poradce', 'asistentka')),
  aktivni     boolean not null default false,
  vytvoreno   timestamptz not null default now()
);
comment on table uzivatele is 'Tým. Řádek může existovat i bez auth účtu (aktivni=false) — pozvánka mu doplní auth id.';

create table if not exists klienti (
  id              text primary key,          -- t0001 pro ukázková data, jinak uuid
  jmeno           text not null default '',
  prijmeni        text not null default '',
  firma           text not null default '',

  -- Retence: klient se nemaže tlačítkem, jen ukončí.
  stav            text not null default 'aktivni' check (stav in ('aktivni', 'ukonceny')),
  datum_ukonceni  date,

  -- Pracovní stav vztahu z Excelu (Nový klient / Aktivní klient / Pozastaveno).
  -- Jiná věc než `stav` výše — podle tohoto reálně pracuje tým.
  stav_vztahu     text not null default '',

  obchodnik_id    uuid references uzivatele (id) on delete set null,
  -- Fakticky duplicita obchodnik_id. V Excelu je to ale ANO/NE příznak,
  -- ne jméno — nenamapované hodnoty zůstávají v poradce->>'lead_agent_puvodni'.
  lead_agent      uuid references uzivatele (id) on delete set null,

  ida_url         text not null default '',

  -- Odvozené z onboarding jsonb (plní save_klient) — pro hledání a řazení.
  email           text not null default '',
  telefon         text not null default '',

  onboarding      jsonb not null default '{}'::jsonb,  -- vyplňuje klient
  poradce         jsonb not null default '{}'::jsonb,  -- vyplňuje tým (interní)

  vytvoreno       timestamptz not null default now(),
  upraveno        timestamptz not null default now(),  -- slouží i jako zámek proti přepsání
  upravil         text not null default ''
);
create index if not exists klienti_prijmeni_idx on klienti (prijmeni);
create index if not exists klienti_obchodnik_idx on klienti (obchodnik_id);
create index if not exists klienti_stav_idx on klienti (stav);

create table if not exists oblasti (
  id          uuid primary key default gen_random_uuid(),
  klient_id   text not null references klienti (id) on delete cascade,
  klic        text not null,            -- zivot | investice | nezivot | uver | uver_bydleni | ostatni
  stav        text not null default '',
  faze        text not null default '',
  poznamka    text not null default '',
  unique (klient_id, klic)
);

create table if not exists oblasti_polozky (
  id              uuid primary key default gen_random_uuid(),
  oblast_id       uuid not null references oblasti (id) on delete cascade,
  typ             text not null default '',
  instituce       text not null default '',
  mesicni_platba  text not null default '',
  poznamka        text not null default ''
);

create table if not exists faze_historie (
  id          uuid primary key default gen_random_uuid(),
  oblast_id   uuid not null references oblasti (id) on delete cascade,
  faze        text not null default '',
  kdy         timestamptz not null default now(),
  kdo         text not null default ''
);
create index if not exists faze_historie_oblast_idx on faze_historie (oblast_id, kdy);

create table if not exists komentare (
  id          uuid primary key default gen_random_uuid(),
  klient_id   text not null references klienti (id) on delete cascade,
  text        text not null,
  autor_id    uuid references uzivatele (id) on delete set null,
  kdy         timestamptz not null default now()
);
create index if not exists komentare_klient_idx on komentare (klient_id, kdy);

create table if not exists schuzky (
  id              uuid primary key default gen_random_uuid(),
  klient_id       text not null references klienti (id) on delete cascade,
  datum           date,
  typ             text not null default '',
  kdo             uuid references uzivatele (id) on delete set null,
  souhrn          text not null default '',
  odkaz           text not null default '',
  zdroj           text not null default 'rucni' check (zdroj in ('rucni', 'plaud')),
  plaud_file_id   text not null default ''
);
create index if not exists schuzky_klient_idx on schuzky (klient_id, datum);

create table if not exists cile (
  id          uuid primary key default gen_random_uuid(),
  klient_id   text not null references klienti (id) on delete cascade,
  cil         text not null default '',
  castka      text not null default '',
  termin      text not null default '',
  stav        text not null default 'aktivní' check (stav in ('aktivní', 'splněno'))
);

create table if not exists dokumenty (
  id            uuid primary key default gen_random_uuid(),
  klient_id     text not null references klienti (id) on delete cascade,
  nazev         text not null default '',
  typ           text not null default '',   -- z config/dokumenty.json
  stav          text not null default 'nedodano' check (stav in ('nedodano', 'dodano')),
  storage_path  text not null default '',   -- cesta v privátním bucketu, nikdy veřejná URL
  nahral        uuid references uzivatele (id) on delete set null,
  kdy           timestamptz not null default now()
);

-- Přístup klienta bez účtu: odkaz s jednorázovým tokenem.
-- Ukládá se jen hash, samotný token vidí poradce jen jednou při vygenerování.
create table if not exists klient_pristup (
  id            uuid primary key default gen_random_uuid(),
  klient_id     text not null references klienti (id) on delete cascade,
  token_hash    text not null,
  platnost_do   timestamptz not null,
  aktivni       boolean not null default true,
  vytvoreno     timestamptz not null default now(),
  vytvoril      uuid references uzivatele (id) on delete set null
);
create index if not exists klient_pristup_hash_idx on klient_pristup (token_hash);
