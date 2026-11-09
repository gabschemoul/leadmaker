'use server';

/**
 * Rôle : « Proposer avec l'IA » sur l'écran « Votre message » (CDC-PARCOURS-TRI-ANNUAIRE §6) : un message de
 * prise de contact (objet, texte, version courte) rédigé d'après l'offre, la cible, le groupe et 3 entreprises
 * gardées de la campagne.
 * Données : campagne, offre du dossier, entreprises gardées (client Supabase de l'utilisateur, RLS), plafond du jour
 * (lm_take_ai_quota : 30 par organisation), Claude Sonnet (ai.service.ts).
 * Écritures : lm_ai_usage (compteur du plafond). Le message proposé n'est pas enregistré : le client le relit,
 * le modifie et l'enregistre comme d'habitude.
 */
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

import { authActionClient } from '@kit/next/safe-action';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  BODY_MAX,
  SHORT_BODY_MAX,
  SUBJECT_MAX,
} from '~/lib/leadmaker/templates';
import {
  AI_MESSAGE_DAILY_LIMIT,
  AI_WRITER_MODEL,
  aiEnabled,
  getAiClient,
} from '~/lib/server/leadmaker/ai.service';

const ProposeMessageSchema = z.object({
  campaignId: z.string().uuid(),
  /** groupe de la campagne visé par ce message (encart des groupes), facultatif */
  groupKey: z.string().max(60).optional(),
});

const ProposedMessage = z.object({
  subject: z.string(),
  body: z.string(),
  short: z.string(),
});

const SYSTEM = `Tu rédiges un message de prospection B2B qui sera envoyé par le formulaire de contact du site d'entreprises
(pas un e-mail nominatif : on ne connaît pas le prénom de la personne qui le lira).
On te donne l'offre de l'expéditeur, la cible qu'il a décrite, éventuellement le groupe d'entreprises visé, et
quelques exemples réels d'entreprises de cette cible.

Règles :
- Court, naturel, concret, sans jargon ni superlatifs, sans promesse chiffrée inventée. 70 à 120 mots.
- Montre que le message s'adresse à ce type d'entreprise (sans citer les exemples, qui ne sont que des exemples).
- Utilise les variables telles quelles, entre accolades : {company} (nom de l'entreprise contactée), {city} (sa
  ville), {category} (son activité), {my_company} (le nom de l'expéditeur, pour signer). Au moins {company} dans le
  texte, et signe avec {my_company}. N'invente aucune autre variable, aucun nom de personne, aucun lien.
- Termine par une question simple qui appelle une réponse (pas de lien de prise de rendez-vous).
- subject : objet court (moins de 70 caractères). short : version courte du texte (moins de 180 caractères, avec
  {company} et {my_company}) pour les formulaires qui limitent la longueur.
- Écris dans la langue des entreprises contactées (indiquée).`;

export const proposeMessageAction = authActionClient
  .inputSchema(ProposeMessageSchema)
  .action(async ({ parsedInput: { campaignId, groupKey }, ctx }) => {
    if (!aiEnabled()) {
      throw new Error('campaigns.messages.ai.unavailable');
    }

    const client = getSupabaseServerClient();

    const { data: campaign } = await client
      .from('lm_campaigns')
      .select(
        'id, account_id, space_id, country_code, sort_target, sort_groups, sort_version',
      )
      .eq('id', campaignId)
      .maybeSingle();

    if (!campaign) {
      throw new Error('campaigns.messages.ai.failed');
    }

    const [{ data: space }, { data: kept }] = await Promise.all([
      client
        .from('lm_spaces')
        .select('offer')
        .eq('id', campaign.space_id)
        .maybeSingle(),
      client
        .from('lm_campaign_prospects')
        .select('reason, group_key, lm_prospects(name, category, city)')
        .eq('campaign_id', campaignId)
        .eq('verdict', 'gardee')
        .eq('sorted_version', campaign.sort_version)
        .order('sorted_at', { ascending: false })
        .limit(groupKey ? 30 : 3),
    ]);

    // Plafond du jour pris APRÈS les lectures : une erreur de lecture ne consomme pas de proposition
    const { data: quota, error: quotaError } = await client
      .rpc('lm_take_ai_quota', {
        p_account_id: campaign.account_id,
        p_kind: 'message',
        p_limit: AI_MESSAGE_DAILY_LIMIT,
      })
      .single();

    if (quotaError || !quota) {
      throw new Error('campaigns.messages.ai.failed');
    }

    if (!quota.allowed) {
      throw new Error('campaigns.messages.ai.quotaReached');
    }

    const examples = (kept ?? [])
      .filter((k) => !groupKey || k.group_key === groupKey)
      .slice(0, 3)
      .map((k) => {
        const p = Array.isArray(k.lm_prospects)
          ? k.lm_prospects[0]
          : k.lm_prospects;

        return `- ${p?.name ?? '?'} (${p?.category ?? '?'}, ${p?.city ?? '?'}) : ${k.reason ?? ''}`;
      })
      .join('\n');

    const groups = Array.isArray(campaign.sort_groups)
      ? (campaign.sort_groups as { key?: string; label?: string }[])
      : [];
    const group = groupKey
      ? groups.find((g) => g.key === groupKey)?.label
      : undefined;

    try {
      const response = await getAiClient().beta.messages.parse({
        model: AI_WRITER_MODEL,
        max_tokens: 4000,
        system: SYSTEM,
        // Refus du modèle (rare) : reprise automatique par un autre modèle, dans la même requête
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: {
          effort: 'medium',
          format: zodOutputFormat(ProposedMessage),
        },
        messages: [
          {
            role: 'user',
            content: [
              `Offre de l'expéditeur : ${space?.offer ?? '(non précisée)'}`,
              `Cible : ${campaign.sort_target ?? '(non précisée)'}`,
              group ? `Groupe visé : ${group}` : '',
              `Pays des entreprises contactées : ${campaign.country_code}`,
              examples
                ? `Exemples d'entreprises de la cible :\n${examples}`
                : '',
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
      });

      const message = response.parsed_output;

      if (response.stop_reason === 'refusal' || !message) {
        throw new Error('refused or empty');
      }

      return {
        subject: message.subject.trim().slice(0, SUBJECT_MAX),
        body: message.body.trim().slice(0, BODY_MAX),
        short: message.short.trim().slice(0, SHORT_BODY_MAX),
        remaining: quota.remaining,
      };
    } catch (error) {
      const logger = await getLogger();
      logger.warn(
        {
          name: 'leadmaker.ai.message',
          error,
          campaignId,
          userId: ctx.user.id,
        },
        'AI message proposal failed',
      );

      throw new Error('campaigns.messages.ai.failed');
    }
  });
