// Browser e2e (docs/12 Phase 5): create a Game, create a Campaign via the
// new single-page form, walk it through Start Session -> End Session ->
// Mark Complete, and confirm the "Show completed" toggle hides/shows it.
import { test, expect, type Page } from '@playwright/test';

async function login(page: Page, name: string, pin: string): Promise<void> {
  await page.goto('/login');
  await page.getByPlaceholder('Display name').fill(name);
  await page.getByPlaceholder('PIN (4-6 digits)').fill(pin);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/lobby');
}

test('GM creates a Game + Campaign and walks the full lifecycle', async ({ page }) => {
  await login(page, 'Game Master', '1234');

  // Create a fresh Game from the sidebar.
  await page.getByPlaceholder('New Game name').fill('Lifecycle E2E Game');
  await page.getByRole('button', { name: '+ New Game' }).click();
  await page.waitForURL('**/lobby/game/*');

  // Create a Campaign via the single-page form (no templates/members needed).
  await page.getByRole('button', { name: '+ New Campaign' }).click();
  await page.waitForURL('**/campaigns/new');
  await page.getByPlaceholder('Campaign name').fill('Lifecycle E2E Campaign');
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/api/campaigns') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Create Campaign' }).click();
  const { id: campaignId } = (await (await created).json()) as { id: string };
  await page.waitForURL('**/lobby/game/*');

  const card = page.getByTestId(`campaign-${campaignId}`);
  await expect(card.getByText('draft')).toBeVisible();

  // draft -> live via the secondary Start Session button (primary is Manage).
  await card.getByRole('button', { name: 'Start Session' }).click();
  await expect(card.getByText('live')).toBeVisible();

  // live -> paused.
  await card.getByRole('button', { name: 'End Session' }).click();
  await expect(card.getByText('paused')).toBeVisible();

  // paused -> completed (via Mark Complete; accept the confirm() dialog).
  page.once('dialog', (d) => void d.accept());
  await card.getByRole('button', { name: 'Mark Complete' }).click();
  await expect(page.getByText('No campaigns yet. Create one above.')).toBeVisible();

  // "Show completed" reveals it again, now read-only (View only).
  await page.getByRole('checkbox').check();
  await expect(card.getByText('completed')).toBeVisible();
  await expect(card.getByRole('button', { name: 'View' })).toBeVisible();
});
