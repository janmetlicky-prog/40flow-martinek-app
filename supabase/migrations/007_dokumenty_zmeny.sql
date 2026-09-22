-- 007_dokumenty_zmeny.sql — checklist dokumentů a log klientských úprav
--
-- dokumenty: řádek = položka checklistu (klíč z config/dokumenty.json nebo
-- vlastní), případně s nahraným souborem. Klient soubor nahraje → stav
-- `ceka_na_kontrolu`; na `dodano` přepíná jen tým po kontrole.
-- Mazání je měkké (`smazano`) — soubor zůstává, retence se řeší zvlášť.

alter table dokumenty drop constraint if exists dokumenty_stav_check;
alter table dokumenty
  add constraint dokumenty_stav_check
  check (stav in ('nedodano', 'ceka_na_kontrolu', 'dodano', 'nepotrebujeme'));

alter table dokumenty
  add column if not exists checklist_klic  text not null default '',    -- klíč z config/dokumenty.json; '' = vlastní položka
  add column if not exists nahral_klient   boolean not null default false,
  add column if not exists mime            text not null default '',
  add column if not exists velikost        bigint,
  add column if not exists smazano         timestamptz,
  add column if not exists zobrazeno_kdy   timestamptz;                 -- kdy tým dokument poprvé otevřel (indikátor „nové od klienta")

create index if not exists dokumenty_klient_idx on dokumenty (klient_id) where smazano is null;

comment on column dokumenty.stav is 'nedodano | ceka_na_kontrolu (klient nahrál) | dodano (tým zkontroloval) | nepotrebujeme';
comment on column dokumenty.zobrazeno_kdy is 'NULL u dokumentu od klienta = tým ho ještě neotevřel.';

-- Log změn klientské části, když ji mění klient sám (přes odkaz).
-- Poradce v kartě vidí „klient upravil N polí" a co bylo → je.
create table if not exists onboarding_zmeny (
  id          uuid primary key default gen_random_uuid(),
  klient_id   text not null references klienti (id) on delete cascade,
  pole        text not null,          -- např. telefon, bilance.prijmy, smlouvy
  stara       jsonb,
  nova        jsonb,
  kdy         timestamptz not null default now(),
  zdroj       text not null default 'klient' check (zdroj in ('klient', 'poradce')),
  zobrazeno   boolean not null default false   -- poradce si změny prošel
);
create index if not exists onboarding_zmeny_klient_idx on onboarding_zmeny (klient_id, kdy);

alter table onboarding_zmeny enable row level security;
create policy onboarding_zmeny_cteni  on onboarding_zmeny for select to authenticated using (je_tym());
create policy onboarding_zmeny_uprava on onboarding_zmeny for update to authenticated using (je_tym()) with check (je_tym());
create policy onboarding_zmeny_mazani on onboarding_zmeny for delete to authenticated using (je_admin());
-- insert dělá jen edge funkce (service klíč); tým přímo nezapisuje
grant select, update, delete on onboarding_zmeny to authenticated;
