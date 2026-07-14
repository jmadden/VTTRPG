// Browser e2e (GM toolkit Phase 1a): a GM creates a campaign, uploads a map via
// Manage, sets it active, and enters it; the real image is fetched under the grid.
// Uses its own campaign so it does not disturb the seeded Demo (login.spec).
import { test, expect, type Page } from '@playwright/test';

// A 1x1 PNG uploaded via setInputFiles (no on-disk fixture needed).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function loginGM(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByPlaceholder('Display name').fill('Game Master');
  await page.getByPlaceholder('PIN (4-6 digits)').fill('1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/lobby');
}

test('GM creates a campaign, uploads + activates a map, and enters it', async ({ page }) => {
  await loginGM(page);

  // Create a fresh campaign (the GM owns it); it becomes the newest card.
  await page.getByPlaceholder('New campaign name').fill('E2E Maps Campaign');
  await page.getByRole('button', { name: /Create/ }).click();
  await expect(page.getByText('E2E Maps Campaign')).toBeVisible();

  // Newest GM campaign -> its Manage is the last one.
  await page.getByRole('button', { name: 'Manage' }).last().click();
  await page.waitForURL('**/manage');

  // Empty library -> upload one map.
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'map.png', mimeType: 'image/png', buffer: PNG });
  await page.getByPlaceholder(/Map name/).fill('E2E Map');
  await page.getByRole('button', { name: 'Upload' }).click();

  await expect(page.getByText('E2E Map')).toBeVisible();
  await page.getByRole('button', { name: 'Set active' }).click();
  await expect(page.getByText('active')).toBeVisible();

  // Enter and confirm the map renders, fetching the uploaded image.
  const imageFetched = page
    .waitForResponse((r) => r.url().includes('/assets/') && r.status() === 200, { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  await page.getByRole('button', { name: 'Enter' }).click();
  await page.waitForSelector('canvas');
  await expect.poll(() => page.evaluate(() => document.body.innerText)).toContain('VTT · GM');
  expect(await imageFetched).toBe(true);
});
