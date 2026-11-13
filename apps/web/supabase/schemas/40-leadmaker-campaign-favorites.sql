/*
 * -------------------------------------------------------
 * Prospectigo : campagnes favorites (13/11/2026, demande de Gabriel)
 * Chaque membre épingle ses campagnes : elles restent en haut de la liste des campagnes. Favoris personnels
 * (un membre ne voit ni ne change ceux des autres). Lecture / écriture par l'appli, sous RLS.
 * -------------------------------------------------------
 */
create table if not exists public.lm_campaign_favorites (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.lm_campaigns(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, campaign_id)
);

comment on table public.lm_campaign_favorites is 'Campagnes épinglées en haut de la liste, par membre';

alter table "public"."lm_campaign_favorites" enable row level security;

revoke all on public.lm_campaign_favorites from anon, authenticated, service_role;

grant select, insert, delete on table public.lm_campaign_favorites to service_role;

-- pas d'update : on ajoute ou on retire un favori
grant select, insert, delete on table public.lm_campaign_favorites to authenticated;

create index if not exists ix_lm_campaign_favorites_campaign_id
  on public.lm_campaign_favorites (campaign_id);

create index if not exists ix_lm_campaign_favorites_account_id
  on public.lm_campaign_favorites (account_id);

create policy "lm_campaign_favorites_read" on public.lm_campaign_favorites for select
  to authenticated using (user_id = (select auth.uid()) and public.has_role_on_account(account_id));

-- seulement pour soi, sur une campagne de son équipe (account_id = celui de la campagne)
create policy "lm_campaign_favorites_insert" on public.lm_campaign_favorites for insert
  to authenticated with check (
    user_id = (select auth.uid())
    and public.has_role_on_account(account_id)
    and exists (
      select 1 from public.lm_campaigns c
       where c.id = campaign_id and c.account_id = lm_campaign_favorites.account_id
    )
  );

create policy "lm_campaign_favorites_delete" on public.lm_campaign_favorites for delete
  to authenticated using (user_id = (select auth.uid()));

create policy "restrict_mfa_lm_campaign_favorites" on public.lm_campaign_favorites
  as restrictive to authenticated using (public.is_mfa_compliant());
