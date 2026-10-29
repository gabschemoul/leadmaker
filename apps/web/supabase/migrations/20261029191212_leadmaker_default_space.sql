drop policy "lm_spaces_delete" on "public"."lm_spaces";

alter table "public"."lm_spaces" add column "is_default" boolean not null default false;

alter table "public"."lm_spaces" alter column "country_code" drop not null;

CREATE UNIQUE INDEX ux_lm_spaces_default_per_account ON public.lm_spaces USING btree (account_id) WHERE is_default;

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_create_default_space()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not new.is_personal_account then
    insert into public.lm_spaces (account_id, name, is_default)
    values (new.id, 'Default', true)
    on conflict do nothing;
  end if;

  return new;
end;
$function$
;


  create policy "lm_spaces_delete"
  on "public"."lm_spaces"
  as permissive
  for delete
  to authenticated
using (((NOT is_default) AND public.has_permission(( SELECT auth.uid() AS uid), account_id, 'settings.manage'::public.app_permissions)));


CREATE TRIGGER lm_accounts_create_default_space AFTER INSERT ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.lm_create_default_space();



-- ---------------------------------------------------------------- reprise des organisations existantes
-- Organisation qui a déjà des espaces : le plus ancien devient l'espace par défaut.
update public.lm_spaces s set is_default = true
 where s.id in (
   select distinct on (account_id) id from public.lm_spaces order by account_id, created_at, id
 )
   and not exists (select 1 from public.lm_spaces d where d.account_id = s.account_id and d.is_default);

-- Organisation sans espace : on lui crée son espace par défaut.
insert into public.lm_spaces (account_id, name, is_default)
select a.id, 'Default', true
  from public.accounts a
 where not a.is_personal_account
   and not exists (select 1 from public.lm_spaces s where s.account_id = a.id);
