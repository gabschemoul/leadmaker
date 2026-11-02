import * as z from 'zod';

import { renderOtpEmail } from '@kit/email-templates';
import { getMailer } from '@kit/mailers';
import { getLogger } from '@kit/shared/logger';

const EMAIL_SENDER = z
  .string({
    error: 'EMAIL_SENDER is required',
  })
  .min(1)
  .parse(process.env.EMAIL_SENDER);

const PRODUCT_NAME = z
  .string({
    error: 'PRODUCT_NAME is required',
  })
  .min(1)
  .parse(process.env.NEXT_PUBLIC_PRODUCT_NAME);

/**
 * @name createOtpEmailService
 * @description Creates a new OtpEmailService
 * @returns {OtpEmailService}
 */
export function createOtpEmailService() {
  return new OtpEmailService();
}

/**
 * @name OtpEmailService
 * @description Service for sending OTP emails
 */
class OtpEmailService {
  async sendOtpEmail(params: {
    email: string;
    otp: string;
    language?: string;
  }) {
    const logger = await getLogger();
    const { email, otp, language } = params;
    const mailer = await getMailer();

    const { html, subject } = await renderOtpEmail({
      otp,
      productName: PRODUCT_NAME,
      language,
    });

    try {
      logger.info({ email }, 'Sending OTP email...');

      await mailer.sendEmail({
        to: email,
        subject,
        html,
        from: EMAIL_SENDER,
      });

      logger.info({ email }, 'OTP email sent');
    } catch (error) {
      logger.error({ email, error }, 'Error sending OTP email');

      throw error;
    }
  }
}
