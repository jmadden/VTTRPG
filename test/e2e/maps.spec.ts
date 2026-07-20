// Browser e2e (GM toolkit Phase 1a/1b): a GM creates a campaign, uploads a map
// via Manage (library), enters the (initially tab-less) campaign, then adds
// that map as a live tab from the in-game library drawer; the real image is
// fetched under the grid. Uses its own campaign so it does not disturb the
// seeded Demo (login.spec).
import { test, expect, type Page } from '@playwright/test';

// A 1x1 PNG uploaded via setInputFiles (no on-disk fixture needed).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function loginGM(page: Page): Promise<{ token: string }> {
  await page.goto('/login');
  await page.getByPlaceholder('Display name').fill('Game Master');
  await page.getByPlaceholder('PIN (4-6 digits)').fill('1234');
  const loggedIn = page.waitForResponse(
    (r) => r.url().endsWith('/api/login') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Sign in' }).click();
  const { token } = (await (await loggedIn).json()) as { token: string };
  await page.waitForURL('**/lobby');
  return { token };
}

const BACKEND_URL = 'http://localhost:4000';

test('GM creates a campaign, uploads a map, enters, and adds it as a live tab', async ({ page }) => {
  const { token } = await loginGM(page);

  // docs/12: campaign creation now lives inside a Game, and the single-page
  // Create Campaign form doesn't land until Phase 5 -- create the Game +
  // Campaign directly via the API (this test is about the map/tab flow
  // inside a campaign, not about the Games-creation UI itself), then
  // navigate straight to Manage.
  const authH = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const gameRes = await page.request.post(`${BACKEND_URL}/api/games`, {
    headers: authH,
    data: JSON.stringify({ name: 'E2E Maps Game' }),
  });
  const { id: gameId } = (await gameRes.json()) as { id: string };
  const campRes = await page.request.post(`${BACKEND_URL}/api/campaigns`, {
    headers: authH,
    data: JSON.stringify({ gameId, name: 'E2E Maps Campaign' }),
  });
  const { id: campaignId } = (await campRes.json()) as { id: string };

  await page.goto(`/campaign/${campaignId}/manage`);
  await page.waitForURL('**/manage');

  // Empty library -> upload one map (library CRUD only; no live-tab concept here).
  const uploaded = page.waitForResponse(
    (r) => r.url().includes('/maps') && r.request().method() === 'POST',
  );
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'map.png', mimeType: 'image/png', buffer: PNG });
  await page.getByPlaceholder(/Map name/).fill('E2E Map');
  await page.getByRole('button', { name: 'Upload' }).click();
  const { id: mapId } = (await (await uploaded).json()) as { id: string };
  await expect(page.getByText('E2E Map')).toBeVisible();

  // Enter with an empty live set -> the waiting shell, no canvas yet.
  await page.getByRole('button', { name: 'Enter' }).click();
  await expect(page.getByText('No live maps yet')).toBeVisible();

  // Add the library map as a live tab from the in-game library drawer.
  const imageFetched = page
    .waitForResponse((r) => r.url().includes('/assets/') && r.status() === 200, { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  await page.getByRole('button', { name: 'Map Library' }).click();
  await page.getByTestId(`library-add-${mapId}`).click();

  await page.waitForSelector('canvas');
  await expect.poll(() => page.evaluate(() => document.body.innerText)).toContain('VTT · GM');
  expect(await imageFetched).toBe(true);
});
