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
    nullif(p->>'lead_agent', '')::uuid,
    coalesce(p->>'ida_url', ''),
    -- email/telefon jsou ODVOZENÉ z onboarding jsonb — jediná cesta zápisu
    coalesce(p->'onboarding'->>'email', ''),
    coalesce(p->'onboarding'->>'telefon', ''),
    coalesce(p->'onboarding', '{}'::jsonb),
    coalesce(p->'poradce', '{}'::jsonb),
    v_nove,
    coalesce(p->>'upravil', '')
  )
  on conflict (id) do update set
    jmeno          = excluded.jmeno,
    prijmeni       = excluded.prijmeni,
    firma          = excluded.firma,
    stav           = excluded.stav,
    datum_ukonceni = excluded.datum_ukonceni,
    stav_vztahu    = excluded.stav_vztahu,
    obchodnik_id   = excluded.obchodnik_id,
    lead_agent     = excluded.lead_agent,
    ida_url        = excluded.ida_url,
    email          = excluded.email,
    telefon        = excluded.telefon,
    onboarding     = excluded.onboarding,
    poradce        = excluded.poradce,
    upraveno       = excluded.upraveno,
    upravil        = excluded.upravil;

  -- Podřízené záznamy: smazat a založit znovu z došlého stavu.
  -- Klient je vždy posílán celý, takže je to jednodušší i bezpečnější
  -- než párovat rozdíly. Historie fází se přenáší také celá.
  delete from oblasti   where klient_id = v_id;
  delete from komentare where klient_id = v_id;
  delete from schuzky   where klient_id = v_id;
  delete from cile      where klient_id = v_id;

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
