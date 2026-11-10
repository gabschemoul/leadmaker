-- Recherche de la page Prospects (« contient », sur nom, adresse, site, téléphone) : index trigrammes, sinon la
-- base relit toutes les fiches de l'espace à chaque recherche (8 s mesurées le 10/11/2026 sur 228 000 fiches).
-- Ajout seul : compatible avec le code de main. Construction de quelques secondes ; les écritures des robots sur
-- lm_prospects attendent la fin (pas de perte).
create extension if not exists pg_trgm schema extensions;

create index if not exists ix_lm_prospects_name_trgm on public.lm_prospects
  using gin (name extensions.gin_trgm_ops);

create index if not exists ix_lm_prospects_address_trgm on public.lm_prospects
  using gin (address extensions.gin_trgm_ops);

create index if not exists ix_lm_prospects_site_key_trgm on public.lm_prospects
  using gin (site_key extensions.gin_trgm_ops);

create index if not exists ix_lm_prospects_phone_trgm on public.lm_prospects
  using gin (phone extensions.gin_trgm_ops);
