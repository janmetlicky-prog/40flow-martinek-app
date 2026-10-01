-- 010_storage_dokumenty.sql — oprávnění k bucketu `dokumenty`
--
-- Bucket je privátní (založen v dashboardu). Tým čte a nahrává přímo,
-- anon nemá nic, klient výhradně přes edge funkci klient_upload (service role).
-- Smazání souboru smí jen admin — běžné „Smazat" v kartě je měkké (dokumenty.smazano).

drop policy if exists dokumenty_tym_cteni  on storage.objects;
drop policy if exists dokumenty_tym_vklad  on storage.objects;
drop policy if exists dokumenty_tym_uprava on storage.objects;
drop policy if exists dokumenty_admin_mazani on storage.objects;

create policy dokumenty_tym_cteni on storage.objects
  for select to authenticated using (bucket_id = 'dokumenty' and je_tym());
create policy dokumenty_tym_vklad on storage.objects
  for insert to authenticated with check (bucket_id = 'dokumenty' and je_tym());
create policy dokumenty_tym_uprava on storage.objects
  for update to authenticated using (bucket_id = 'dokumenty' and je_tym()) with check (bucket_id = 'dokumenty' and je_tym());
create policy dokumenty_admin_mazani on storage.objects
  for delete to authenticated using (bucket_id = 'dokumenty' and je_admin());

-- Přehled: kolik dokumentů od klienta tým ještě neotevřel
drop view if exists klienti_prehled;
create view klienti_prehled as
select
  k.id, k.jmeno, k.prijmeni, k.firma, k.stav, k.stav_vztahu, k.datum_ukonceni,
  k.email, k.telefon, k.obchodnik_id, u.jmeno as obchodnik,
  coalesce(
    (select jsonb_object_agg(o.klic, jsonb_build_object(
              'stav', o.stav, 'faze', o.faze,
              'polozek', (select count(*) from oblasti_polozky p where p.oblast_id = o.id)))
       from oblasti o where o.klient_id = k.id),
    '{}'::jsonb) as oblasti,
  (select count(*) from dokumenty d
     where d.klient_id = k.id and d.nahral_klient and d.zobrazeno_kdy is null and d.smazano is null) as nove_dokumenty,
  k.upraveno, k.upravil
from klienti k
left join uzivatele u on u.id = k.obchodnik_id;

grant select on klienti_prehled to authenticated, service_role;
