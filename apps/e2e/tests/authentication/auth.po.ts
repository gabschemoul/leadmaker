import test, { Page, expect } from '@playwright/test';

import { AUTH_STATES } from '../utils/auth-state';
import { Mailbox } from '../utils/mailbox';
import { getSupabaseAdminClient } from '../utils/supabase-admin-client';

const MFA_KEY = 'NHOHJVGPO3R3LKVPRMNIYLCDMBHUM2SE';

export class AuthPageObject {
  private readonly page: Page;
  private readonly mailbox: Mailbox;

  static MFA_KEY = MFA_KEY;

  constructor(page: Page) {
    this.page = page;
    this.mailbox = new Mailbox(page);
  }

  static setupSession(user: (typeof AUTH_STATES)[keyof typeof AUTH_STATES]) {
    test.use({ storageState: user });
  }

  goToSignIn(next?: string) {
    return this.page.goto(`/auth/sign-in${next ? `?next=${next}` : ''}`);
  }

  goToSignUp(next?: string) {
    return this.page.goto(`/auth/sign-up${next ? `?next=${next}` : ''}`);
  }

  async signOut() {
    // Scoped to :visible because the route we navigated away from is still
    // mounted at zero size, so these selectors would otherwise match both its
    // chrome and the current page's.
    // Dans une équipe, la déconnexion est dans le menu du compte (pas dans celui de l'équipe)
    const account = this.page.locator(
      '[data-test="account-dropdown-trigger"]:visible',
    );

    const trigger = (await account.count())
      ? account.first()
      : this.page
          .locator('[data-test="workspace-dropdown-trigger"]:visible')
          .first();

    await trigger.click();

    const signOutButton = this.page.locator(
      '[data-test="workspace-sign-out"]:visible, [data-test="account-dropdown-sign-out"]:visible',
    );

    await signOutButton.click();
  }

  async signIn(params: { email: string; password: string }) {
    await this.page.waitForTimeout(100);

    await this.page.fill('input[name="email"]', params.email);
    await this.page.fill('input[name="password"]', params.password);
    await this.page.click('button[type="submit"]');
  }

  async signUp(params: {
    email: string;
    password: string;
    repeatPassword: string;
  }) {
    await this.page.waitForTimeout(100);

    await this.page.fill('input[name="email"]', params.email);
    await this.page.fill('input[name="password"]', params.password);
    await this.page.fill('input[name="repeatPassword"]', params.repeatPassword);

    await this.page.click('button[type="submit"]');
  }

  async submitMFAVerification(key: string) {
    const period = 30;

    const { TOTP } = await import('totp-generator');

    const { otp } = await TOTP.generate(key, {
      period,
    });

    console.log(`OTP ${otp} code`, {
      period,
    });

    await this.page.fill('[data-input-otp]', otp);
    await this.page.click('[data-test="submit-mfa-button"]');
  }

  async visitConfirmEmailLink(
    email: string,
    params: {
      deleteAfter: boolean;
      subject?: string;
    } = {
      deleteAfter: true,
    },
  ) {
    return expect(async () => {
      const res = await this.mailbox.visitMailbox(email, params);

      expect(res).not.toBeNull();
    }).toPass();
  }

  async expectAuthOtpCode(email: string, subject: string) {
    let code = '';

    await expect(async () => {
      code = await this.mailbox.getAuthOtpFromEmail(email, subject);

      expect(code).toMatch(/^\d{6}$/);
    }).toPass();

    return code;
  }

  createRandomEmail() {
    const value = Math.random() * 10000000000000;

    return `${value.toFixed(0)}@makerkit.dev`;
  }

  /**
   * Returns an address whose local part contains uppercase characters, unlike
   * `createRandomEmail` which is digits-only and so can never vary in case.
   * Supabase Auth lowercases emails at sign-up, so any flow that matches a
   * user-supplied address against an authenticated user has to be exercised
   * with mixed case to be meaningful.
   */
  createRandomMixedCaseEmail() {
    const value = Math.random() * 10000000000000;

    return `Case${value.toFixed(0)}.Upper@makerkit.dev`;
  }

  async signUpFlow(path: string) {
    const email = this.createRandomEmail();

    await this.page.goto(`/auth/sign-up?next=${path}`);

    await this.signUp({
      email,
      password: 'password',
      repeatPassword: 'password',
    });

    await this.visitConfirmEmailLink(email);

    return {
      email,
    };
  }

  async updatePassword(password: string) {
    await this.page.fill('[name="password"]', password);
    await this.page.fill('[name="repeatPassword"]', password);
    await this.page.click('[type="submit"]');
  }

  async loginAsSuperAdmin(params: { next?: string }) {
    await this.loginAsUser({
      email: 'super-admin@makerkit.dev',
      next: '/auth/verify',
    });

    // Complete MFA verification
    await this.submitMFAVerification(MFA_KEY);
    await this.page.waitForURL(params.next ?? '/home');
  }

  async bootstrapUser({
    email,
    password,
    name,
  }: {
    email: string;
    password?: string;
    name: string;
  }) {
    const client = getSupabaseAdminClient();

    const { data, error } = await client.auth.admin.createUser({
      email,
      password: password || 'testingpassword',
      email_confirm: true,
      user_metadata: {
        name,
      },
    });

    if (error) {
      throw new Error(`Failed to create user: ${error.message}`);
    }

    return data;
  }

  async loginAsUser(params: {
    email: string;
    password?: string;
    next?: string;
  }) {
    await this.goToSignIn(params.next);

    await this.signIn({
      email: params.email,
      password: params.password || 'testingpassword',
    });

    await this.page.waitForURL(params.next ?? '**/home');
  }
}
