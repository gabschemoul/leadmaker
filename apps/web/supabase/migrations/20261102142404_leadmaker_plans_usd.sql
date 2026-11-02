-- Forfaits décidés par Gabriel le 2/11/2026 (ROADMAP.md, « Coûts et marges ») :
-- - facturation en dollars (billing.config.ts), volumes mensuels Growth 30 000 / 15 000,
--   Business 80 000 / 40 000, Scale 200 000 / 100 000 (crédits de prospection / prises de contact) ;
-- - AUCUN plafond de prises de contact par jour au niveau du forfait : la colonne lm_plans.daily_send_limit
--   disparaît et lm_queue_sends ne regarde plus que la limite quotidienne réglée par campagne (daily_limit)
--   et le crédit mensuel de l'organisation.
-- Les soldes déjà crédités (lm_account_credits) ne changent pas : les nouveaux volumes s'appliquent à la
-- prochaine recharge (lm_reset_credits : renouvellement Stripe ou attribution manuelle).
alter table "public"."lm_plans" drop column "daily_send_limit";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_queue_sends()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_queued integer := 0;
  r record;
  v_balance integer;
  v_campaign_today integer;
begin
  -- Envois interrompus
  update public.lm_attempts a
     set status = 'to_verify', sent_at = coalesce(sent_at, now()),
         detail = 'envoi interrompu (robot arrêté) : vérifiez sur le site si le message est parti'
   where a.status = 'sending' and a.updated_at < now() - interval '20 minutes';

  for r in
    select a.id, a.account_id, a.campaign_id, c.daily_limit
      from public.lm_attempts a
      join public.lm_campaigns c on c.id = a.campaign_id
     where a.status = 'validated'
       and not exists (select 1 from public.lm_tasks t
                        where t.kind = 'send' and t.status in ('queued', 'running')
                          and t.payload ->> 'attempt_id' = a.id::text)
     order by a.validated_at
  loop
    select coalesce(cr.outreach_balance, 0) into v_balance
      from public.lm_account_credits cr
     where cr.account_id = r.account_id;

    if v_balance is null or v_balance <= 0 then
      continue;
    end if;

    v_campaign_today := public.lm_sends_today(r.campaign_id) + (
      select count(*)::integer from public.lm_tasks t
        join public.lm_attempts a2 on a2.id::text = t.payload ->> 'attempt_id'
       where t.kind = 'send' and t.status = 'queued' and a2.campaign_id = r.campaign_id);

    if v_campaign_today >= r.daily_limit then
      continue;
    end if;

    insert into public.lm_tasks (account_id, kind, payload, idempotency_key, max_attempts)
    values (r.account_id, 'send', jsonb_build_object('attempt_id', r.id),
            'send:' || r.id::text || ':' || extract(epoch from clock_timestamp())::bigint::text, 1)
    on conflict (idempotency_key) do nothing;

    v_queued := v_queued + 1;
  end loop;

  return v_queued;
end;
$function$
;


update public.lm_plans set discovery_credits = 30000,  outreach_credits = 15000  where id = 'growth';
update public.lm_plans set discovery_credits = 80000,  outreach_credits = 40000  where id = 'business';
update public.lm_plans set discovery_credits = 200000, outreach_credits = 100000 where id = 'scale';
