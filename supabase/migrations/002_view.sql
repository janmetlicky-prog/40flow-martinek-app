-- 002_view.sql — pohled nahrazující dřívější index.json
--
-- Dashboard čte pro přehled jen tento pohled: jeden dotaz místo N souborů.
-- rebuildIndex() proto v Supabase implementaci nic nedělá — pohled se
-- nemůže rozejít s daty, počítá se při každém dotazu.

create or replace view klienti_prehled as
select
  k.id,
  k.jmeno,
  k.prijmeni,
  k.firma,
  k.stav,
  k.stav_vztahu,
  k.datum_ukonceni,
  k.email,
  k.telefon,
  k.obchodnik_id,
  u.jmeno as obchodnik,
  coalesce(
    -- `polozek` slouží k označení oblasti, kam klient něco poslal, ale
    -- poradce ji ještě nezařadil (stav prázdný + položky > 0).
    (select jsonb_object_agg(o.klic, jsonb_build_object(
              'stav', o.stav,
              'faze', o.faze,
              'polozek', (select count(*) from oblasti_polozky p where p.oblast_id = o.id)))
       from oblasti o
      where o.klient_id = k.id),
    '{}'::jsonb
  ) as oblasti,
  k.upraveno,
  k.upravil
from klienti k
left join uzivatele u on u.id = k.obchodnik_id;

comment on view klienti_prehled is 'Souhrn pro tabulku přehledu klientů. Nahrazuje index.json z GitHub prototypu.';
