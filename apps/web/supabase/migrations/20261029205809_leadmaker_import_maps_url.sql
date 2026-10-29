set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_import_prospects(p_space_id uuid, p_rows jsonb)
 RETURNS TABLE(inserted integer, duplicates integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_country text;
  v_total integer;
  v_inserted integer;
begin
  select account_id, country_code into v_account_id, v_country from public.lm_spaces where id = p_space_id;

  if v_account_id is null or not public.has_role_on_account(v_account_id) then
    raise exception 'space not found' using errcode = 'P0002';
  end if;

  v_total := jsonb_array_length(p_rows);

  if v_total > 20000 then
    raise exception 'too many rows' using errcode = 'P0001', hint = 'too_many_rows';
  end if;

  with src as (
    select distinct on (r ->> 'site_key') r
      from jsonb_array_elements(p_rows) r
     where length(trim(coalesce(r ->> 'site_key', ''))) > 0 and length(trim(coalesce(r ->> 'name', ''))) > 0
  ), ins as (
    insert into public.lm_prospects (account_id, space_id, name, category, phone, website, site_key, found_email,
                                     address, country_code, maps_url, source)
    select v_account_id, p_space_id, left(r ->> 'name', 500), left(r ->> 'category', 255), left(r ->> 'phone', 50),
           left(r ->> 'website', 1000), lower(r ->> 'site_key'), left(r ->> 'email', 320), r ->> 'address',
           coalesce(nullif(upper(r ->> 'country_code'), ''), v_country), left(r ->> 'maps_url', 1000), 'csv'
      from src
    on conflict (space_id, site_key) do nothing
    returning 1
  )
  select count(*) into v_inserted from ins;

  return query select v_inserted, v_total - v_inserted;
end;
$function$
;


