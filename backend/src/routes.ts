// REST API (/api): auth + campaign lobby. See docs/09 section 5.
import { Router } from 'express';
import type { Request, RequestHandler, Response } from 'express';
import type { AuthResponse } from '@vtt/shared';
import {
  bearerToken,
  clearFailures,
  hashPin,
  isValidName,
  isValidPin,
  newSessionToken,
  rateLimited,
  recordFailure,
  requireAuth,
  sha256,
  verifyPin,
} from './auth.js';
import * as repo from './repo.js';

/** Wrap an async handler so rejections reach Express's error path. */
const ah =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) =>
    fn(req, res).catch(next);

export const apiRouter = Router();

// POST /api/register -> 201 { token, user }. Auto-login. 409 on name collision.
apiRouter.post(
  '/register',
  ah(async (req, res) => {
    const { displayName, pin } = req.body ?? {};
    if (!isValidName(displayName) || !isValidPin(pin)) {
      res.status(400).json({ error: 'invalid' });
      return;
    }
    const pinHash = await hashPin(pin);
    let user;
    try {
      user = await repo.createUser(displayName.trim(), pinHash);
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        res.status(409).json({ error: 'name_taken' });
        return;
      }
      throw e;
    }
    const { token, tokenHash } = newSessionToken();
    await repo.createSession(tokenHash, user.id);
    res.status(201).json({ token, user } satisfies AuthResponse);
  }),
);

// POST /api/login -> { token, user }. Rate-limited; generic 401 (no user enum).
apiRouter.post(
  '/login',
  ah(async (req, res) => {
    const { displayName, pin } = req.body ?? {};
    if (!isValidName(displayName) || !isValidPin(pin)) {
      res.status(401).json({ error: 'bad_credentials' });
      return;
    }
    if (rateLimited(displayName)) {
      res.status(429).json({ error: 'rate_limited' });
      return;
    }
    const user = await repo.getUserByName(displayName.trim());
    const ok = user ? await verifyPin(pin, user.pinHash) : false;
    if (!user || !ok) {
      recordFailure(displayName);
      res.status(401).json({ error: 'bad_credentials' });
      return;
    }
    clearFailures(displayName);
    const { token, tokenHash } = newSessionToken();
    await repo.createSession(tokenHash, user.id);
    res.json({
      token,
      user: { id: user.id, displayName: user.displayName },
    } satisfies AuthResponse);
  }),
);

// POST /api/logout -> 204. Deletes the session row.
apiRouter.post(
  '/logout',
  requireAuth,
  ah(async (req, res) => {
    const token = bearerToken(req);
    if (token) await repo.deleteSession(sha256(token));
    res.status(204).end();
  }),
);

// GET /api/me -> { user }. Boot-time token validation.
apiRouter.get(
  '/me',
  requireAuth,
  ah(async (req, res) => {
    const user = await repo.getUserById(req.userId!);
    if (!user) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    res.json({ user });
  }),
);

// GET /api/campaigns -> lobby list.
apiRouter.get(
  '/campaigns',
  requireAuth,
  ah(async (req, res) => {
    res.json(await repo.listCampaigns(req.userId!));
  }),
);

// POST /api/campaigns -> 201 campaign detail. Caller becomes GM.
apiRouter.post(
  '/campaigns',
  requireAuth,
  ah(async (req, res) => {
    const { name, joinCode } = req.body ?? {};
    if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 80) {
      res.status(400).json({ error: 'invalid_name' });
      return;
    }
    const code = typeof joinCode === 'string' && joinCode.trim() ? joinCode.trim() : null;
    res.status(201).json(await repo.createCampaign(req.userId!, name.trim(), code));
  }),
);

// POST /api/campaigns/:id/join -> campaign detail. Validates join_code.
apiRouter.post(
  '/campaigns/:id/join',
  requireAuth,
  ah(async (req, res) => {
    const id = req.params.id!;
    const joinCode = typeof req.body?.joinCode === 'string' ? req.body.joinCode : undefined;
    const r = await repo.joinCampaign(req.userId!, id, joinCode);
    if (!r.ok) {
      res.status(r.reason === 'not_found' ? 404 : 403).json({ error: r.reason });
      return;
    }
    res.json(await repo.getCampaignDetail(id));
  }),
);

// GET /api/campaigns/:id -> detail (members only).
apiRouter.get(
  '/campaigns/:id',
  requireAuth,
  ah(async (req, res) => {
    const id = req.params.id!;
    if (!(await repo.isCampaignMember(id, req.userId!))) {
      res.status(403).json({ error: 'not_member' });
      return;
    }
    const detail = await repo.getCampaignDetail(id);
    if (!detail) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(detail);
  }),
);
