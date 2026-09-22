-- 008_klient_pristup.sql — přístup klienta přes odkaz s tokenem
--
-- Klient nemá účet. Poradce vygeneruje 32B náhodný token, do tabulky se
-- uloží jen jeho SHA-256; samotný token je v odkazu. Ověření, rate limit
-- a čtení dat běží výhradně v edge funkcích pod service klíčem — anon ani
-- klient se k této tabulce nedostane.

alter table klient_pristup
  add column if not exists pouzito_naposledy timestamptz,
  add column if not exists volani_pocet      int not null default 0,     -- rate limit: volání v aktuálním okně
  add column if not exists volani_od         timestamptz not null default now();

alter table klient_pristup alter column platnost_do set default now() + interval '30 days';

-- Jeden aktivní odkaz na klienta. Nový zneplatní starý (dělá aplikace), index to hlídá.
create unique index if not exists klient_pristup_jeden_aktivni
  on klient_pristup (klient_id) where aktivni;

comment on table klient_pristup is 'Odkazy pro klienty. token_hash = SHA-256 tokenu z odkazu. Ověřuje edge funkce.';
