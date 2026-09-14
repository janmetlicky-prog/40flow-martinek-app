-- 004_rls.sql — řízení přístupu (Row Level Security)
--
-- Anon klíč je veřejný a je vidět ve zdrojovém kódu aplikace. Data proto
-- nechrání utajení klíče, ale výhradně tyto politiky. Bez přihlášení
-- (a bez řádku v `uzivatele` s aktivni = true) se nedá přečíst nic.

-- Pomocné funkce jsou SECURITY DEFINER schválně: čtou z `uzivatele` mimo RLS,
-- jinak by politika nad `uzivatele` volala sama sebe donekonečna.
create or replace function je_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from uzivatele
     where id = auth.uid() and role = 'admin' and aktivni
  );
$$;

create or replace function je_tym()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from uzivatele
     where id = auth.uid() and role in ('admin', 'poradce', 'asistentka') and aktivni
  );
$$;

alter table uzivatele       enable row level security;
alter table klienti         enable row level security;
alter table oblasti         enable row level security;
alter table oblasti_polozky enable row level security;
alter table faze_historie   enable row level security;
alter table komentare       enable row level security;
alter table schuzky         enable row level security;
alter table cile            enable row level security;
alter table dokumenty       enable row level security;
alter table klient_pristup  enable row level security;

-- Uživatelé: každý vidí sám sebe (aby aplikace poznala svou roli), mění jen admin.
create policy uzivatele_ctu_sebe on uzivatele
  for select to authenticated using (id = auth.uid() or je_admin());
create policy uzivatele_sprava on uzivatele
  for all to authenticated using (je_admin()) with check (je_admin());

-- Klientská data: celý tým čte i zapisuje, maže jen admin.
do $$
declare t text;
begin
  foreach t in array array['klienti', 'oblasti', 'oblasti_polozky', 'faze_historie',
                           'komentare', 'schuzky', 'cile', 'dokumenty']
  loop
    execute format('create policy %I_cteni on %I for select to authenticated using (je_tym())', t, t);
    execute format('create policy %I_vklad on %I for insert to authenticated with check (je_tym())', t, t);
    execute format('create policy %I_uprava on %I for update to authenticated using (je_tym()) with check (je_tym())', t, t);
    execute format('create policy %I_mazani on %I for delete to authenticated using (je_admin())', t, t);
  end loop;
end $$;

-- Odkazy pro klienty: vytváří a ruší tým; klient se k tabulce nikdy nedostane
-- (ověření tokenu běží v edge funkci `overit_klienta` pod service klíčem).
create policy klient_pristup_sprava on klient_pristup
  for all to authenticated using (je_tym()) with check (je_tym());

-- ---------------------------------------------------------------------------
-- Rozdělení klientů podle obchodníka
--
-- Vypnuto záměrně (14. 9. 2026) — poradci vidí všechny klienty. Zapnutí je
-- možné kdykoli zpětně; před zapnutím ověřit, že žádný klient nemá
-- `obchodnik_id` NULL, jinak zmizí všem kromě admina.
--
-- Kontrola před zapnutím:
--   select count(*) from klienti where obchodnik_id is null;   -- musí být 0
--
-- Zapnutí: zrušit politiku klienti_cteni výše a použít místo ní:
--   create policy klienti_cteni on klienti for select to authenticated
--     using (je_admin() or obchodnik_id = auth.uid());
-- ---------------------------------------------------------------------------
