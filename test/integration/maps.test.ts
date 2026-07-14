// Integration: map upload / library list / set-active + authz, and that the
// active map's assetPath reaches the client in state_sync. (GM toolkit Phase 1a)
import { describe, it, expect } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { BACKEND_URL } from '../config';

const CAMPAIGN = '33333333-3333-3333-3333-333333333333';
// A 1x1 PNG; multer only checks the mimetype, cols/rows come from the fields.
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
function mapForm(name: string): FormData {
  const fd = new FormData();
  fd.append('image', new Blob([PNG], { type: 'image/png' }), 'map.png');
  fd.append('name', name);
  fd.append('gridSize', '70');
  fd.append('cols', '10');
  fd.append('rows', '8');
  return fd;
}
const authH = (t: string) => ({ authorization: `Bearer ${t}` });

function connect(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(BACKEND_URL, { auth: { token }, transports: ['websocket'], forceNew: true });
    const timer = setTimeout(() => { s.close(); reject(new Error('timeout')); }, 4000);
    s.on('connect', () => { clearTimeout(timer); resolve(s); });
    s.on('connect_error', (e) => { clearTimeout(timer); reject(e); });
  });
}

describe('maps (Phase 1a)', () => {
  it('GM uploads a map into the library; members list it; non-GM cannot upload', async () => {
    const gm = await tokenFor('Game Master', '1234');

    const up = await fetch(`${BACKEND_URL}/api/campaigns/${CAMPAIGN}/maps`, {
      method: 'POST',
      headers: authH(gm),
      body: mapForm('Dungeon'),
    });
    expect(up.status).toBe(201);
    const map = (await up.json()) as { id: string; assetPath: string; cols: number };
    expect(map.assetPath).toMatch(/^\/assets\//);
    expect(map.cols).toBe(10);

    const list = (await (
      await fetch(`${BACKEND_URL}/api/campaigns/${CAMPAIGN}/maps`, { headers: authH(gm) })
    ).json()) as { id: string }[];
    expect(list.some((m) => m.id === map.id)).toBe(true);

    // Player One is a member but not the GM -> forbidden to upload or set active.
    const player = await tokenFor('Player One', '4321');
    const pUp = await fetch(`${BACKEND_URL}/api/campaigns/${CAMPAIGN}/maps`, {
      method: 'POST',
      headers: authH(player),
      body: mapForm('Nope'),
    });
    expect(pUp.status).toBe(403);
    const pSet = await fetch(`${BACKEND_URL}/api/campaigns/${CAMPAIGN}/active-map`, {
      method: 'POST',
      headers: { ...authH(player), 'content-type': 'application/json' },
      body: JSON.stringify({ mapId: map.id }),
    });
    expect(pSet.status).toBe(403);
  });

  it('non-members cannot list; GM set-active flows assetPath into state_sync', async () => {
    const gm = await tokenFor('Game Master', '1234');
    const stranger = await registerToken('MapStranger', '9999');

    const sList = await fetch(`${BACKEND_URL}/api/campaigns/${CAMPAIGN}/maps`, {
      headers: authH(stranger),
    });
    expect(sList.status).toBe(403);

    // Upload a fresh map and make it active.
    const up = await fetch(`${BACKEND_URL}/api/campaigns/${CAMPAIGN}/maps`, {
      method: 'POST',
      headers: authH(gm),
      body: mapForm('Tavern'),
    });
    const map = (await up.json()) as { id: string; assetPath: string };
    const setRes = await fetch(`${BACKEND_URL}/api/campaigns/${CAMPAIGN}/active-map`, {
      method: 'POST',
      headers: { ...authH(gm), 'content-type': 'application/json' },
      body: JSON.stringify({ mapId: map.id }),
    });
    expect(setRes.status).toBe(204);

    // Joining that map delivers its assetPath in state_sync.
    const s = await connect(gm);
    const state = await new Promise<{ assetPath: string | null }>((res) => {
      s.once('state_sync', res as (p: unknown) => void);
      s.emit('join_map' as never, { mapId: map.id } as never, () => {});
    });
    expect(state.assetPath).toBe(map.assetPath);
    s.close();
  });
});
