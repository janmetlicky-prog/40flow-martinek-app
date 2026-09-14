-- 005_grants.sql — oprávnění na úrovni tabulek
--
-- POZOR na rozdíl, na kterém se dá snadno naletět:
-- RLS politika říká, KTERÉ ŘÁDKY role uvidí. Grant říká, jestli na tabulku
-- vůbec smí sáhnout. Bez grantu vrátí server „permission denied" i když
-- jsou politiky nastavené správně — politiky se v tu chvíli ani nevyhodnotí.
--
-- Role `anon` (nepřihlášený návštěvník s veřejným klíčem) nedostává nic.
-- Role `authenticated` dostává přístup k tabulkám a řádky jí ořežou politiky.

grant usage on schema public to authenticated;

grant select, insert, update, delete
  on all tables in schema public to authenticated;

grant execute on all functions in schema public to authenticated;

-- Pohled pro přehled klientů
grant select on klienti_prehled to authenticated;

-- Nepřihlášený nesmí nic. Explicitně, ať to nezávisí na výchozím nastavení.
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;

-- Totéž pro tabulky vytvořené v budoucnu
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant execute on functions to authenticated;
