// Integration (docs/12 §4 Phase 5): campaign lifecycle transitions.
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
async function createGameAndCampaign(token: string, name: string): Promise<string> {
  const game = (await (
    await fetch(`${BACKEND_URL}/api/games`, {
      method: 'POST', headers: authH(token), body: JSON.stringify({ name: `${name} Game` }),
    })
  ).json()) as { id: string };
  const campaign = (await (
    await fetch(`${BACKEND_URL}/api/campaigns`, {
      method: 'POST', headers: authH(token), body: JSON.stringify({ gameId: game.id, name }),
    })
  ).json()) as { id: string };
  return campaign.id;
}

describe('campaign lifecycle (Phase 5)', () => {
  it('walks draft -> live -> paused -> live -> completed, rejecting invalid transitions', async () => {
    const gm = await registerToken('LifecycleGm', '1234');
    const campaignId = await createGameAndCampaign(gm, 'Lifecycle Campaign');

    const start = await fetch(`${BACKEND_URL}/api/campaigns/${campaignId}/start`, {
      method: 'POST', headers: authH(gm),
    });
    expect(start.status).toBe(200);
    expect((await start.json()).status).toBe('live');

    const startAgain = await fetch(`${BACKEND_URL}/api/campaigns/${campaignId}/start`, {
      method: 'POST', headers: authH(gm),
    });
    expect(startAgain.status).toBe(409);

    const end = await fetch(`${BACKEND_URL}/api/campaigns/${campaignId}/end`, {
      method: 'POST', headers: authH(gm),
    });
    expect(end.status).toBe(200);
    expect((await end.json()).status).toBe('paused');

    const resume = await fetch(`${BACKEND_URL}/api/campaigns/${campaignId}/start`, {
      method: 'POST', headers: authH(gm),
    });
    expect(resume.status).toBe(200);

    const complete = await fetch(`${BACKEND_URL}/api/campaigns/${campaignId}/complete`, {
      method: 'POST', headers: authH(gm),
    });
    expect(complete.status).toBe(200);
    expect((await complete.json()).status).toBe('completed');

    const completeAgain = await fetch(`${BACKEND_URL}/api/campaigns/${campaignId}/complete`, {
      method: 'POST', headers: authH(gm),
    });
    expect(completeAgain.status).toBe(409);
  });

  it('rejects a non-GM transition', async () => {
    const gm = await registerToken('LifecycleGm2', '1234');
    const campaignId = await createGameAndCampaign(gm, 'Lifecycle Campaign 2');
    const intruder = await registerToken('LifecycleIntruder', '1234');
    const res = await fetch(`${BACKEND_URL}/api/campaigns/${campaignId}/start`, {
      method: 'POST', headers: authH(intruder),
    });
    expect(res.status).toBe(403);
  });
});
