set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_search_prospects(p_space_id uuid, p_query text)
 RETURNS SETOF public.lm_prospects
 LANGUAGE sql
 STABLE SECURITY DEFINER ROWS 2000
 SET search_path TO ''
AS $function$
  select p.*
  from public.lm_prospects p,
       -- texte cherché, jokers LIKE (%, _, \) échappés
       (select '%' || replace(replace(replace(trim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern) q
  where p.space_id = p_space_id
    -- contrôle d'accès évalué une seule fois (pas par fiche)
    and exists (select 1 from public.lm_spaces s where s.id = p_space_id and public.lm_member(s.account_id))
    and length(trim(coalesce(p_query, ''))) > 0
    and (p.name ilike q.pattern or p.address ilike q.pattern or p.site_key ilike q.pattern or p.phone ilike q.pattern);
$function$
;


revoke all on function public.lm_search_prospects(uuid, text) from public;

grant execute on function public.lm_search_prospects(uuid, text) to authenticated, service_role;
