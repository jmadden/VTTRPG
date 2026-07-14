// REST API (/api): auth + campaign lobby + map library. See docs/09, docs/11.
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { Router } from 'express';
import type { Request, RequestHandler, Response } from 'express';
import multer from 'multer';
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

// Map image upload -> ASSET_DIR (served by /assets). Unique filenames so Pixi's
// URL-keyed Assets cache never collides. Images only, 20 MB cap.
const ASSET_DIR = process.env.ASSET_DIR ?? './uploads';
const upload = multer({
  storage: multer.diskStorage({
    destination: ASSET_DIR,
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

/** Require the caller to be the GM of the campaign in :id (runs before upload). */
const requireCampaignGm: RequestHandler = (req, res, next) => {
  void repo
    .isCampaignGm(req.params.id!, req.userId!)
    .then((ok) => {
      if (ok) next();
      else res.status(403).json({ error: 'not_gm' });
    })
    .catch(next);
};

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

// ── maps / library (Phase 1a) ──────────────────────────────────────────────

// GET /api/campaigns/:id/maps -> library list (members).
apiRouter.get(
  '/campaigns/:id/maps',
  requireAuth,
  ah(async (req, res) => {
    const id = req.params.id!;
    if (!(await repo.isCampaignMember(id, req.userId!))) {
      res.status(403).json({ error: 'not_member' });
      return;
    }
    res.json(await repo.listMapsForCampaign(id));
  }),
);

// POST /api/campaigns/:id/maps -> upload an image and create a map (GM only).
apiRouter.post(
  '/campaigns/:id/maps',
  requireAuth,
  requireCampaignGm,
  upload.single('image'),
  ah(async (req, res) => {
    const id = req.params.id!;
    if (!req.file) {
      res.status(400).json({ error: 'no_image' });
      return;
    }
    const name =
      typeof req.body.name === 'string' && req.body.name.trim() ? req.body.name.trim() : 'Map';
    const gridSize = Math.round(Number(req.body.gridSize)) || 70;
    const cols = Math.max(1, Math.round(Number(req.body.cols)) || 1);
    const rows = Math.max(1, Math.round(Number(req.body.rows)) || 1);
    const map = await repo.createMap(id, {
      name,
      assetPath: `/assets/${req.file.filename}`,
      gridType: 'square',
      gridSize,
      cols,
      rows,
    });
    res.status(201).json(map);
  }),
);

// POST /api/campaigns/:id/active-map -> set the campaign's active map (GM only).
apiRouter.post(
  '/campaigns/:id/active-map',
  requireAuth,
  requireCampaignGm,
  ah(async (req, res) => {
    const id = req.params.id!;
    const mapId = req.body?.mapId;
    if (typeof mapId !== 'string') {
      res.status(400).json({ error: 'invalid' });
      return;
    }
    const ok = await repo.setActiveMap(id, mapId);
    if (!ok) {
      res.status(404).json({ error: 'map_not_found' });
      return;
    }
    res.status(204).end();
  }),
);
