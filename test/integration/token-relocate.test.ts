// Integration (gm-maps-1b): token_relocate — GM-only cross-map token move,
// plus the two-simultaneous-different-maps fog isolation scenario required by
// docs/11 §9 (Player A on one live tab, Player B on another, at the same time).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import pg from 'pg';
import { BACKEND_URL, TEST_DATABASE_URL } from '../config';

const CAMPAIGN = '33333333-3333-3333-3333-333333333333';
const JOIN_CODE = 'DEMO42';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

// Fixed UUIDs distinct from the seeded fixtures, so this file's rows never
// collide with backend/db/seed.sql or other test files.
const TAVERN_MAP = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1';
const DUNGEON_MAP = 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2';
const SHEET_A = 'a3a3a3a3-a3a3-a3a3-a3a3-a3a3a3a3a3a3';
const SHEET_B = 'b4b4b4b4-b4b4-b4b4-b4b4-b4b4b4b4b4b4';
const TOKEN_A = 'a5a5a5a5-a5a5-a5a5-a5a5-a5a5a5a5a5a5';
const TOKEN_B = 'b6b6b6b6-b6b6-b6b6-b6b6-b6b6b6b6b6b6';

const authH = (t: string) => ({ authorization: `Bearer ${t}` });

async function tokenFor(displayName: string, pin: string): Promise<string> {
  const r = await fetch(BACKEND_URL + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName, pin }),
  });
  return ((await r.json()) as { token: string }).token;
}
async function registerAndJoin(displayName: string, pin: string): Promise<{ token: string; userId: string }> {
  const r = await fetch(BACKEND_URL + '/api/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName, pin }),
  });
  const { token } = (await r.json()) as { token: string };
  await fetch(`${BACKEND_URL}/api/campaigns/${CAMPAIGN}/join`, {
    method: 'POST',
    headers: { ...authH(token), 'content-type': 'application/json' },
    body: JSON.stringify({ joinCode: JOIN_CODE }),
  });
  const me = (await (
    await fetch(`${BACKEND_URL}/api/me`, { headers: authH(token) })
  ).json()) as { user: { id: string } };
  return { token, userId: me.user.id };
}
async function uploadMap(campaignId: string, token: string, name: string): Promise<string> {
  const fd = new FormData();
  fd.append('image', new Blob([PNG], { type: 'image/png' }), 'map.png');
  fd.append('name', name);
  fd.append('gridSize', '70');
  fd.append('cols', '4');
  fd.append('rows', '4');
  const r = await fetch(`${BACKEND_URL}/api/campaigns/${campaignId}/maps`, {
    method: 'POST',
    headers: authH(token),
    body: fd,
  });
  return ((await r.json()) as { id: string }).id;
}
async function createCampaign(token: string, name: string): Promise<{ id: string }> {
  // docs/12: a campaign always belongs to a Game; mint a throwaway one here
  // since this file's helper only needs a second, isolated campaign.
  const game = await fetch(`${BACKEND_URL}/api/games`, {
    method: 'POST',
    headers: { ...authH(token), 'content-type': 'application/json' },
    body: JSON.stringify({ name: `${name} Game` }),
  });
  const { id: gameId } = (await game.json()) as { id: string };
  const r = await fetch(`${BACKEND_URL}/api/campaigns`, {
    method: 'POST',
    headers: { ...authH(token), 'content-type': 'application/json' },
    body: JSON.stringify({ gameId, name }),
  });
  return (await r.json()) as { id: string };
}

function connect(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(BACKEND_URL, { auth: { token }, transports: ['websocket'], forceNew: true });
    const timer = setTimeout(() => {
      s.close();
      reject(new Error('timeout'));
    }, 4000);
    s.on('connect', () => {
      clearTimeout(timer);
      resolve(s);
    });
    s.on('connect_error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}
function join(s: Socket, mapId: string): Promise<any> {
  return new Promise((res) => s.emit('join_map' as any, { mapId } as any, res as any));
}
function relocate(s: Socket, tokenId: string, toMapId: string, x: number, y: number): Promise<any> {
  return new Promise((res) =>
    s.emit('token_relocate' as any, { tokenId, toMapId, x, y } as any, res as any),
  );
}
function setLiveMaps(s: Socket, campaignId: string, liveMaps: any[]): Promise<any> {
  return new Promise((res) =>
    s.emit('set_live_maps' as any, { campaignId, liveMaps } as any, res as any),
  );
}
function once(s: Socket, event: string): Promise<any> {
  return new Promise((res) => s.once(event as any, res as any));
}

describe('token_relocate (gm-maps-1b)', () => {
  let playerA: { token: string; userId: string };
  let playerB: { token: string; userId: string };

  beforeAll(async () => {
    const gm = await tokenFor('Game Master', '1234');
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO game_maps (id, campaign_id, name, asset_path, grid_type, grid_size, cols, rows, revealed_tiles)
         VALUES ($1, $2, 'Tavern', '/assets/tavern.png', 'square', 70, 4, 4, '[]'::jsonb),
                ($3, $2, 'Dungeon', '/assets/dungeon.png', 'square', 70, 4, 4, '[]'::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [TAVERN_MAP, CAMPAIGN, DUNGEON_MAP],
      );

      playerA = await registerAndJoin('RelocatePlayerA', '1111');
      playerB = await registerAndJoin('RelocatePlayerB', '2222');

      await client.query(
        `INSERT INTO character_sheets (id, campaign_id, owner_user_id, name, system_data) VALUES
           ($1, $2, $3, 'Player A PC', '{}'::jsonb),
           ($4, $2, $5, 'Player B PC', '{}'::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [SHEET_A, CAMPAIGN, playerA.userId, SHEET_B, playerB.userId],
      );

      // Non-hidden player tokens: always visible regardless of fog, per
      // visibilityFilter.isVisibleToPlayers, so this test doesn't need to
      // manage revealed_tiles for either map.
      await client.query(
        `INSERT INTO tokens (id, map_id, character_sheet_id, name, type, x, y, hidden) VALUES
           ($1, $2, $3, 'Player A PC', 'player', 35, 35, false),
           ($4, $5, $6, 'Player B PC', 'player', 35, 35, false)
         ON CONFLICT (id) DO NOTHING`,
        [TOKEN_A, TAVERN_MAP, SHEET_A, TOKEN_B, DUNGEON_MAP, SHEET_B],
      );
    } finally {
      await client.end();
    }

    const gmSocket = await connect(gm);
    await join(gmSocket, TAVERN_MAP); // sets this GM socket's role='gm' for token_relocate auth
    const ack = await setLiveMaps(gmSocket, CAMPAIGN, [
      { mapId: TAVERN_MAP, title: 'Tavern', position: 0 },
      { mapId: DUNGEON_MAP, title: 'Dungeon', position: 1 },
    ]);
    if (!ack.ok) throw new Error('setup: set_live_maps failed');
    gmSocket.close();
  });

  it('relocates a token across two simultaneously-joined live maps without leaking either map to the wrong player', async () => {
    const gm = await tokenFor('Game Master', '1234');
    const gmSocket = await connect(gm);
    const gmAck = await join(gmSocket, TAVERN_MAP);
    expect(gmAck.ok).toBe(true);

    const bSocket = await connect(playerB.token);
    const bAck = await join(bSocket, DUNGEON_MAP);
    expect(bAck.ok).toBe(true);

    const aSocket = await connect(playerA.token);
    const aAck = await join(aSocket, TAVERN_MAP);
    expect(aAck.ok).toBe(true);

    const removedOnGm = once(gmSocket, 'token_remove');
    const addedOnB = once(bSocket, 'token_add');
    const relocatedOnA = once(aSocket, 'map_relocated');

    const relocAck = await relocate(gmSocket, TOKEN_A, DUNGEON_MAP, 35, 35);
    expect(relocAck.ok).toBe(true);

    const removed = await removedOnGm;
    expect(removed.tokenId).toBe(TOKEN_A);

    // Player B (on Dungeon) sees the relocated token appear, gated through the
    // same visibility filter as any other token_add.
    const added = await addedOnB;
    expect(added.token.id).toBe(TOKEN_A);
    expect(added.token.mapId).toBe(DUNGEON_MAP);
    expect(added.token.x).toBe(35);
    expect(added.token.y).toBe(35);

    // Player A is told to move; simulate the frontend's auto-rejoin.
    const relocatedPush = await relocatedOnA;
    expect(relocatedPush.mapId).toBe(DUNGEON_MAP);

    // Register the state_sync listener before emitting join_map: the server
    // emits state_sync before acking, so listening only after the ack
    // resolves would race the event.
    const rejoinStatePromise = once(aSocket, 'state_sync');
    const rejoinAck = await join(aSocket, DUNGEON_MAP);
    expect(rejoinAck.ok).toBe(true);
    const rejoinState = await rejoinStatePromise;
    expect(rejoinState.mapId).toBe(DUNGEON_MAP);
    expect(rejoinState.tokens.some((t: any) => t.id === TOKEN_A)).toBe(true);

    gmSocket.close();
    bSocket.close();
    aSocket.close();
  });

  it('rejects a player-issued token_relocate', async () => {
    const gm = await tokenFor('Game Master', '1234');
    const gmSocket = await connect(gm);
    await join(gmSocket, TAVERN_MAP);
    gmSocket.close();

    const s = await connect(playerB.token);
    await join(s, DUNGEON_MAP); // sets role='player'
    const ack = await relocate(s, TOKEN_B, TAVERN_MAP, 35, 35);
    expect(ack.ok).toBe(false);
    expect(ack.reason).toBe('unauthorized');
    s.close();
  });

  it('rejects relocating to a map in a different campaign', async () => {
    const gm = await tokenFor('Game Master', '1234');
    const foreignCampaign = await createCampaign(gm, 'Relocate Foreign Campaign');
    const foreignMap = await uploadMap(foreignCampaign.id, gm, 'Foreign Map');

    const gmSocket = await connect(gm);
    await join(gmSocket, TAVERN_MAP);
    const ack = await relocate(gmSocket, TOKEN_B, foreignMap, 35, 35);
    expect(ack.ok).toBe(false);
    expect(ack.reason).toBe('not_found');
    gmSocket.close();
  });

  it('rejects relocating to a map that is not a current live tab', async () => {
    const gm = await tokenFor('Game Master', '1234');
    const notLiveMap = await uploadMap(CAMPAIGN, gm, 'Not Live Yet');

    const gmSocket = await connect(gm);
    await join(gmSocket, TAVERN_MAP);
    const ack = await relocate(gmSocket, TOKEN_B, notLiveMap, 35, 35);
    expect(ack.ok).toBe(false);
    expect(ack.reason).toBe('not_live');
    gmSocket.close();
  });
});
