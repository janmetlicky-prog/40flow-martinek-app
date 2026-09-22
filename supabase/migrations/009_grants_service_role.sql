-- 009_grants_service_role.sql — oprávnění pro service_role
--
-- Edge funkce běží pod service klíčem (role service_role). Tabulky vznikly
-- migracemi přes Management API (jako postgres), takže výchozí granty pro
-- service_role se na ně nevztahují — funkce dostávaly „permission denied"
-- a klient viděl „neplatný odkaz" i s platným tokenem. RLS service_role
-- obchází, ale grant na tabulku mít musí.

grant usage on schema public to service_role;
grant all on all tables    in schema public to service_role;
grant all on all functions in schema public to service_role;
grant all on all sequences in schema public to service_role;

alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on functions to service_role;
alter default privileges in schema public grant all on sequences to service_role;
