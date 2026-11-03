-- 3/11/2026 : recherche d'activité insensible aux accents, apostrophes (’ ou ') et tirets.
-- Nouvelle colonne calculée lm_categories.search_key (4 053 lignes, réécriture instantanée). Compatible avec le
-- code en ligne : rien ne la lit encore, et le chargement du catalogue liste ses colonnes (inchangé).

alter table "public"."lm_categories" add column "search_key" text generated always as (btrim(regexp_replace(translate(replace(replace(lower(((label_fr || ' '::text) || label_en)), 'œ'::text, 'oe'::text), 'æ'::text, 'ae'::text), 'àâäáãåāçéèêëēíìîïñóòôöõøúùûüūýÿğ’‘`´''-'::text, 'aaaaaaaceeeeeiiiinoooooouuuuuyyg      '::text), '\s+'::text, ' '::text, 'g'::text))) stored;


