// Browser e2e: the real login -> lobby -> map flow, replacing the old
// hardcoded-UUID scripts. Each test runs in a fresh context (logged out).
import { test, expect, type Page } from '@playwright/test';

async function login(page: Page, name: string, pin: string): Promise<void> {
  await page.getByPlaceholder('Display name').fill(name);
  await page.getByPlaceholder('PIN (4-6 digits)').fill(pin);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/lobby');
}

const bodyText = (page: Page) => page.evaluate(() => document.body.innerText);

test('unauthenticated visit redirects to /login', async ({ page }) => {
  await page.goto('/');
  await page.waitForURL('**/login');
});

test('GM logs in, enters the seeded map, sees 2 tokens (server-derived role)', async ({ page }) => {
  await page.goto('/login');
  await login(page, 'Game Master', '1234');
  await page.getByText('Demo Campaign').first().click(); // the seeded Game in the sidebar
  await page.waitForURL('**/lobby/game/**');
  await expect(page.getByText('Demo Campaign').last()).toBeVisible(); // the campaign card
  await page.getByRole('button', { name: 'Enter' }).click();
  await page.waitForSelector('canvas');
  await expect.poll(() => bodyText(page)).toContain('VTT · GM');
  await expect.poll(async () => /tokens:\s*2/.test(await bodyText(page))).toBe(true);
});

test('player enters the map with the hidden orc stripped (no toggle)', async ({ page }) => {
  await page.goto('/login');
  await login(page, 'Player One', '4321');
  await page.getByRole('button', { name: 'Enter' }).first().click();
  await page.waitForSelector('canvas');
  await expect.poll(() => bodyText(page)).toContain('VTT · player');
  await expect.poll(async () => /tokens:\s*1/.test(await bodyText(page))).toBe(true);
});
