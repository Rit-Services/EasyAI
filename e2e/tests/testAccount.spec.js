const { test, expect } = require('@playwright/test');
const { uniqueEmail } = require('../fixtures/helpers');

const SHOTS = process.env.SHOT_DIR;
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

// Signed-in test account, created through the API.
async function signUpTestAccount(page) {
  const email = uniqueEmail('test');
  const reg = await page.request.post('/api/auth/register', {
    data: {
      fullName: 'Dana Test', email, password: 'Test12345!', organizationName: 'Tryout GmbH', accountType: 'test', noRealDataConfirmed: true,
    },
  });
  expect(reg.status()).toBe(201);
  const tokRes = await page.request.post('/api/auth/dev/verification-token', { data: { email } });
  const { token } = await tokRes.json();
  await page.request.post('/api/auth/verify-email', { data: { token } });
  return email;
}

test.describe('Test accounts (no AVV)', () => {
  test('sign-up asks Test or Production first, and only production sees the AVV', async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByTestId('mode-choice')).toBeVisible();
    await shot(page, 'register-question');
    await expect(page.getByTestId('fullName')).toHaveCount(0); // nothing else until a choice is made

    await page.getByTestId('mode-production').check();
    await expect(page.getByTestId('avvAccepted')).toBeVisible();
    await expect(page.getByTestId('organizationAddress')).toBeVisible();

    await page.getByTestId('mode-test').check();
    await expect(page.getByTestId('avvAccepted')).toHaveCount(0);
    await expect(page.getByTestId('organizationAddress')).toHaveCount(0);
    await expect(page.getByTestId('noRealDataConfirmed')).toBeVisible();
  });

  test('from the homepage to a test account with sample data and no AVV', async ({ page }) => {
    await page.goto('/welcome');
    await shot(page, 'homepage-buttons');
    await page.getByTestId('mkt-cta-test').click();
    await expect(page).toHaveURL(/\/register\?mode=test$/);
    await expect(page.getByTestId('mode-test')).toBeChecked();

    const email = uniqueEmail('test');
    await page.getByTestId('fullName').fill('Dana Test');
    await page.getByTestId('email').fill(email);
    await page.getByTestId('password').fill('Test12345!');
    await page.getByTestId('submit').click();
    // Refused until the no-real-data confirmation is ticked.
    await expect(page.getByText('Please confirm this to start a test account')).toBeVisible();
    await page.getByTestId('noRealDataConfirmed').check();
    await shot(page, 'register-test');
    await page.getByTestId('submit').click();
    await expect(page.getByTestId('register-success')).toBeVisible();

    const tokRes = await page.request.post('/api/auth/dev/verification-token', { data: { email } });
    const { token } = await tokRes.json();
    await page.goto(`/verify-email?token=${token}`);
    await expect(page.getByTestId('dashboard')).toBeVisible();
    await expect(page.getByTestId('test-account-banner')).toContainText('no real personal data may be entered');
    await shot(page, 'test-dashboard');

    const systems = await (await page.request.get('/api/ai-systems')).json();
    const byName = Object.fromEntries(systems.aiSystems.map((s) => [s.name, s.riskCategory]));
    expect(byName).toEqual({
      'Example: Customer support chatbot': 'limited',
      'Example: CV screening tool': 'high',
      'Example: Spam filter': 'minimal',
    });
    // The examples come with working checklists to try.
    const assessments = await (await page.request.get('/api/assessments')).json();
    expect((assessments.assessments || assessments).length).toBeGreaterThan(0);

    expect((await page.request.get('/api/organizations/current/avv')).status()).toBe(404);
  });

  test('uploads, invitations and community posting are blocked, on screen and on the server', async ({ page }) => {
    await signUpTestAccount(page);

    await page.goto('/documents');
    await expect(page.getByTestId('test-no-uploads')).toBeVisible();
    await expect(page.getByTestId('upload-file')).toHaveCount(0);

    await page.goto('/community');
    await expect(page.getByTestId('test-community-readonly')).toBeVisible();
    await expect(page.getByTestId('new-thread')).toHaveCount(0);

    await page.goto('/settings');
    await expect(page.getByTestId('test-no-invites')).toBeVisible();
    await expect(page.getByTestId('invite-role')).toHaveCount(0);

    // Checklist points can be worked on, but take no attachments.
    await page.goto('/assessments');
    await page.getByTestId('assessment-row').first().getByRole('link', { name: 'Open' }).click();
    await page.getByRole('button', { name: 'Open', exact: true }).first().click();
    await expect(page.getByTestId('checklist-item').first()).toBeVisible();
    await expect(page.getByTestId('attach-file')).toHaveCount(0);

    const upload = await page.request.post('/api/documents', {
      multipart: { file: { name: 'real-data.txt', mimeType: 'text/plain', buffer: Buffer.from('names and addresses') } },
    });
    expect(upload.status()).toBe(403);
    const invite = await page.request.post('/api/invitations', { data: { email: uniqueEmail('colleague'), role: 'member' } });
    expect(invite.status()).toBe(403);
    const thread = await page.request.post('/api/community/threads', { data: { title: 'A test thread', body: 'Some body text.', visibility: 'global' } });
    expect(thread.status()).toBe(403);
  });

  test('accepting the AVV switches to production and lifts the limits', async ({ page }) => {
    const email = await signUpTestAccount(page);
    await page.goto('/');
    await page.getByTestId('test-account-switch').click();
    await expect(page).toHaveURL(/\/settings#avv$/);

    const card = page.getByTestId('avv-card');
    // The tester's approval is on record, with who and when.
    await expect(card.getByTestId('test-confirmed')).toContainText(email);
    await expect(card.getByTestId('avv-accept-form')).toContainText('This is a test account');
    await card.getByTestId('avv-address').fill('Musterstraße 1, 50667 Köln');
    await card.getByTestId('avv-accept-checkbox').check();
    await card.scrollIntoViewIfNeeded();
    if (SHOTS) await card.screenshot({ path: `${SHOTS}/switch-form.png` });
    await card.getByTestId('avv-accept-submit').click();

    await expect(card).toContainText('Version 1.1');
    await expect(page.getByTestId('test-account-banner')).toHaveCount(0);
    await expect(page.getByTestId('invite-role')).toBeVisible();

    const org = await (await page.request.get('/api/organizations/current')).json();
    expect(org.organization).toMatchObject({ accountType: 'production', address: 'Musterstraße 1, 50667 Köln' });
    const invite = await page.request.post('/api/invitations', { data: { email: uniqueEmail('colleague'), role: 'member' } });
    expect(invite.status()).toBe(201);
    // The examples are still there.
    const systems = await (await page.request.get('/api/ai-systems')).json();
    expect(systems.aiSystems).toHaveLength(3);
  });
});
