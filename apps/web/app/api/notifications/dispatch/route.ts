import {
  type NotificationEmailKind,
  renderNotificationEmail,
} from '@kit/email-templates';
import { getMailer } from '@kit/mailers';
import { enhanceRouteHandler } from '@kit/next/routes';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import appConfig from '~/config/app.config';

/**
 * Envoi des notifications e-mail Prospectigo (5/11/2026).
 *
 * Appelée toutes les 5 minutes par Vercel Cron (apps/web/vercel.json, production seulement) avec
 * `Authorization: Bearer $CRON_SECRET`. Réclame les événements posés par les déclencheurs SQL
 * (lm_claim_notifications, schéma 35), envoie un e-mail par destinataire dans sa langue, puis clôt
 * chaque événement (lm_finish_notification ; un échec est retenté au plus 3 fois).
 * Destinataires des événements internes (admin_*) : ADMIN_NOTIFICATION_EMAILS (virgules), sinon CONTACT_EMAIL.
 */
type Recipient = { email: string; language: string };

type ClaimedNotification = {
  id: number;
  kind: string;
  account_slug: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  payload: Record<string, unknown>;
  recipients: Recipient[];
};

export const GET = enhanceRouteHandler(
  async ({ request }) => {
    const secret = process.env.CRON_SECRET;

    if (!secret) {
      return new Response('CRON_SECRET not configured', { status: 503 });
    }

    if (request.headers.get('authorization') !== `Bearer ${secret}`) {
      return new Response('Unauthorized', { status: 401 });
    }

    const logger = await getLogger();
    const client = getSupabaseServerAdminClient();

    const { data, error } = await client.rpc('lm_claim_notifications', {
      p_limit: 50,
    });

    if (error) {
      logger.error({ name: 'notifications.claim', error }, 'Claim failed');

      return new Response('Claim failed', { status: 500 });
    }

    const mailer = await getMailer();
    const from = process.env.EMAIL_SENDER ?? '';
    let sent = 0;
    let failed = 0;

    for (const notification of (data ??
      []) as unknown as ClaimedNotification[]) {
      try {
        // crédit unique (9/11) : l'ancien solde de prise de contact n'existe plus pour le client ;
        // une alerte « crédits bas » le concernant est close sans e-mail
        const recipients = isObsoleteNotification(notification)
          ? []
          : notification.kind.startsWith('admin_')
            ? adminRecipients()
            : notification.recipients;

        for (const recipient of recipients) {
          const email = await buildEmail(notification, recipient.language);

          await mailer.sendEmail({
            to: recipient.email,
            from,
            subject: email.subject,
            html: email.html,
          });

          sent += 1;
        }

        await client.rpc('lm_finish_notification', {
          p_id: notification.id,
          p_ok: true,
        });
      } catch (sendError) {
        failed += 1;

        logger.error(
          {
            name: 'notifications.send',
            id: notification.id,
            kind: notification.kind,
            error: sendError,
          },
          'Notification email failed',
        );

        await client.rpc('lm_finish_notification', {
          p_id: notification.id,
          p_ok: false,
          p_error: String(sendError).slice(0, 500),
        });
      }
    }

    return Response.json({ claimed: data?.length ?? 0, sent, failed });
  },
  { auth: false },
);

function isObsoleteNotification(notification: ClaimedNotification) {
  return (
    notification.kind === 'credits_low' &&
    notification.payload?.credit === 'outreach'
  );
}

function adminRecipients(): Recipient[] {
  const raw =
    process.env.ADMIN_NOTIFICATION_EMAILS ?? process.env.CONTACT_EMAIL ?? '';

  return raw
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean)
    .map((email) => ({ email, language: 'fr' }));
}

/** Type d'e-mail, textes et lien du bouton pour un événement. */
async function buildEmail(notification: ClaimedNotification, language: string) {
  const lang = language.startsWith('en') ? 'en' : 'fr';
  const numbers = new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US');
  const dates = new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : 'en-US', {
    dateStyle: 'long',
  });

  const payload = notification.payload ?? {};
  const base = appConfig.url.replace(/\/$/, '');
  const team = notification.account_slug
    ? `${base}/home/${notification.account_slug}`
    : base;
  const campaignUrl = notification.campaign_id
    ? `${team}/campaigns/${notification.campaign_id}`
    : `${team}/campaigns`;

  const count = (key: string) => numbers.format(Number(payload[key] ?? 0));
  const date = (key: string) =>
    payload[key] ? dates.format(new Date(String(payload[key]))) : '—';
  const text = (key: string) => String(payload[key] ?? '');

  const campaign = notification.campaign_name ?? '';

  let kind: NotificationEmailKind;
  let values: Record<string, string | number> = { campaign };
  let ctaUrl = `${team}`;

  switch (notification.kind) {
    case 'autopilot_preview_ready':
      kind = 'autopilotPreviewReady';
      values = { campaign, count: count('count') };
      ctaUrl = `${campaignUrl}?etape=contacter`;
      break;
    case 'autopilot_done':
      kind =
        payload.reason === 'target'
          ? 'autopilotDoneTarget'
          : 'autopilotDoneEmpty';
      values = { campaign, sent: count('sent'), target: count('target') };
      ctaUrl = `${campaignUrl}?etape=contacter`;
      break;
    case 'search_done':
      // campagne triée : les prospects gardés (ceux qui correspondent), pas toutes les fiches trouvées (11/11)
      kind = typeof payload.kept === 'number' ? 'searchDoneKept' : 'searchDone';
      values = {
        campaign,
        prospects:
          typeof payload.kept === 'number' ? count('kept') : count('prospects'),
      };
      ctaUrl = `${campaignUrl}?etape=contacter`;
      break;
    case 'search_no_credits':
      kind = 'searchNoCredits';
      values = { campaign, prospects: count('prospects') };
      ctaUrl = `${team}/billing`;
      break;
    case 'credits_low':
      kind = 'creditsLowDiscovery';
      values = {
        remaining: count('remaining'),
        quota: count('quota'),
        renewal: date('renewal'),
      };
      ctaUrl = `${team}/billing`;
      break;
    case 'admin_signup':
      kind = 'adminSignup';
      values = { email: text('email'), name: text('name') || text('email') };
      ctaUrl = `${base}/admin`;
      break;
    case 'admin_subscription_new':
      kind = 'adminSubscriptionNew';
      values = {
        team: text('team'),
        owner: text('owner'),
        status: text('status'),
      };
      ctaUrl = `${base}/admin`;
      break;
    case 'admin_subscription_canceled':
      kind = 'adminSubscriptionCanceled';
      values = {
        team: text('team'),
        owner: text('owner'),
        endsAt: date('ends_at'),
      };
      ctaUrl = `${base}/admin`;
      break;
    case 'admin_payment_failed':
      kind = 'adminPaymentFailed';
      values = {
        team: text('team'),
        owner: text('owner'),
        status: text('status'),
      };
      ctaUrl = `${base}/admin`;
      break;
    default:
      throw new Error(`unknown notification kind ${notification.kind}`);
  }

  return renderNotificationEmail({
    kind,
    language: lang,
    productName: appConfig.name,
    values,
    ctaUrl,
    settingsUrl: notification.kind.startsWith('admin_')
      ? undefined
      : `${team}/settings/profile`,
  });
}
