// Integration (docs/12 Phase 1): Games CRUD basics, campaign creation under a
// Game, and Game detail assembly.
import { describe, it, expect } from 'vitest';
import { BACKEND_URL } from '../config';

const authH = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

async function registerToken(displayName: string, pin: string): Promise<string> {
  const r = await fetch(BACKEND_URL + '/api/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName, pin }),
  });
  return ((await r.json()) as { token: string }).token;
}

describe('games CRUD (Phase 1)', () => {
  it('creates a Game and lists it back for its GM', async () => {
    const gm = await registerToken('GamesGm', '1234');

    const create = await fetch(`${BACKEND_URL}/api/games`, {
      method: 'POST',
      headers: authH(gm),
      body: JSON.stringify({ name: 'Homebrew World', description: 'A test setting' }),
    });
    expect(create.status).toBe(201);
    const game = (await create.json()) as { id: string; name: string; campaignCount: number };
    expect(game.name).toBe('Homebrew World');
    expect(game.campaignCount).toBe(0);

    const list = (await (
      await fetch(`${BACKEND_URL}/api/games`, { headers: authH(gm) })
    ).json()) as { id: string }[];
    expect(list.some((g) => g.id === game.id)).toBe(true);
  });
});

async function createGame(token: string, name: string): Promise<{ id: string; joinCode: string }> {
  const r = await fetch(`${BACKEND_URL}/api/games`, {
    method: 'POST', headers: authH(token), body: JSON.stringify({ name }),
  });
  return (await r.json()) as { id: string; joinCode: string };
}
async function meId(token: string): Promise<string> {
  const r = await fetch(`${BACKEND_URL}/api/me`, { headers: authH(token) });
  return ((await r.json()) as { user: { id: string } }).user.id;
}

describe('campaign creation under a Game (Phase 1)', () => {
  it('creates a campaign scoped to a Game; rejects a non-GM', async () => {
    const gm = await registerToken('CampaignGm', '1234');
    const game = await createGame(gm, 'Setting');

    const camp = await fetch(`${BACKEND_URL}/api/campaigns`, {
      method: 'POST', headers: authH(gm),
      body: JSON.stringify({ gameId: game.id, name: 'First Campaign' }),
    });
    expect(camp.status).toBe(201);
    const campaign = (await camp.json()) as { status: string };
    expect(campaign.status).toBe('draft');

    const intruder = await registerToken('CampaignIntruder', '1234');
    const forbidden = await fetch(`${BACKEND_URL}/api/campaigns`, {
      method: 'POST', headers: authH(intruder),
      body: JSON.stringify({ gameId: game.id, name: 'Nope' }),
    });
    expect(forbidden.status).toBe(403);
  });
});

describe('game detail assembly (Phase 1)', () => {
  it('assembles campaigns and members for a Game', async () => {
    const gm = await registerToken('DetailGm', '1234');
    const game = await createGame(gm, 'Detail Setting');
    await fetch(`${BACKEND_URL}/api/campaigns`, {
      method: 'POST', headers: authH(gm), body: JSON.stringify({ gameId: game.id, name: 'A Campaign' }),
    });

    const detail = (await (
      await fetch(`${BACKEND_URL}/api/games/${game.id}`, { headers: authH(gm) })
    ).json()) as { campaigns: { name: string }[]; members: unknown[]; mapTemplates: unknown[] };
    expect(detail.campaigns.map((c) => c.name)).toEqual(['A Campaign']);
    expect(detail.members).toEqual([]);
    expect(detail.mapTemplates).toEqual([]);
  });
});

describe('requireGameGm (Phase 1)', () => {
  it('GET /api/games/:id succeeds for the GM, 403s for anyone else', async () => {
    const gm = await registerToken('MiddlewareGm', '1234');
    const game = await createGame(gm, 'MW Setting');

    const ok = await fetch(`${BACKEND_URL}/api/games/${game.id}`, { headers: authH(gm) });
    expect(ok.status).toBe(200);

    const intruder = await registerToken('MiddlewareIntruder', '1234');
    const forbidden = await fetch(`${BACKEND_URL}/api/games/${game.id}`, { headers: authH(intruder) });
    expect(forbidden.status).toBe(403);
  });
});
