/*
 * -------------------------------------------------------
 * Section: LeadMaker enums
 * Types partagés par les tables métier LeadMaker (préfixe lm_).
 * -------------------------------------------------------
 */
create type public.lm_credit_kind as enum ('discovery', 'outreach');

create type public.lm_campaign_status as enum ('draft', 'running', 'paused', 'completed', 'archived');

create type public.lm_prospect_source as enum ('maps', 'csv');

-- Cycle de vie d'une tentative (cahier des charges, section 5)
create type public.lm_attempt_status as enum (
  'pending',               -- en attente
  'preparing',             -- en préparation
  'ready',                 -- prête
  'incomplete',            -- à compléter
  'intervention_required', -- captcha / intervention requise
  'no_form',               -- pas de formulaire
  'unreachable',           -- inaccessible
  'validated',             -- validée
  'sending',               -- en envoi
  'sent',                  -- envoyée
  'to_verify',             -- à vérifier
  'failed',                -- échec
  'skipped',               -- passée
  'excluded'               -- exclue
);

create type public.lm_reply_kind as enum ('interested', 'not_interested', 'question', 'stop', 'other');

create type public.lm_reply_source as enum ('manual', 'email');

create type public.lm_task_kind as enum ('discovery', 'prepare', 'send', 'dummy');

create type public.lm_task_status as enum ('queued', 'running', 'done', 'failed', 'cancelled');

create type public.lm_coverage_tier as enum ('verified', 'standard');
