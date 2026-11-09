-- Lien campagne ↔ entreprise : copie des liens existants, dans un fichier à part (sa propre transaction) pour
-- que les verrous pris par la création de la table (clés étrangères vers lm_prospects, lm_campaigns…) soient
-- relâchés avant cette copie de ~213 000 lignes (≈ 10 s en local) : robots et clients ne sont pas bloqués.
-- Données existantes : chaque prospect est lié à la campagne qui l'a trouvé, avec les crédits débités à ce
-- moment-là (journal des crédits, « prospect:<id> »). Les prospects importés sans campagne n'ont pas de lien.
insert into public.lm_campaign_prospects (campaign_id, prospect_id, account_id, space_id, credits, created_at)
select p.campaign_id, p.id, p.account_id, p.space_id, coalesce(greatest(-l.delta, 0), 0), p.created_at
  from public.lm_prospects p
  join public.lm_campaigns c on c.id = p.campaign_id and c.space_id = p.space_id and c.account_id = p.account_id
  left join public.lm_credit_ledger l on l.event_ref = 'prospect:' || p.id::text
on conflict (campaign_id, prospect_id) do nothing;
