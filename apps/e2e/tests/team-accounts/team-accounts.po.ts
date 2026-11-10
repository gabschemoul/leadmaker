import { Page, expect } from '@playwright/test';

import { AuthPageObject } from '../authentication/auth.po';
import { OtpPo } from '../utils/otp.po';

/**
 * Where a user without a personal dashboard lands: `/home` normally, and the
 * create-team onboarding when `NEXT_PUBLIC_ENABLE_TEAM_ACCOUNTS_ONLY` is on.
 */
export const HOME_LANDING_URL = /\/home(\/create-team)?$/;

export class TeamAccountsPageObject {
  private readonly page: Page;
  public auth: AuthPageObject;
  public otp: OtpPo;

  constructor(page: Page) {
    this.page = page;
    this.auth = new AuthPageObject(page);
    this.otp = new OtpPo(page);
  }

  async setup(params = this.createTeamName()) {
    const auth = new AuthPageObject(this.page);

    const email = auth.createRandomEmail();

    await auth.bootstrapUser({
      email,
      name: 'Test User',
    });

    await auth.loginAsUser({ email });

    await this.createTeam(params);

    return {
      email: email,
      teamName: params.teamName,
      slug: params.slug,
    };
  }

  /**
   * Builds a selector scoped to the route currently on screen.
   *
   * After a client-side navigation the route we came from is still mounted,
   * just sized to zero, so a plain `data-test` selector matches twice: once on
   * this page and once on the previous one. Playwright treats that as a strict
   * mode violation, and the plain `page.click`/`page.fill` helpers silently
   * pick whichever came first. Filtering on `:visible` leaves only the live one.
   */
  private visible(testId: string) {
    return `[data-test="${testId}"]:visible`;
  }

  getTeamFromSelector(teamName: string) {
    return this.page.locator(this.visible('workspace-team-item'), {
      hasText: teamName,
    });
  }

  getTeams() {
    return this.page.locator(this.visible('workspace-team-item'));
  }

  goToSettings() {
    return expect(async () => {
      await this.page
        .locator('a:visible', {
          hasText: 'Settings',
        })
        .click();

      await this.page.waitForURL('**/home/*/settings');
    }).toPass();
  }

  goToMembers() {
    return expect(async () => {
      await this.page
        .locator('a:visible', {
          hasText: 'Members',
        })
        .click();

      await this.page.waitForURL('**/home/*/members');
    }).toPass();
  }

  goToBilling() {
    return expect(async () => {
      await this.page
        .locator('a:visible', {
          hasText: 'Billing',
        })
        .click();

      return await this.page.waitForURL('**/home/*/billing');
    }).toPass();
  }

  openAccountsSelector() {
    return expect(async () => {
      await this.page.click(this.visible('workspace-dropdown-trigger'));

      // Dans une équipe, les équipes sont listées directement dans le menu ; ailleurs, dans un sous-menu
      const submenu = this.page.locator(
        this.visible('workspace-switch-submenu'),
      );

      if (await submenu.count()) {
        await submenu.click();
      }

      return expect(
        this.page.locator(this.visible('workspace-switch-content')),
      ).toBeVisible();
    }).toPass();
  }

  async tryCreateTeam(teamName: string, slug?: string) {
    const nameInput = this.page.locator(
      '[data-test="create-team-form"]:visible [data-test="team-name-input"]',
    );

    await nameInput.fill('');
    await nameInput.fill(teamName);

    // If slug is provided (for non-Latin names), fill the slug field
    if (slug) {
      const slugInput = this.page.locator(
        '[data-test="create-team-form"]:visible [data-test="team-slug-input"]',
      );

      await expect(slugInput).toBeVisible();
      await slugInput.fill(slug);
    }

    return this.page.click(
      '[data-test="create-team-form"]:visible button:last-child',
    );
  }

  async createTeam({ teamName, slug } = this.createTeamName()) {
    await this.openAccountsSelector();

    await this.page.click('[data-test="create-team-trigger"]');

    await this.page.fill(
      '[data-test="create-team-form"]:visible [data-test="team-name-input"]',
      teamName,
    );

    // Slug field is only shown for non-Latin names, so we don't fill it for Latin names
    // The database trigger will auto-generate the slug from the name

    const click = this.page.click(
      '[data-test="create-team-form"]:visible button:last-child',
    );

    const response = this.page.waitForURL(`/home/${slug}`);

    await Promise.all([click, response]);

    // Verify user landed on the team page
    await expect(this.page).toHaveURL(`/home/${slug}`);

    // Verify the team was created and appears in the selector
    await this.openAccountsSelector();
    await expect(this.getTeamFromSelector(teamName)).toBeVisible();

    await this.closeAccountsSelector();
  }

  async createTeamWithNonLatinName(teamName: string, slug: string) {
    await this.openAccountsSelector();

    await this.page.click('[data-test="create-team-trigger"]');

    await this.page.fill(
      '[data-test="create-team-form"]:visible [data-test="team-name-input"]',
      teamName,
    );

    // Wait for slug field to appear (triggered by non-Latin name)
    await expect(this.getSlugField()).toBeVisible();

    await this.page.fill(
      '[data-test="create-team-form"]:visible [data-test="team-slug-input"]',
      slug,
    );

    const click = this.page.click(
      '[data-test="create-team-form"]:visible button:last-child',
    );

    const response = this.page.waitForURL(`/home/${slug}`);

    await Promise.all([click, response]);

    // Verify user landed on the team page
    await expect(this.page).toHaveURL(`/home/${slug}`);

    // Verify the team was created and appears in the selector
    await this.openAccountsSelector();
    await expect(this.getTeamFromSelector(teamName)).toBeVisible();

    await this.closeAccountsSelector();
  }

  async closeAccountsSelector() {
    await this.page.locator('body').click({ position: { x: 0, y: 0 } });

    await expect(
      this.page.locator(this.visible('workspace-switch-content')),
    ).toBeHidden();
  }

  getSlugField() {
    return this.page.locator(
      '[data-test="create-team-form"]:visible [data-test="team-slug-input"]',
    );
  }

  /** Rename to a non-Latin name, which requires a custom slug. */
  async updateTeamNameWithSlug(name: string, slug: string) {
    const form = '[data-test="update-team-account-name-form"]:visible';

    await this.page.fill(`${form} [data-test="team-name-input"]`, name);

    const slugInput = this.page.locator(
      `${form} [data-test="team-slug-input"]`,
    );

    await expect(slugInput).toBeVisible();
    await slugInput.fill(slug);

    await Promise.all([
      this.page.click(`${form} [data-test="update-team-submit-button"]`),
      this.page.waitForResponse((response) => {
        return (
          response.url().includes('settings') &&
          response.request().method() === 'POST'
        );
      }),
    ]);
  }

  async updateTeamName(name: string) {
    await expect(async () => {
      await this.page.fill(
        '[data-test="update-team-account-name-form"] input',
        name,
      );

      await Promise.all([
        this.page.click('[data-test="update-team-account-name-form"] button'),
        this.page.waitForResponse((response) => {
          return (
            response.url().includes('settings') &&
            response.request().method() === 'POST'
          );
        }),
      ]);
    }).toPass();
  }

  async deleteAccount(email: string) {
    await this.page.click('[data-test="delete-team-trigger"]');
    await this.otp.completeOtpVerification(email);

    await expect(async () => {
      const click = this.page.click(
        '[data-test="delete-team-form-confirm-button"]',
      );

      // With TEAM_ACCOUNTS_ONLY a user left without any team is sent to the
      // create-team onboarding instead of /home.
      const response = this.page.waitForURL(HOME_LANDING_URL);

      return Promise.all([click, response]);
    }).toPass();
  }

  async updateMemberRole(memberEmail: string, newRole: string) {
    await expect(async () => {
      // Find the member row and click the actions button
      const memberRow = this.page.getByRole('row', { name: memberEmail });
      await memberRow.getByRole('button').click();

      // Click the update role option in the dropdown menu
      await this.page.getByText('Update Role').click();

      // Select the new role
      await this.page.click('[data-test="role-selector-trigger"]');
      await this.page.click(`[data-test="role-option-${newRole}"]`);

      // Wait for the update to complete and page to reload
      const response = this.page.waitForResponse((response) => {
        return (
          response.url().includes('members') &&
          response.request().method() === 'POST'
        );
      });

      return Promise.all([
        this.page.click('[data-test="confirm-update-member-role"]'),
        response,
      ]);
    }).toPass();
  }

  async transferOwnership(memberEmail: string, ownerEmail: string) {
    // Open the member's actions dropdown and start the transfer flow. These are
    // one-shot steps that open a dialog and consume a single-use OTP, so they
    // must run exactly once — retrying them (as a wrapping toPass would) leaves
    // the dialog mid-flow and re-sends the OTP, which is a flakiness source.
    const memberRow = this.page.getByRole('row', { name: memberEmail });
    await memberRow.getByRole('button').click();

    // Click the transfer ownership option in the dropdown menu
    await this.page.getByText('Transfer Ownership').click();

    // Complete OTP verification (has its own retry for reading the code)
    await this.otp.completeOtpVerification(ownerEmail);

    // Confirm the transfer and wait for the mutation to complete. Only this
    // final, idempotent step is retried.
    await expect(async () => {
      const response = this.page.waitForResponse((response) => {
        return (
          response.url().includes('members') &&
          response.request().method() === 'POST'
        );
      });

      return Promise.all([
        this.page.click('[data-test="confirm-transfer-ownership-button"]'),
        response,
      ]);
    }).toPass();
  }

  createTeamName() {
    const random = (Math.random() * 100000000).toFixed(0);

    const teamName = `Team-Name-${random}`;
    const slug = `team-name-${random}`;

    return { teamName, slug };
  }
}
