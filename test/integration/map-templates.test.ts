// Integration (docs/12 Phase 3): Map Library templates -- upload/list, GM-only,
// and copy-on-assign into a new campaign's game_maps.
import { describe, it, expect } from 'vitest';
import { BACKEND_URL } from '../config';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const authH = (t: string) => ({ authorization: `Bearer ${t}` });

async function registerToken(displayName: string, pin: string): Promise<string> {
  const r = await fetch(BACKEND_URL + '/api/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName, pin }),
  });
  return ((await r.json()) as { token: string }).token;
}
async function createGame(token: string, name: string): Promise<string> {
  const r = await fetch(`${BACKEND_URL}/api/games`, {
    method: 'POST',
    headers: { ...authH(token), 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return ((await r.json()) as { id: string }).id;
}
function templateForm(name: string): FormData {
  const fd = new FormData();
  fd.append('image', new Blob([PNG], { type: 'image/png' }), 'map.png');
  fd.append('name', name);
  fd.append('gridSize', '70');
  fd.append('cols', '10');
  fd.append('rows', '8');
  return fd;
}

describe('map templates (Phase 3)', () => {
  it('GM uploads a template into the Map Library; a non-GM cannot', async () => {
    const gm = await registerToken('TemplateGm', '1234');
    const gameId = await createGame(gm, 'Template Setting');

    const up = await fetch(`${BACKEND_URL}/api/games/${gameId}/templates`, {
      method: 'POST',
      headers: authH(gm),
      body: templateForm('Dungeon Template'),
    });
    expect(up.status).toBe(201);
    const template = (await up.json()) as { id: string; assetPath: string; cols: number };
    expect(template.assetPath).toMatch(/^\/assets\//);
    expect(template.cols).toBe(10);

    const list = (await (
      await fetch(`${BACKEND_URL}/api/games/${gameId}/templates`, { headers: authH(gm) })
    ).json()) as { id: string }[];
    expect(list.some((t) => t.id === template.id)).toBe(true);

    const intruder = await registerToken('TemplateIntruder', '1234');
    const forbidden = await fetch(`${BACKEND_URL}/api/games/${gameId}/templates`, {
      method: 'POST',
      headers: authH(intruder),
      body: templateForm('Nope'),
    });
    expect(forbidden.status).toBe(403);
  });
});

describe('copy-on-assign (Phase 3)', () => {
  it("copies selected templates into the new campaign's game_maps, dropping foreign ids", async () => {
    const gm = await registerToken('CopyAssignGm', '1234');
    const gameId = await createGame(gm, 'Copy Setting');
    const template = (await (
      await fetch(`${BACKEND_URL}/api/games/${gameId}/templates`, {
        method: 'POST', headers: authH(gm), body: templateForm('Copy Template'),
      })
    ).json()) as { id: string };

    const otherGm = await registerToken('CopyAssignOtherGm', '1234');
    const otherGameId = await createGame(otherGm, 'Other Setting');
    const foreignTemplate = (await (
      await fetch(`${BACKEND_URL}/api/games/${otherGameId}/templates`, {
        method: 'POST', headers: authH(otherGm), body: templateForm('Foreign Template'),
      })
    ).json()) as { id: string };

    const campRes = await fetch(`${BACKEND_URL}/api/campaigns`, {
      method: 'POST',
      headers: { ...authH(gm), 'content-type': 'application/json' },
      body: JSON.stringify({ gameId, name: 'Copy Campaign', templateIds: [template.id, foreignTemplate.id] }),
    });
    const campaign = (await campRes.json()) as { id: string };

    const maps = (await (
      await fetch(`${BACKEND_URL}/api/campaigns/${campaign.id}/maps`, { headers: authH(gm) })
    ).json()) as { name: string }[];
    expect(maps.map((m) => m.name)).toEqual(['Copy Template']);
  });
});
