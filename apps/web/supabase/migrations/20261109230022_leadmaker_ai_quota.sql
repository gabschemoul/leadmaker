
  create table "public"."lm_ai_usage" (
    "account_id" uuid not null,
    "day" date not null,
    "kind" text not null,
    "used" integer not null default 0
      );


alter table "public"."lm_ai_usage" enable row level security;

CREATE UNIQUE INDEX lm_ai_usage_pkey ON public.lm_ai_usage USING btree (account_id, day, kind);

alter table "public"."lm_ai_usage" add constraint "lm_ai_usage_pkey" PRIMARY KEY using index "lm_ai_usage_pkey";

alter table "public"."lm_ai_usage" add constraint "lm_ai_usage_account_id_fkey" FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE not valid;

alter table "public"."lm_ai_usage" validate constraint "lm_ai_usage_account_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_take_ai_quota(p_account_id uuid, p_kind text, p_limit integer)
 RETURNS TABLE(allowed boolean, remaining integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_used integer;
begin
  if not public.lm_member(p_account_id) then
    raise exception 'account not found' using errcode = 'P0002';
  end if;

  insert into public.lm_ai_usage as u (account_id, day, kind, used)
  values (p_account_id, (now() at time zone 'utc')::date, left(p_kind, 40), 1)
  on conflict (account_id, day, kind) do update set used = u.used + 1
    where u.used < greatest(p_limit, 0)
  returning u.used into v_used;

  if v_used is null then
    return query select false, 0;
  else
    return query select true, greatest(p_limit - v_used, 0);
  end if;
end;
$function$
;

grant delete on table "public"."lm_ai_usage" to "service_role";

grant insert on table "public"."lm_ai_usage" to "service_role";

grant select on table "public"."lm_ai_usage" to "service_role";

grant update on table "public"."lm_ai_usage" to "service_role";



-- Écrit à la main (db diff ne les génère pas) : droits
revoke all on public.lm_ai_usage from anon, authenticated, service_role;
grant select, insert, update, delete on table public.lm_ai_usage to service_role;
revoke all on function public.lm_take_ai_quota(uuid, text, integer) from public;
grant execute on function public.lm_take_ai_quota(uuid, text, integer) to authenticated, service_role;
