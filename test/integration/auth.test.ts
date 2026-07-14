// Integration specs: the auth REST + campaign lobby + socket handshake, against
// a started backend + the vtt_test DB (reset in global-setup). Formalizes the
// throwaway auth check from Phase 2.5.
import { describe, it, expect } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { BACKEND_URL } from '../config';

const MAP = '44444444-4444-4444-4444-444444444444';
const CAMPAIGN = '33333333-3333-3333-3333-333333333333';

async function jf(path: string, opts: RequestInit = {}) {
  const res = await fetch(BACKEND_URL + path, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* 204 */
  }
  return { status: res.status, body };
}
const authH = (t: string) => ({ authorization: `Bearer ${t}` });

function connect(token?: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(BACKEND_URL, { auth: token ? { token } : {}, transports: ['websocket'], forceNew: true });
    const timer = setTimeout(() => { s.close(); reject(new Error('connect timeout')); }, 4000);
    s.on('connect', () => { clearTimeout(timer); resolve(s); });
    s.on('connect_error', (e) => { clearTimeout(timer); reject(e); });
  });
}
function join(s: Socket, mapId: string): Promise<any> {
  return new Promise((res) => s.emit('join_map' as any, { mapId } as any, res as any));
}
function nextState(s: Socket): Promise<any> {
  return new Promise((res) => s.once('state_sync' as any, res as any));
}

describe('auth REST', () => {
  it('registers, rejects duplicates and bad PINs', async () => {
    const reg = await jf('/api/register', { method: 'POST', body: JSON.stringify({ displayName: 'Tester', pin: '1234' }) });
    expect(reg.status).toBe(201);
    expect(typeof reg.body.token).toBe('string');
    expect((await jf('/api/register', { method: 'POST', body: JSON.stringify({ displayName: 'Tester', pin: '5555' }) })).status).toBe(409);
    expect((await jf('/api/register', { method: 'POST', body: JSON.stringify({ displayName: 'X', pin: '12' }) })).status).toBe(400);
  });

  it('logs in the seeded GM (bcryptjs verifies the pgcrypto seed hash)', async () => {
    const ok = await jf('/api/login', { method: 'POST', body: JSON.stringify({ displayName: 'Game Master', pin: '1234' }) });
    expect(ok.status).toBe(200);
    expect(typeof ok.body.token).toBe('string');
    const bad = await jf('/api/login', { method: 'POST', body: JSON.stringify({ displayName: 'Game Master', pin: '9999' }) });
    expect(bad.status).toBe(401);
  });

  it('rate-limits after repeated failures', async () => {
    for (let i = 0; i < 5; i++) {
      await jf('/api/login', { method: 'POST', body: JSON.stringify({ displayName: 'RateTgt', pin: '0000' }) });
    }
    expect((await jf('/api/login', { method: 'POST', body: JSON.stringify({ displayName: 'RateTgt', pin: '0000' }) })).status).toBe(429);
  });

  it('validates /me and requires a token', async () => {
    const { body } = await jf('/api/login', { method: 'POST', body: JSON.stringify({ displayName: 'Game Master', pin: '1234' }) });
    const me = await jf('/api/me', { headers: authH(body.token) });
    expect(me.body.user.displayName).toBe('Game Master');
    expect((await jf('/api/me')).status).toBe(401);
  });

  it('enforces the join code', async () => {
    const { body } = await jf('/api/register', { method: 'POST', body: JSON.stringify({ displayName: 'Joiner', pin: '1111' }) });
    const t = body.token;
    expect((await jf(`/api/campaigns/${CAMPAIGN}/join`, { method: 'POST', headers: authH(t), body: JSON.stringify({ joinCode: 'WRONG' }) })).status).toBe(403);
    expect((await jf(`/api/campaigns/${CAMPAIGN}/join`, { method: 'POST', headers: authH(t), body: JSON.stringify({ joinCode: 'DEMO42' }) })).status).toBe(200);
  });
});

describe('socket handshake + join_map', () => {
  async function gmToken() {
    return (await jf('/api/login', { method: 'POST', body: JSON.stringify({ displayName: 'Game Master', pin: '1234' }) })).body.token;
  }
  async function playerToken() {
    return (await jf('/api/login', { method: 'POST', body: JSON.stringify({ displayName: 'Player One', pin: '4321' }) })).body.token;
  }

  it('rejects a tokenless connection', async () => {
    await expect(connect()).rejects.toThrow(/unauthorized/);
  });

  it('GM sees both tokens; player has the hidden orc stripped', async () => {
    const gm = await connect(await gmToken());
    const gState = nextState(gm);
    const gAck = await join(gm, MAP);
    const gs = await gState;
    expect(gAck.ok).toBe(true);
    expect(gs.role).toBe('gm');
    expect(gs.tokens).toHaveLength(2);
    gm.close();

    const p = await connect(await playerToken());
    const pState = nextState(p);
    const pAck = await join(p, MAP);
    const ps = await pState;
    expect(pAck.ok).toBe(true);
    expect(ps.role).toBe('player');
    expect(ps.tokens).toHaveLength(1);
    expect(ps.tokens.every((t: { name: string }) => t.name !== 'Lurking Orc')).toBe(true);
    p.close();
  });

  it('rejects a non-member join', async () => {
    const { body } = await jf('/api/register', { method: 'POST', body: JSON.stringify({ displayName: 'Outsider', pin: '4321' }) });
    const s = await connect(body.token);
    const ack = await join(s, MAP);
    expect(ack.ok).toBe(false);
    expect(ack.reason).toBe('not_member');
    s.close();
  });
});
