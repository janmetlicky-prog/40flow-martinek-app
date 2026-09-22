-- 006_lead_agent_boolean.sql — lead_agent je příznak, ne osoba
--
-- Lead Agent je externí portál (hromadné SMS/e-maily, landing pages).
-- Pole znamená „je tento klient nahraný v Lead Agentu?" — ANO/NE.
-- Původně bylo omylem modelováno jako odkaz na uživatele.

alter table klienti drop constraint if exists klienti_lead_agent_fkey;
alter table klienti alter column lead_agent drop default;
alter table klienti alter column lead_agent type boolean
  using (lead_agent is not null);   -- žádný řádek nemohl mít platnou hodnotu; převod níže
alter table klienti alter column lead_agent set default false;
update klienti set lead_agent = false where lead_agent is null;
alter table klienti alter column lead_agent set not null;

-- Převod z pomocného pole, kam seed ukládal původní hodnotu z Excelu („Ano").
update klienti
   set lead_agent = lower(coalesce(poradce->>'lead_agent_puvodni', '')) in ('ano', 'yes', 'true', '1'),
       poradce    = poradce - 'lead_agent_puvodni'
 where poradce ? 'lead_agent_puvodni';

comment on column klienti.lead_agent is 'Je klient nahraný v Lead Agentu (externí portál pro SMS/e-maily/landing pages)?';
