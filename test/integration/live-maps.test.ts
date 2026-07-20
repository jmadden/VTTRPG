// Integration (gm-maps-1b): set_live_maps — GM-only, rewrites campaign_live_maps
// atomically, and broadcasts to every socket in the GM's own user:<id> room.
import { describe, it, expect } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { BACKEND_URL } from '../config';

const CAMPAIGN = '33333333-3333-3333-3333-333333333333';
const DEMO_MAP = '44444444-4444-4444-4444-444444444444';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function tokenFor(displayName: string, pin: string): Promise<string> {
  const r = await fetch(BACKEND_URL + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName, pin }),
  });
  return ((await r.json()) as { token: string }).token;
}
async function registerToken(displayName: string, pin: string): Promise<string> {
  const r = await fetch(BACKEND_URL + '/api/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName, pin }),
  });
  return ((await r.json()) as { token: string }).token;
}
const authH = (t: string) => ({ authorization: `Bearer ${t}` });

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
async function getCampaign(
  campaignId: string,
  token: string,
): Promise<{ liveMaps: { mapId: string; title: string; position: number }[] }> {
  const r = await fetch(`${BACKEND_URL}/api/campaigns/${campaignId}`, { headers: authH(token) });
  return (await r.json()) as { liveMaps: { mapId: string; title: string; position: number }[] };
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
function setLiveMaps(
  s: Socket,
  campaignId: string,
  liveMaps: { mapId: string; title: string; position: number }[],
): Promise<any> {
  return new Promise((res) =>
    s.emit('set_live_maps' as any, { campaignId, liveMaps } as any, res as any),
  );
}

describe('set_live_maps (gm-maps-1b)', () => {
  it('GM add/remove/reorder persists and re-broadcasts to every socket in the GM user room', async () => {
    const gmA = await tokenFor('Game Master', '1234');
    const tavernId = await uploadMap(CAMPAIGN, gmA, 'Tavern');

    const socketA = await connect(gmA);
    const socketB = await connect(gmA); // same GM, second device/tab

    const broadcastOnB = new Promise<any>((res) => socketB.once('set_live_maps' as any, res));

    const next = [
      { mapId: DEMO_MAP, title: 'Demo Map', position: 0 },
      { mapId: tavernId, title: 'Tavern', position: 1 },
    ];
    const ack = await setLiveMaps(socketA, CAMPAIGN, next);
    expect(ack.ok).toBe(true);
    expect(ack.liveMaps.map((m: any) => m.mapId)).toEqual([DEMO_MAP, tavernId]);

    const broadcast = await broadcastOnB;
    expect(broadcast.campaignId).toBe(CAMPAIGN);
    expect(broadcast.liveMaps.map((m: any) => m.mapId)).toEqual([DEMO_MAP, tavernId]);

    // Persisted: a fresh REST fetch sees the same live set.
    const detail = await getCampaign(CAMPAIGN, gmA);
    expect(detail.liveMaps.map((m) => m.mapId)).toEqual([DEMO_MAP, tavernId]);

    // Reorder + remove Tavern in one rewrite.
    const reordered = [{ mapId: DEMO_MAP, title: 'Demo Map', position: 0 }];
    const ack2 = await setLiveMaps(socketA, CAMPAIGN, reordered);
    expect(ack2.ok).toBe(true);
    expect(ack2.liveMaps.map((m: any) => m.mapId)).toEqual([DEMO_MAP]);

    socketA.close();
    socketB.close();
  });

  it('rejects a non-GM set_live_maps with no DB change', async () => {
    const player = await tokenFor('Player One', '4321');
    const gm = await tokenFor('Game Master', '1234');
    const before = await getCampaign(CAMPAIGN, gm);

    const s = await connect(player);
    const ack = await setLiveMaps(s, CAMPAIGN, [{ mapId: DEMO_MAP, title: 'Hijacked', position: 0 }]);
    expect(ack.ok).toBe(false);
    expect(ack.reason).toBe('not_gm');

    const after = await getCampaign(CAMPAIGN, gm);
    expect(after.liveMaps).toEqual(before.liveMaps);
    s.close();
  });

  it('silently drops a map_id belonging to a different campaign', async () => {
    const gm = await tokenFor('Game Master', '1234');
    const stranger = await registerToken('LiveMapsStranger', '9999');
    const otherCampaign = await createCampaign(stranger, 'Someone Else Campaign');
    const foreignMapId = await uploadMap(otherCampaign.id, stranger, 'Foreign Map');

    const s = await connect(gm);
    const ack = await setLiveMaps(s, CAMPAIGN, [
      { mapId: DEMO_MAP, title: 'Demo Map', position: 0 },
      { mapId: foreignMapId, title: 'Sneaky', position: 1 },
    ]);
    expect(ack.ok).toBe(true);
    expect(ack.liveMaps.map((m: any) => m.mapId)).toEqual([DEMO_MAP]);
    s.close();
  });
});
