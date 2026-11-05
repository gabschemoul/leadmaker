'use server';

import * as z from 'zod';

import { getMailer } from '@kit/mailers';
import { publicActionClient } from '@kit/next/safe-action';

import { ContactEmailSchema } from '../contact-email.schema';

const contactEmail = z
  .string({
    error:
      'Contact email is required. Please use the environment variable CONTACT_EMAIL.',
  })
  .parse(process.env.CONTACT_EMAIL);

const emailFrom = z
  .string({
    error:
      'Sender email is required. Please use the environment variable EMAIL_SENDER.',
  })
  .parse(process.env.EMAIL_SENDER);

export const sendContactEmail = publicActionClient
  .inputSchema(ContactEmailSchema)
  .action(async ({ parsedInput: data }) => {
    // Piège à robots rempli : on fait comme si tout s'était bien passé, sans rien envoyer
    if (data.website) {
      return {};
    }

    const mailer = await getMailer();

    // Audit 5/11/2026 (B3) : champs échappés, pour ne jamais injecter de HTML (liens piégés, images
    // espionnes) dans la boîte de l'équipe.
    await mailer.sendEmail({
      to: contactEmail,
      from: emailFrom,
      subject: `Prospectigo — message de ${data.name.slice(0, 80)}`,
      html: `
        <p>Nouveau message depuis le formulaire de contact de prospectigo.com.</p>

        <p>Nom : ${escapeHtml(data.name)}</p>
        <p>E-mail : ${escapeHtml(data.email)}</p>
        <p>Message :</p>
        <p style="white-space: pre-wrap">${escapeHtml(data.message)}</p>
      `,
    });

    return {};
  });

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
