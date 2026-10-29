-- Affichage en direct : prospects trouvés et avancement des campagnes (filtré par la RLS)
alter publication supabase_realtime add table public.lm_prospects;
alter publication supabase_realtime add table public.lm_campaign_categories;
