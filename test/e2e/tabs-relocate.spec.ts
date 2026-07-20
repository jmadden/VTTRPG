// Browser e2e (gm-maps-1b): the GM opens a second live tab on the seeded Demo
// Campaign, then drags the seeded player's row from the Players Panel onto
// that tab. Asserts the player's own page updates via `map_relocated` with no
// reload, and that the move persisted (tokens.map_id, checked via `pg`).
//
// Uses the seeded Demo Campaign/Player One fixture (no token-create UI exists
// yet to spin up a throwaway player+token — see docs/11 Phase 2). Named to
// sort after login.spec.ts/maps.spec.ts under Playwright's default
// alphabetical file order (workers: 1, fullyParallel: false), and restores
// Player One's token to the Demo Map before finishing regardless, so it's
// safe even if that ordering assumption ever changes.
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import pg from 'pg';
import { TEST_DATABASE_URL } from '../config';

const DEMO_MAP = '44444444-4444-4444-4444-444444444444';
const ARIA_TOKEN = '66666666-6666-6666-6666-666666666666';
const PLAYER_ONE_USER = '22222222-2222-2222-2222-222222222222';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function login(page: Page, name: string, pin: string): Promise<void> {
  await page.goto('/login');
  await page.getByPlaceholder('Display name').fill(name);
  await page.getByPlaceholder('PIN (4-6 digits)').fill(pin);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/lobby');
}

async function currentTokenMap(): Promise<string> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    const r = await client.query('SELECT map_id FROM tokens WHERE id = $1', [ARIA_TOKEN]);
    return r.rows[0].map_id as string;
  } finally {
    await client.end();
  }
}
async function restoreAriaToDemoMap(): Promise<void> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query('UPDATE tokens SET map_id = $2, x = 105, y = 105 WHERE id = $1', [
      ARIA_TOKEN,
      DEMO_MAP,
    ]);
  } finally {
    await client.end();
  }
}

/** Simulate HTML5 drag-and-drop by dispatching real DragEvents with a shared
 *  DataTransfer, since Playwright's mouse API doesn't trigger native DnD. */
async function dragTestIdOnto(page: Page, sourceTestId: string, targetTestId: string): Promise<void> {
  const source = page.getByTestId(sourceTestId);
  const target = page.getByTestId(targetTestId);
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error('drag source/target not visible');

  await page.evaluate(
    ({ sx, sy, tx, ty }) => {
      function dispatch(el: Element, type: string, dt: DataTransfer) {
        el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
      }
      const dt = new DataTransfer();
      const sourceEl = document.elementFromPoint(sx, sy);
      const targetEl = document.elementFromPoint(tx, ty);
      if (!sourceEl || !targetEl) throw new Error('elements not found at point');
      dispatch(sourceEl, 'dragstart', dt);
      dispatch(targetEl, 'dragover', dt);
      dispatch(targetEl, 'drop', dt);
    },
    {
      sx: sourceBox.x + sourceBox.width / 2,
      sy: sourceBox.y + sourceBox.height / 2,
      tx: targetBox.x + targetBox.width / 2,
      ty: targetBox.y + targetBox.height / 2,
    },
  );
}

test('GM relocates a player across live tabs; the player updates without reloading', async ({
  browser,
}) => {
  let gmContext: BrowserContext | undefined;
  let playerContext: BrowserContext | undefined;
  try {
    gmContext = await browser.newContext();
    const gmPage = await gmContext.newPage();
    await login(gmPage, 'Game Master', '1234');
    await gmPage.getByText('Demo Campaign').first().click();
    await gmPage.waitForURL('**/lobby/game/**');
    await gmPage.getByRole('button', { name: 'Enter' }).click();
    await gmPage.waitForSelector('canvas');

    // Upload a second map straight into the live set via the in-game drawer.
    await gmPage.getByRole('button', { name: 'Map Library' }).click();
    await gmPage
      .locator('input[type=file]')
      .setInputFiles({ name: 'dungeon.png', mimeType: 'image/png', buffer: PNG });
    await gmPage.getByPlaceholder('Map name').fill('E2E Dungeon');
    await gmPage.getByRole('button', { name: 'Upload + add as tab' }).click();
    // Scoped to the tab specifically: the Map Library drawer also lists
    // already-added maps (ghosted "Added"), so a bare getByText would match
    // both the tab and that drawer row.
    await expect(gmPage.locator('[data-testid^="tab-"]', { hasText: 'E2E Dungeon' })).toBeVisible();

    playerContext = await browser.newContext();
    const playerPage = await playerContext.newPage();
    await login(playerPage, 'Player One', '4321');
    await playerPage.getByRole('button', { name: 'Enter' }).first().click();
    await playerPage.waitForSelector('canvas');
    await expect.poll(() => playerPage.evaluate(() => document.body.innerText)).toContain(
      'VTT · player',
    );

    // Find the newly-added Dungeon tab's mapId from its test id, then drag
    // Player One's row onto it.
    const dungeonTab = gmPage.locator('[data-testid^="tab-"]', { hasText: 'E2E Dungeon' });
    const dungeonTestId = await dungeonTab.getAttribute('data-testid');
    expect(dungeonTestId).toBeTruthy();

    const playerRow = gmPage.getByTestId(`player-row-${PLAYER_ONE_USER}`);
    await expect(playerRow).toBeVisible();
    await dragTestIdOnto(gmPage, `player-row-${PLAYER_ONE_USER}`, dungeonTestId!);

    // The player's page updates via map_relocated + a fresh state_sync, with
    // no navigation/reload — the canvas element persists (same page instance).
    await expect.poll(async () => currentTokenMap(), { timeout: 8000 }).toBe(
      dungeonTestId!.replace('tab-', ''),
    );
    await expect(playerPage.locator('canvas')).toBeVisible();
  } finally {
    await restoreAriaToDemoMap();
    await gmContext?.close();
    await playerContext?.close();
  }
});
