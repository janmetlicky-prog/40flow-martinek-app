-- 011_odkaz_heslo.sql — volitelné heslo na odkaz pro klienta
--
-- Heslo se ukládá jako bcrypt (pgcrypto, gen_salt('bf', 10)). Zadává ho
-- poradce při vytvoření odkazu, nikam jinam se nezapisuje a nejde zobrazit.
-- Blokace po 3 neúspěšných pokusech je vázaná na řádek tokenu, ne na IP —
-- klient za firemním NAT by jinak blokoval kolegy.

-- pgcrypto žije v Supabase ve schématu `extensions` — proto search_path níže
create extension if not exists pgcrypto with schema extensions;

alter table klient_pristup
  add column if not exists heslo_hash   text,
  add column if not exists pokusy       int not null default 0,
  add column if not exists blokovano_do timestamptz;

-- Vytvoření odkazu (tým, přes RLS): zneplatní starý, uloží hash tokenu a případně hesla.
create or replace function vytvor_odkaz(p_klient_id text, p_token_hash text, p_heslo text default null)
returns uuid
language plpgsql security invoker set search_path = public, extensions
as $$
declare v_id uuid;
begin
  update klient_pristup set aktivni = false where klient_id = p_klient_id and aktivni;
  insert into klient_pristup (klient_id, token_hash, aktivni, vytvoril, heslo_hash)
  values (p_klient_id, p_token_hash, true, auth.uid(),
          case when coalesce(p_heslo, '') <> '' then crypt(p_heslo, gen_salt('bf', 10)) end)
  returning id into v_id;
  return v_id;
end $$;

-- Ověření hesla (volá edge funkce pod service rolí). Vrací true jen při shodě.
create or replace function over_heslo(p_id uuid, p_heslo text)
returns boolean
language sql security definer set search_path = public, extensions
as $$
  select exists (
    select 1 from klient_pristup
     where id = p_id and heslo_hash is not null and heslo_hash = crypt(p_heslo, heslo_hash)
  );
$$;

revoke all on function over_heslo(uuid, text) from public, anon, authenticated;
grant execute on function over_heslo(uuid, text) to service_role;
grant execute on function vytvor_odkaz(text, text, text) to authenticated;
