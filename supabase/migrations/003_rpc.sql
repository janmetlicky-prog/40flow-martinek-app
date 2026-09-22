-- 003_rpc.sql — transakční uložení klienta
--
-- Celý klient se ukládá jedním voláním, ne osmi requesty z prohlížeče:
-- buď projde všechno, nebo nic.
--
-- Zámek proti přepsání: volající pošle `upraveno`, jaké měl při načtení.
-- Pokud se mezitím v databázi změnilo, funkce skončí chybou KONFLIKT
-- a UI nabídne „Načíst znovu" — stejně jako dnes v GitHub režimu.

create or replace function save_klient(p jsonb)
returns timestamptz
language plpgsql
security invoker           -- záměrně: musí projít RLS volajícího
set search_path = public
as $$
declare
  v_id          text := p->>'id';
  v_ocekavane   timestamptz := nullif(p->>'upraveno', '')::timestamptz;
  v_skutecne    timestamptz;
  v_nove        timestamptz := now();
  v_oblast_id   uuid;
  v_o           jsonb;
  v_polozka     jsonb;
  v_h           jsonb;
  v_zaznam      jsonb;
begin
  if v_id is null or v_id = '' then
    raise exception using errcode = 'P0001',
      message = 'CHYBI_ID: Záznam klienta nemá id.';
  end if;

  select upraveno into v_skutecne from klienti where id = v_id;

  -- Existující klient: ověřit, že se pod rukama nezměnil.
  if found and v_ocekavane is not null and v_skutecne is distinct from v_ocekavane then
    -- Zpráva musí obsahovat slovo KONFLIKT — podle něj aplikace pozná,
    -- že má nabídnout „Načíst znovu" místo obecné chybové hlášky.
    raise exception using errcode = 'P0001',
      message = 'KONFLIKT: Záznam mezitím upravil někdo jiný. Načtěte klienta znovu a proveďte úpravu na aktuální verzi.';
  end if;

  insert into klienti (
    id, jmeno, prijmeni, firma, stav, datum_ukonceni, stav_vztahu,
    obchodnik_id, lead_agent, ida_url,
    email, telefon, onboarding, poradce, upraveno, upravil
  )
  values (
    v_id,
    coalesce(p->>'jmeno', ''),
    coalesce(p->>'prijmeni', ''),
    coalesce(p->>'firma', ''),
    coalesce(nullif(p->>'stav', ''), 'aktivni'),
    nullif(p->>'datum_ukonceni', '')::date,
    coalesce(p->>'stav_vztahu', ''),
    nullif(p->>'obchodnik_id', '')::uuid,
    coalesce((p->>'lead_agent')::boolean, false),
    coalesce(p->>'ida_url', ''),
    -- email/telefon jsou ODVOZENÉ z onboarding jsonb — jediná cesta zápisu
    coalesce(p->'onboarding'->>'email', ''),
    coalesce(p->'onboarding'->>'telefon', ''),
    coalesce(p->'onboarding', '{}'::jsonb),
    coalesce(p->'poradce', '{}'::jsonb),
    v_nove,
    coalesce(p->>'upravil', '')
  )
  -- Přepisují se JEN pole, která volající skutečně poslal. Kdyby se braly
  -- všechny, neúplný zápis (třeba jen z formuláře) by zbytek záznamu smazal —
  -- klient by tiše přišel o obchodníka nebo o stav vztahu.
  on conflict (id) do update set
    jmeno          = case when p ? 'jmeno'          then excluded.jmeno          else klienti.jmeno end,
    prijmeni       = case when p ? 'prijmeni'       then excluded.prijmeni       else klienti.prijmeni end,
    firma          = case when p ? 'firma'          then excluded.firma          else klienti.firma end,
    stav           = case when p ? 'stav'           then excluded.stav           else klienti.stav end,
    datum_ukonceni = case when p ? 'datum_ukonceni' then excluded.datum_ukonceni else klienti.datum_ukonceni end,
    stav_vztahu    = case when p ? 'stav_vztahu'    then excluded.stav_vztahu    else klienti.stav_vztahu end,
    obchodnik_id   = case when p ? 'obchodnik_id'   then excluded.obchodnik_id   else klienti.obchodnik_id end,
    lead_agent     = case when p ? 'lead_agent'     then excluded.lead_agent     else klienti.lead_agent end,
    ida_url        = case when p ? 'ida_url'        then excluded.ida_url        else klienti.ida_url end,
    email          = case when p ? 'onboarding'     then excluded.email          else klienti.email end,
    telefon        = case when p ? 'onboarding'     then excluded.telefon        else klienti.telefon end,
    onboarding     = case when p ? 'onboarding'     then excluded.onboarding     else klienti.onboarding end,
    poradce        = case when p ? 'poradce'        then excluded.poradce        else klienti.poradce end,
    upraveno       = excluded.upraveno,
    upravil        = excluded.upravil;

  -- Podřízené záznamy: smazat a založit znovu z došlého stavu.
  -- Klient je vždy posílán celý, takže je to jednodušší i bezpečnější
  -- než párovat rozdíly. Historie fází se přenáší také celá.
  -- Podřízené seznamy se přebudují jen tehdy, když je volající poslal.
  -- Chybějící klíč znamená „neřeším", ne „smaž vše".
  if p ? 'oblasti'   then delete from oblasti   where klient_id = v_id; end if;
  if p ? 'komentare' then delete from komentare where klient_id = v_id; end if;
  if p ? 'schuzky'   then delete from schuzky   where klient_id = v_id; end if;
  if p ? 'cile'      then delete from cile      where klient_id = v_id; end if;

  for v_o in select * from jsonb_array_elements(coalesce(p->'oblasti', '[]'::jsonb))
  loop
    insert into oblasti (klient_id, klic, stav, faze, poznamka)
    values (v_id, v_o->>'klic', coalesce(v_o->>'stav', ''),
            coalesce(v_o->>'faze', ''), coalesce(v_o->>'poznamka', ''))
    returning id into v_oblast_id;

    for v_polozka in select * from jsonb_array_elements(coalesce(v_o->'polozky', '[]'::jsonb))
    loop
      insert into oblasti_polozky (oblast_id, typ, instituce, mesicni_platba, poznamka)
      values (v_oblast_id, coalesce(v_polozka->>'typ', ''), coalesce(v_polozka->>'instituce', ''),
              coalesce(v_polozka->>'mesicni_platba', ''), coalesce(v_polozka->>'poznamka', ''));
    end loop;

    for v_h in select * from jsonb_array_elements(coalesce(v_o->'faze_historie', '[]'::jsonb))
    loop
      insert into faze_historie (oblast_id, faze, kdy, kdo)
      values (v_oblast_id, coalesce(v_h->>'faze', ''),
              coalesce(nullif(v_h->>'kdy', '')::timestamptz, now()), coalesce(v_h->>'kdo', ''));
    end loop;
  end loop;

  for v_zaznam in select * from jsonb_array_elements(coalesce(p->'komentare', '[]'::jsonb))
  loop
    insert into komentare (klient_id, text, autor_id, kdy)
    values (v_id, coalesce(v_zaznam->>'text', ''), nullif(v_zaznam->>'autor_id', '')::uuid,
            coalesce(nullif(v_zaznam->>'kdy', '')::timestamptz, now()));
  end loop;

  for v_zaznam in select * from jsonb_array_elements(coalesce(p->'schuzky', '[]'::jsonb))
  loop
    insert into schuzky (id, klient_id, datum, typ, kdo, souhrn, odkaz, zdroj, plaud_file_id)
    values (coalesce(nullif(v_zaznam->>'id', '')::uuid, gen_random_uuid()), v_id,
            nullif(v_zaznam->>'datum', '')::date, coalesce(v_zaznam->>'typ', ''),
            nullif(v_zaznam->>'kdo', '')::uuid, coalesce(v_zaznam->>'souhrn', ''),
            coalesce(v_zaznam->>'odkaz', ''), coalesce(nullif(v_zaznam->>'zdroj', ''), 'rucni'),
            coalesce(v_zaznam->>'plaud_file_id', ''));
  end loop;

  for v_zaznam in select * from jsonb_array_elements(coalesce(p->'cile', '[]'::jsonb))
  loop
    insert into cile (klient_id, cil, castka, termin, stav)
    values (v_id, coalesce(v_zaznam->>'cil', ''), coalesce(v_zaznam->>'castka', ''),
            coalesce(v_zaznam->>'termin', ''), coalesce(nullif(v_zaznam->>'stav', ''), 'aktivní'));
  end loop;

  return v_nove;
end;
$$;

comment on function save_klient(jsonb) is
  'Uloží celého klienta v jedné transakci. Vrací nové `upraveno`, které si klient uloží pro další zámek.';
