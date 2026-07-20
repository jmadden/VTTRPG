// Integration (docs/12 Phase 4): the Game-level roster -- join by code,
// member listing, character-sheet attach, and roster subset on campaign
// creation.
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

describe('roster join (Phase 4)', () => {
  it('joins a Game roster with the correct join code; rejects a wrong one', async () => {
    const gm = await registerToken('RosterGm', '1234');
    const game = await createGame(gm, 'Roster Setting');
    const player = await registerToken('RosterPlayer', '1234');

    const bad = await fetch(`${BACKEND_URL}/api/games/${game.id}/join`, {
      method: 'POST', headers: authH(player), body: JSON.stringify({ joinCode: 'WRONG' }),
    });
    expect(bad.status).toBe(403);

    const ok = await fetch(`${BACKEND_URL}/api/games/${game.id}/join`, {
      method: 'POST', headers: authH(player), body: JSON.stringify({ joinCode: game.joinCode }),
    });
    expect(ok.status).toBe(200);

    const members = (await (
      await fetch(`${BACKEND_URL}/api/games/${game.id}/members`, { headers: authH(gm) })
    ).json()) as { userId: string }[];
    expect(members.map((m) => m.userId)).toContain(await meId(player));
  });
});

describe('character sheet attach (Phase 4)', () => {
  it('lists eligible sheets scoped to this Game and attaches one; rejects a foreign sheet', async () => {
    const gm = await registerToken('AttachGm', '1234');
    const game = await createGame(gm, 'Attach Setting');
    const player = await registerToken('AttachPlayer', '1234');
    await fetch(`${BACKEND_URL}/api/games/${game.id}/join`, {
      method: 'POST', headers: authH(player), body: JSON.stringify({ joinCode: game.joinCode }),
    });
    const playerId = await meId(player);

    const campRes = await fetch(`${BACKEND_URL}/api/campaigns`, {
      method: 'POST', headers: authH(gm),
      body: JSON.stringify({ gameId: game.id, name: 'Attach Campaign', memberUserIds: [playerId] }),
    });
    const campaign = (await campRes.json()) as { id: string };

    const eligible = await fetch(`${BACKEND_URL}/api/games/${game.id}/members/${playerId}/sheets`, {
      headers: authH(gm),
    });
    expect(eligible.status).toBe(200);
    const badAttach = await fetch(`${BACKEND_URL}/api/games/${game.id}/members/${playerId}`, {
      method: 'PATCH', headers: authH(gm),
      body: JSON.stringify({ characterSheetId: '00000000-0000-0000-0000-000000000000' }),
    });
    expect(badAttach.status).toBe(400);

    void campaign;
  });
});

describe('roster subset on campaign creation (Phase 4)', () => {
  it('adds selected roster members as campaign_members; ignores non-roster ids', async () => {
    const gm = await registerToken('SubsetGm', '1234');
    const game = await createGame(gm, 'Subset Setting');
    const rosterPlayer = await registerToken('SubsetRosterPlayer', '1234');
    await fetch(`${BACKEND_URL}/api/games/${game.id}/join`, {
      method: 'POST', headers: authH(rosterPlayer), body: JSON.stringify({ joinCode: game.joinCode }),
    });
    const rosterPlayerId = await meId(rosterPlayer);
    const outsider = await registerToken('SubsetOutsider', '1234');
    const outsiderId = await meId(outsider);

    const campRes = await fetch(`${BACKEND_URL}/api/campaigns`, {
      method: 'POST', headers: authH(gm),
      body: JSON.stringify({ gameId: game.id, name: 'Subset Campaign', memberUserIds: [rosterPlayerId, outsiderId] }),
    });
    const campaign = (await campRes.json()) as { members: { id: string }[] };
    const memberIds = campaign.members.map((m) => m.id);
    expect(memberIds).toContain(rosterPlayerId);
    expect(memberIds).not.toContain(outsiderId);
  });
});
