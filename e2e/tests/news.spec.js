const { test, expect } = require('@playwright/test');
const { signUpAndSignIn } = require('../fixtures/helpers');

test.describe('Regulatory news', () => {
  test('the landing badge shows the featured AI Act date and opens its news entry', async ({ page }) => {
    await page.goto('/welcome');
    const badge = page.getByTestId('mkt-hero-news');
    await expect(badge).toContainText('high-risk obligations apply from 2 December 2027');
    await expect(badge).not.toContainText('2 August 2026');
    await badge.click();
    await expect(page).toHaveURL(/\/news#2026-07-ai-act-digital-omnibus$/);
    await expect(page.getByTestId('marketing-news')).toBeVisible();
    // An id starting with a digit is not a valid CSS #selector; match the attribute.
    await expect(page.locator('[id="2026-07-ai-act-digital-omnibus"]')).toBeInViewport();
    const items = page.getByTestId('news-item');
    await expect(items.first()).toContainText('Product Liability Act');
    await expect(items.filter({ hasText: 'KI-MIG in force' })).toHaveCount(1);
    await expect(items.first().getByRole('link', { name: /Bundesregierung/ })).toHaveAttribute('href', /^https:\/\//);
  });

  test('signed-in users see news on the dashboard and in the sidebar page', async ({ page }) => {
    await signUpAndSignIn(page);
    await page.goto('/');
    const widget = page.getByTestId('widget-news');
    await expect(widget).toContainText('Product Liability Act');
    await widget.getByRole('link', { name: 'All news' }).click();
    await expect(page.getByTestId('regulatory-news')).toBeVisible();
    // In-app law tags open the framework page.
    await page.getByTestId('news-item').filter({ hasText: 'KI-MIG in force' }).getByRole('link', { name: 'KI-MIG', exact: true }).click();
    await expect(page).toHaveURL(/\/frameworks\/ki_mig$/);
  });
});
