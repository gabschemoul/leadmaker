-- Page Facturation, carte « Vos crédits » (10/11/2026) : consommation des 30 derniers jours en lecture d'index
-- seule et sans règle d'accès évaluée ligne par ligne (2,5 s → ~0,1 s). Mêmes colonnes et mêmes résultats :
-- compatible avec le code de main.

-- Consommation de la page Facturation (lm_credit_usage, 10/11/2026) : lecture d'index seule, sans relire le journal
-- (226 000 lignes en 30 jours pour une seule organisation)
create index if not exists ix_lm_credit_ledger_usage
  on public.lm_credit_ledger (account_id, created_at) include (campaign_id, kind, delta);

-- Consommation des crédits par jour et par campagne (page Facturation, audit E23). Appelant : appli.
-- Sécurité : security definer (10/11/2026 : la règle d'accès évaluée sur chaque ligne du journal coûtait 2,5 s) ;
-- l'appartenance est vérifiée une fois avec lm_member(p_account_id) : sinon aucune ligne. Le journal est d'abord
-- agrégé (index ix_lm_credit_ledger_usage), le nom des campagnes ajouté ensuite sur ~30 lignes.
create or replace function public.lm_credit_usage(p_account_id uuid, p_days integer default 30)
returns table (day date, campaign_id uuid, campaign_name text, kind public.lm_credit_kind, used integer, added integer)
set search_path = ''
language sql
stable
security definer
as $$
  select d.day, d.campaign_id, c.name::text, d.kind, d.used, d.added
    from (select (l.created_at at time zone 'UTC')::date as day, l.campaign_id, l.kind,
                 coalesce(sum(-l.delta) filter (where l.delta < 0), 0)::integer as used,
                 coalesce(sum(l.delta) filter (where l.delta > 0), 0)::integer as added
            from public.lm_credit_ledger l
           where l.account_id = p_account_id
             and public.lm_member(p_account_id)
             and l.created_at > now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365))
           group by 1, 2, 3) d
    left join public.lm_campaigns c on c.id = d.campaign_id and c.account_id = p_account_id
   order by 1 desc, 3 nulls first, 4;
$$;

revoke all on function public.lm_credit_usage(uuid, integer) from public;

grant execute on function public.lm_credit_usage(uuid, integer) to authenticated, service_role;
