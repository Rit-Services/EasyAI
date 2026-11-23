const { test, expect } = require('@playwright/test');
const { signUpAndSignIn } = require('../fixtures/helpers');

// Language and theme are saved on the account, so they follow the person to any
// browser or device. The browser keeps a copy for signed-out pages.
const SHOTS = process.env.SHOT_DIR;

const isSave = (r) => r.url().includes('/api/users/me/preferences') && r.request().method() === 'PATCH';
const account = async (page) => (await (await page.request.get('/api/auth/me')).json()).user;
const signIn = (page, { email, password }) => page.request.post('/api/auth/login', { data: { email, password } });

// A separate browser: its own storage and cookies, as on another device.
async function otherBrowser(browser, baseURL, saved = {}) {
  const localStorage = Object.entries(saved).map(([name, value]) => ({ name, value }));
  const ctx = await browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: localStorage.length ? [{ origin: baseURL, localStorage }] : [] },
  });
  return { ctx, page: await ctx.newPage() };
}

async function expectChoices(page, lang, theme) {
  await expect(page.getByTestId(`lang-${lang}`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

// Choose English and night mode on screen, waiting for each to be saved.
async function chooseEnglishAndNight(page) {
  await page.goto('/');
  await expect(page.getByTestId('dashboard')).toBeVisible();
  await Promise.all([page.waitForResponse(isSave), page.getByTestId('lang-en').click()]);
  await Promise.all([page.waitForResponse(isSave), page.getByTestId('theme-toggle').click()]);
  await expectChoices(page, 'en', 'dark');
}

test.describe('Preferences saved on the account', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('nothing is saved until a choice is made, so defaults never become choices', async ({ page }) => {
    const saves = [];
    page.on('request', (r) => { if (r.url().includes('/users/me/preferences')) saves.push(r.url()); });
    await signUpAndSignIn(page);
    await page.goto('/');
    await expect(page.getByTestId('dashboard')).toBeVisible();
    await expectChoices(page, 'de', 'light');
    expect(await account(page)).toMatchObject({ language: null, theme: null });
    expect(saves).toEqual([]);
  });

  test('a choice follows the person to another browser', async ({ page, browser, baseURL }) => {
    const creds = await signUpAndSignIn(page);
    await chooseEnglishAndNight(page);
    expect(await account(page)).toMatchObject({ language: 'en', theme: 'dark' });

    const other = await otherBrowser(browser, baseURL);
    await signIn(other.page, creds);
    await other.page.goto('/');
    await expect(other.page.getByTestId('dashboard')).toBeVisible();
    await expectChoices(other.page, 'en', 'dark');
    if (SHOTS) await other.page.screenshot({ path: `${SHOTS}/other-browser.png` });
    // That browser now has its own copy for signed-out pages.
    expect(await other.page.evaluate(() => [localStorage.getItem('aic_lang'), localStorage.getItem('aic_theme')])).toEqual(['en', 'dark']);
    await other.ctx.close();
  });

  test('it survives clearing the browser data', async ({ page }) => {
    await signUpAndSignIn(page);
    await chooseEnglishAndNight(page);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expectChoices(page, 'en', 'dark');
  });

  test('an account with no choice takes the one already made in this browser', async ({ browser, baseURL }) => {
    const { ctx, page } = await otherBrowser(browser, baseURL, { aic_lang: 'en', aic_theme: 'dark' });
    await signUpAndSignIn(page);
    await Promise.all([page.waitForResponse(isSave), page.goto('/')]);
    await expectChoices(page, 'en', 'dark');
    expect(await account(page)).toMatchObject({ language: 'en', theme: 'dark' });
    await ctx.close();
  });

  test('a choice made on the sign-in page is kept when signing in', async ({ page, browser, baseURL }) => {
    const creds = await signUpAndSignIn(page);

    const other = await otherBrowser(browser, baseURL);
    await other.page.goto('/login');
    await other.page.getByTestId('lang-en').click();
    await other.page.getByTestId('email').fill(creds.email);
    await other.page.getByTestId('password').fill(creds.password);
    await Promise.all([other.page.waitForResponse(isSave), other.page.getByTestId('submit').click()]);
    await expect(other.page.getByTestId('dashboard')).toBeVisible();
    expect(await account(other.page)).toMatchObject({ language: 'en', theme: null });
    await other.ctx.close();
  });

  test('the account wins over a different choice in the browser', async ({ page, browser, baseURL }) => {
    const creds = await signUpAndSignIn(page);
    await chooseEnglishAndNight(page);

    const other = await otherBrowser(browser, baseURL, { aic_lang: 'de', aic_theme: 'light' });
    await signIn(other.page, creds);
    await other.page.goto('/');
    await expectChoices(other.page, 'en', 'dark');
    await other.page.reload();
    await expectChoices(other.page, 'en', 'dark');
    expect(await account(other.page)).toMatchObject({ language: 'en', theme: 'dark' });
    await other.ctx.close();
  });

  test('a change on one browser shows on another at its next page load', async ({ page, browser, baseURL }) => {
    const creds = await signUpAndSignIn(page);
    await chooseEnglishAndNight(page);

    const other = await otherBrowser(browser, baseURL);
    await signIn(other.page, creds);
    await other.page.goto('/');
    await expectChoices(other.page, 'en', 'dark');

    await Promise.all([page.waitForResponse(isSave), page.getByTestId('lang-de').click()]);
    await other.page.reload();
    await expectChoices(other.page, 'de', 'dark');
    await other.ctx.close();
  });

  test('two people on one browser keep their own choices', async ({ page, browser, baseURL }) => {
    const first = await signUpAndSignIn(page);
    await chooseEnglishAndNight(page);
    await page.request.post('/api/auth/logout');

    // The second person already has their own choices saved.
    const other = await otherBrowser(browser, baseURL);
    const second = await signUpAndSignIn(other.page);
    await other.page.request.patch('/api/users/me/preferences', { data: { language: 'de', theme: 'light' } });
    await other.ctx.close();

    await signIn(page, second);
    await page.goto('/');
    await expectChoices(page, 'de', 'light');
    await page.request.post('/api/auth/logout');

    await signIn(page, first);
    expect(await account(page)).toMatchObject({ language: 'en', theme: 'dark' });
  });

  test('signed out, a choice stays in the browser and nothing is sent', async ({ page }) => {
    const saves = [];
    page.on('request', (r) => { if (r.url().includes('/users/me/preferences')) saves.push(r.url()); });
    await page.goto('/login');
    await page.getByTestId('lang-en').click();
    await page.reload();
    await expect(page.getByTestId('lang-en')).toHaveAttribute('aria-pressed', 'true');
    expect(saves).toEqual([]);
  });

  test('the server refuses bad values, other fields and signed-out requests', async ({ page, browser, baseURL }) => {
    await signUpAndSignIn(page);
    const patch = (data) => page.request.patch('/api/users/me/preferences', { data });
    expect((await patch({ language: 'fr' })).status()).toBe(422);
    expect((await patch({ theme: 'blue' })).status()).toBe(422);
    expect((await patch({})).status()).toBe(422);

    const before = await account(page);
    expect((await patch({ language: 'en', role: 'platform_admin', fullName: 'Changed' })).status()).toBe(200);
    expect(await account(page)).toMatchObject({ language: 'en', role: before.role, fullName: before.fullName });

    const other = await otherBrowser(browser, baseURL);
    expect((await other.page.request.patch('/api/users/me/preferences', { data: { language: 'en' } })).status()).toBe(401);
    await other.ctx.close();
  });

  test('the site still works when the browser blocks site data', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
    });
    await signUpAndSignIn(page);
    await page.goto('/');
    await expect(page.getByTestId('dashboard')).toBeVisible();
    await Promise.all([page.waitForResponse(isSave), page.getByTestId('lang-en').click()]);
    await expect(page.getByTestId('lang-en')).toHaveAttribute('aria-pressed', 'true');
    expect(await account(page)).toMatchObject({ language: 'en' });

    // Nothing can be kept in the browser, yet the account still remembers.
    await page.reload();
    await expect(page.getByTestId('lang-en')).toHaveAttribute('aria-pressed', 'true');
    expect(errors).toEqual([]);
  });

  test('the personal data export includes the saved choices', async ({ page }) => {
    await signUpAndSignIn(page);
    await page.request.patch('/api/users/me/preferences', { data: { language: 'en', theme: 'dark' } });
    const res = await page.request.get('/api/privacy/export');
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text).toMatch(/"language":\s*"en"/);
    expect(text).toMatch(/"theme":\s*"dark"/);
  });
});
