-- Forfaits (décision de Gabriel, 1/11/2026) : plus de limite de dossiers clients (trop compliqué à
-- comprendre), sièges 1 / 3 / 6, Scale limité à 10 campagnes actives.
-- `spaces` reste obligatoire dans la table : un plafond très haut la neutralise.
update public.lm_plans set seats = 1, spaces = 1000                         where id = 'growth';
update public.lm_plans set seats = 3, spaces = 1000                         where id = 'business';
update public.lm_plans set seats = 6, spaces = 1000, active_campaigns = 10  where id = 'scale';
