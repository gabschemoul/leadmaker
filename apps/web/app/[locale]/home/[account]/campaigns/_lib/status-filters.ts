/**
 * Pastilles de statut de la page Campagnes, dans l'ordre d'affichage. Fichier à part (ni serveur ni client) :
 * une valeur exportée d'un fichier 'use client' n'est pas lisible côté serveur (erreur 500 du 10/11/2026).
 */
import type { Database } from '~/lib/database.types';

type CampaignStatus = Database['public']['Enums']['lm_campaign_status'];

export const STATUS_FILTERS: CampaignStatus[] = [
  'running',
  'paused',
  'draft',
  'completed',
  'archived',
];
