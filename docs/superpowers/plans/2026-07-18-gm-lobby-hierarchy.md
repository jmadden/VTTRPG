# GM Lobby Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `games` layer above `campaigns` so a GM can reuse maps via a Game-scoped Map Library, maintain a standing player roster, and run multiple concurrent campaigns per Game with an explicit draft/live/paused/completed lifecycle — replacing the flat campaign-list Lobby with a Games sidebar shell.

**Architecture:** Three new backend tables (`games`, `map_templates`, `game_members`) sit above the existing `campaigns`/`game_maps`/`campaign_members` tables, which are otherwise untouched. Maps are copy-on-assign (never shared) from templates into a campaign's own `game_maps` rows, since fog-of-war/tokens are inherently per-playthrough. The frontend Lobby becomes a persistent-sidebar shell (Games list) with a Game page (Campaigns/Map Library/Roster tabs) nested under it; campaign creation becomes a single-page form with template/roster multi-select.

**Tech Stack:** Node/TypeScript/Express/Socket.io backend, raw `pg` (no ORM, schema edited in place via `backend/db/schema.sql` + `npm run db:reset`), Vite/React/TanStack Router/PixiJS frontend, Vitest + Playwright tests.

## Global Constraints

- No ORM, no migration files — schema changes go directly into `backend/db/schema.sql`; local/test DBs pick them up via `npm run db:reset` (docs/02).
- Everything docs/11 already built inside a campaign (`campaign_live_maps` tabs, tokens, per-map anti-cheat) is completely unchanged by this plan.
- Player-facing dashboard/UX, "rules/resources" content types, and presence-inferred live status are explicitly out of scope (docs/12 §9) — do not build them.
- Map templates are copy-on-assign only; never a shared/live reference between a Game's library and a Campaign's `game_maps`.
- All Game-level mutating actions (create/edit Game, Map Library, roster, Campaign create/lifecycle) require the caller to be `games.gm_user_id`, checked server-side — never trust a client-supplied role.

---

## File Structure

- `backend/db/schema.sql` — modify: add `campaign_status` enum, `games`/`map_templates`/`game_members` tables, `campaigns.game_id`/`status` columns, `game_maps.template_id` column.
- `backend/db/seed.sql` — modify: wrap the seeded demo campaign in an auto-created Game.
- `backend/db/migrate-games-hierarchy.sql` — create: one-time SQL a *deployed* instance runs to backfill Games for its existing campaigns (not needed for local dev, which uses `db:reset`).
- `shared/src/api.ts` — modify: new DTOs (`GameSummary`, `GameDetail`, `MapTemplateSummary`, `GameMemberDto`, `EligibleSheetDto`, `CampaignStatus`, `CreateCampaignRequest`); add `status` to `CampaignSummary`/`CampaignDetail`.
- `backend/src/repo.ts` — modify: append Games/Map Library/Roster/lifecycle data-access functions under new banner-comment sections, following the file's existing SQL-string + row-interface + mapper pattern.
- `backend/src/routes.ts` — modify: append `requireGameGm` middleware and all new `/api/games*` and lifecycle routes.
- `frontend/src/router.tsx` — modify: full route-tree rewrite adding the Games sidebar layout and nested Game/Campaign-creation routes.
- `frontend/src/routes/Lobby.tsx` — rewrite: becomes the sidebar shell (Games list + create).
- `frontend/src/routes/LobbyHome.tsx` — create: the preserved flat "Your Campaigns" player view.
- `frontend/src/routes/GamePage.tsx`, `GameCampaignsTab.tsx`, `GameMapLibraryTab.tsx`, `GameRosterTab.tsx`, `CreateCampaignPage.tsx` — create: the Game detail page and its three tabs plus the campaign-creation form.
- `frontend/src/routes/mapUpload.ts`, `frontend/src/routes/ui.ts` — modify: template-upload helper and status-badge styling.
- `frontend/src/api.ts` — modify: REST client methods for every new route.
- `test/integration/games.test.ts`, `map-templates.test.ts`, `roster.test.ts`, `campaign-lifecycle.test.ts` — create: Vitest integration coverage per phase.
- `test/e2e/login.spec.ts`, `tabs-relocate.spec.ts` — modify: fix GM login flow for the new sidebar. `test/e2e/campaign-lifecycle.spec.ts` — create: full acceptance flow.

---

# Phase 1 — Schema, shared types, Games CRUD backend

### Task 1: Schema deltas

**Files:**
- Modify: `backend/db/schema.sql`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `campaign_status` enum (`draft`/`live`/`paused`/`completed`); tables `games`, `map_templates`, `game_members`; `campaigns.game_id`/`campaigns.status`; `game_maps.template_id`. All consumed by every later task in this plan.

- [ ] **Step 1: Edit `backend/db/schema.sql`**

Add near the existing `grid_type`/`token_type` enum block:

```sql
DO $$ BEGIN
  CREATE TYPE campaign_status AS ENUM ('draft', 'live', 'paused', 'completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

Add a new `games` table (place it before `campaigns` since `campaigns` will reference it):

```sql
CREATE TABLE IF NOT EXISTS games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gm_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  description TEXT,
  join_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS games_gm_user_id_idx ON games (gm_user_id);
```

Add `game_id` and `status` to `campaigns` (edit the existing `CREATE TABLE IF NOT EXISTS campaigns (...)` block to add these two columns before the closing paren):

```sql
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  status campaign_status NOT NULL DEFAULT 'draft',
```

```sql
CREATE INDEX IF NOT EXISTS campaigns_game_id_idx ON campaigns (game_id);
```

Add `map_templates`:

```sql
CREATE TABLE IF NOT EXISTS map_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  asset_path TEXT NOT NULL,
  grid_type grid_type NOT NULL DEFAULT 'square',
  grid_size INT NOT NULL,
  cols INT NOT NULL,
  rows INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS map_templates_game_id_idx ON map_templates (game_id);
```

Add `game_members`:

```sql
CREATE TABLE IF NOT EXISTS game_members (
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_sheet_id UUID REFERENCES character_sheets(id) ON DELETE SET NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, user_id)
);
```

Add `template_id` to `game_maps` (edit the existing `CREATE TABLE IF NOT EXISTS game_maps (...)` block):

```sql
  template_id UUID REFERENCES map_templates(id) ON DELETE SET NULL,
```

- [ ] **Step 2: Run a schema reset to verify it applies cleanly**

Run: `npm run db:reset`
Expected: exits 0 with no SQL errors; `psql -d vtt -c '\d games'` (or equivalent) shows the new table.

- [ ] **Step 3: Commit**

```bash
git add backend/db/schema.sql
git commit -m "feat(schema): add games/map_templates/game_members tables and campaign lifecycle status"
```

---

### Task 2: Shared types

**Files:**
- Modify: `shared/src/api.ts`

**Interfaces:**
- Consumes: Task 1's schema shapes.
- Produces: `GameSummary`, `GameDetail`, `MapTemplateSummary`, `GameMemberDto`, `EligibleSheetDto`, `CampaignStatus`, `CreateCampaignRequest`; `status: CampaignStatus` added to `CampaignSummary`/`CampaignDetail`. Every later task imports these exact names from `@vtt/shared`.

- [ ] **Step 1: Edit `shared/src/api.ts`**

Add `status: CampaignStatus;` as a new field to the existing `CampaignSummary` and `CampaignDetail` interfaces, then append:

```ts
export type CampaignStatus = 'draft' | 'live' | 'paused' | 'completed';

export interface GameSummary {
  id: string;
  name: string;
  description?: string;
  campaignCount: number;
  memberCount: number;
  joinCode: string;
}

export interface MapTemplateSummary {
  id: string;
  gameId: string;
  name: string;
  assetPath: string;
  gridType: 'square' | 'hex';
  gridSize: number;
  cols: number;
  rows: number;
}

export interface GameMemberDto {
  userId: string;
  displayName: string;
  characterSheetId: string | null;
}

export interface EligibleSheetDto {
  id: string;
  name: string;
}

export interface GameDetail extends GameSummary {
  campaigns: CampaignSummary[];
  mapTemplates: MapTemplateSummary[];
  members: GameMemberDto[];
}

export interface CreateCampaignRequest {
  gameId: string;
  name: string;
  joinCode?: string;
  templateIds?: string[];
  memberUserIds?: string[];
}
```

- [ ] **Step 2: Run typecheck to verify it passes**

Run: `npm run typecheck -w shared`
Expected: PASS (pure type additions, no consumers reference them yet).

- [ ] **Step 3: Commit**

```bash
git add shared/src/api.ts
git commit -m "feat(shared): add Games/Map Library/Roster DTOs and campaign status"
```

---

### Task 3: `repo.ts` Games CRUD basics

**Files:**
- Modify: `backend/src/repo.ts`
- Test: create `test/integration/games.test.ts`

**Interfaces:**
- Consumes: `games` table (Task 1), `GameSummary` (Task 2).
- Produces: `createGame(userId: string, name: string, description?: string): Promise<GameSummary>`, `listGames(userId: string): Promise<GameSummary[]>`, `isGameGm(gameId: string, userId: string): Promise<boolean>`. Consumed by Task 4 (inline auth check), Task 8 (middleware), and every later Games route.

- [ ] **Step 1: Write the failing test**

Create `test/integration/games.test.ts`:

```ts
// Integration (docs/12 Phase 1): Games CRUD basics.
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/integration/games.test.ts`
Expected: FAIL — `404` (`/api/games` doesn't exist yet).

- [ ] **Step 3: Edit `backend/src/repo.ts`**

Append a new banner-comment section:

```ts

// ── games ──────────────────────────────────────────────────────────────────

export interface GameRow {
  id: string;
  name: string;
  description: string | null;
  join_code: string;
  campaign_count: string;
  member_count: string;
}

function toGameSummary(row: GameRow): GameSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    campaignCount: Number(row.campaign_count),
    memberCount: Number(row.member_count),
    joinCode: row.join_code,
  };
}

/** Create a Game, generating its standing-roster join code. */
export async function createGame(userId: string, name: string, description?: string): Promise<GameSummary> {
  const joinCode = crypto.randomUUID().slice(0, 8).toUpperCase();
  const res = await query<GameRow>(
    `INSERT INTO games (gm_user_id, name, description, join_code)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, description, join_code, 0 AS campaign_count, 0 AS member_count`,
    [userId, name, description ?? null, joinCode],
  );
  return toGameSummary(res.rows[0]!);
}

/** List every Game the user GMs (Player-facing "my Games" is out of scope, docs/12 §9). */
export async function listGames(userId: string): Promise<GameSummary[]> {
  const res = await query<GameRow>(
    `SELECT g.id, g.name, g.description, g.join_code,
            (SELECT count(*) FROM campaigns c WHERE c.game_id = g.id) AS campaign_count,
            (SELECT count(*) FROM game_members gm WHERE gm.game_id = g.id) AS member_count
       FROM games g
      WHERE g.gm_user_id = $1
      ORDER BY g.created_at`,
    [userId],
  );
  return res.rows.map(toGameSummary);
}

export async function isGameGm(gameId: string, userId: string): Promise<boolean> {
  const res = await query('SELECT 1 FROM games WHERE id = $1 AND gm_user_id = $2', [gameId, userId]);
  return res.rows.length > 0;
}
```

- [ ] **Step 4: Edit `backend/src/routes.ts`**

Append (using the file's existing `ah()` async-handler wrapper and `requireAuth` middleware):

```ts

// ── games (Phase 1) ────────────────────────────────────────────────────────

apiRouter.post(
  '/games',
  requireAuth,
  ah(async (req, res) => {
    const { name, description } = req.body ?? {};
    if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 80) {
      res.status(400).json({ error: 'invalid_name' });
      return;
    }
    const desc = typeof description === 'string' && description.trim() ? description.trim() : undefined;
    res.status(201).json(await repo.createGame(req.userId!, name.trim(), desc));
  }),
);

apiRouter.get(
  '/games',
  requireAuth,
  ah(async (req, res) => {
    res.json(await repo.listGames(req.userId!));
  }),
);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/integration/games.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/repo.ts backend/src/routes.ts test/integration/games.test.ts
git commit -m "feat(games): add Games CRUD basics (createGame/listGames/isGameGm)"
```

---

### Task 4: `createCampaign` moves under a Game

**Files:**
- Modify: `backend/src/repo.ts`, `backend/src/routes.ts`
- Test: extend `test/integration/games.test.ts`

**Interfaces:**
- Consumes: `isGameGm` (Task 3).
- Produces: `repo.createCampaign(userId: string, gameId: string, name: string, joinCode: string | null): Promise<CampaignDetail>` (this exact 4-arg signature is what Task 15 and Task 21 later extend additively). Route `POST /api/campaigns`.

- [ ] **Step 1: Write the failing test**

Append to `test/integration/games.test.ts`:

```ts
describe('campaign creation under a Game (Phase 1)', () => {
  it('creates a campaign scoped to a Game; rejects a non-GM', async () => {
    const gm = await registerToken('CampaignGm', '1234');
    const game = (await (
      await fetch(`${BACKEND_URL}/api/games`, {
        method: 'POST', headers: authH(gm), body: JSON.stringify({ name: 'Setting' }),
      })
    ).json()) as { id: string };

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/integration/games.test.ts`
Expected: FAIL — `POST /api/campaigns` either 404s or still uses its old `(name, joinCode)`-only signature with no `game_id`.

- [ ] **Step 3: Edit `backend/src/repo.ts`**

Replace the existing `createCampaign` function with:

```ts
export async function createCampaign(
  userId: string,
  gameId: string,
  name: string,
  joinCode: string | null,
): Promise<CampaignDetail> {
  const res = await query<{ id: string }>(
    `WITH c AS (
       INSERT INTO campaigns (name, gm_user_id, join_code, game_id)
       VALUES ($1, $2, $3, $4) RETURNING id, gm_user_id
     ), m AS (
       INSERT INTO campaign_members (campaign_id, user_id) SELECT id, gm_user_id FROM c
     )
     SELECT id FROM c`,
    [name, userId, joinCode, gameId],
  );
  return (await getCampaignDetail(res.rows[0]!.id, userId))!;
}
```

(If `getCampaignDetail` does not yet select/return a `status` column on `CampaignDetail`, add `status` to its existing `SELECT` list and returned object now — `campaigns.status` defaults to `'draft'` per Task 1's schema, so no other change is needed there.)

- [ ] **Step 4: Edit `backend/src/routes.ts`**

Replace the existing `POST /api/campaigns` handler with:

```ts
apiRouter.post(
  '/campaigns',
  requireAuth,
  ah(async (req, res) => {
    const { gameId, name, joinCode } = req.body ?? {};
    if (typeof gameId !== 'string' || gameId.trim().length < 1) {
      res.status(400).json({ error: 'invalid_game' });
      return;
    }
    if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 80) {
      res.status(400).json({ error: 'invalid_name' });
      return;
    }
    if (!(await repo.isGameGm(gameId, req.userId!))) {
      res.status(403).json({ error: 'not_game_gm' });
      return;
    }
    const code = typeof joinCode === 'string' && joinCode.trim() ? joinCode.trim() : null;
    res.status(201).json(await repo.createCampaign(req.userId!, gameId, name.trim(), code));
  }),
);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/integration/games.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/repo.ts backend/src/routes.ts test/integration/games.test.ts
git commit -m "feat(games): move campaign creation under a Game (game_id required, GM-only)"
```

---

### Task 5: Seed data — wrap the demo campaign in a Game

**Files:**
- Modify: `backend/db/seed.sql`

**Interfaces:**
- Consumes: `games` table (Task 1).
- Produces: a seeded `games` row (fixed UUID `88888888-8888-8888-8888-888888888888`) that the existing seeded "Demo Campaign" (`33333333-...`) belongs to, and a `game_members` row for the seeded Player One. Consumed by every e2e test that logs in as the seeded GM (Tasks 12–13) and expects a Game to click into.

- [ ] **Step 1: Edit `backend/db/seed.sql`**

Add before the existing campaign insert:

```sql
INSERT INTO games (id, gm_user_id, name, description, join_code)
VALUES (
  '88888888-8888-8888-8888-888888888888',
  '11111111-1111-1111-1111-111111111111',
  'Demo Campaign',
  NULL,
  'GAMEDEMO'
)
ON CONFLICT (id) DO NOTHING;
```

Edit the existing `INSERT INTO campaigns (...)` statement to add `game_id` with value `'88888888-8888-8888-8888-888888888888'` alongside its existing columns.

Add a `game_members` row for the seeded player, after the existing `campaign_members` inserts:

```sql
INSERT INTO game_members (game_id, user_id)
VALUES ('88888888-8888-8888-8888-888888888888', '22222222-2222-2222-2222-222222222222')
ON CONFLICT DO NOTHING;
```

- [ ] **Step 2: Run a reset+seed to verify it applies cleanly**

Run: `npm run db:setup`
Expected: exits 0; querying `SELECT * FROM games` shows the seeded row; `SELECT game_id FROM campaigns WHERE id = '33333333-3333-3333-3333-333333333333'` returns `88888888-...`.

- [ ] **Step 3: Commit**

```bash
git add backend/db/seed.sql
git commit -m "feat(seed): wrap the seeded demo campaign in a Game"
```

---

### Task 6: `getGameDetail` + `listGameMembers`

**Files:**
- Modify: `backend/src/repo.ts`
- Test: extend `test/integration/games.test.ts`

**Interfaces:**
- Consumes: `game_members` table (Task 1), `GameDetail`/`GameMemberDto` (Task 2).
- Produces: `getGameDetail(gameId: string, userId: string): Promise<GameDetail | null>`, `listGameMembers(gameId: string): Promise<GameMemberDto[]>` (fully implemented here, not a stub — consumed as-is by Task 18's route). `getGameDetail`'s `mapTemplates` field is `[]` until Task 8 adds `listMapTemplates`.

- [ ] **Step 1: Write the failing test**

Append to `test/integration/games.test.ts`:

```ts
describe('game detail assembly (Phase 1)', () => {
  it('assembles campaigns and members for a Game', async () => {
    const gm = await registerToken('DetailGm', '1234');
    const game = (await (
      await fetch(`${BACKEND_URL}/api/games`, {
        method: 'POST', headers: authH(gm), body: JSON.stringify({ name: 'Detail Setting' }),
      })
    ).json()) as { id: string };
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/integration/games.test.ts`
Expected: FAIL — `GET /api/games/:id` doesn't exist yet (added in Task 8, which depends on this task's `getGameDetail`).

- [ ] **Step 3: Edit `backend/src/repo.ts`**

Append:

```ts

/** Every Game-level roster member with their persistent character sheet, if any. */
export async function listGameMembers(gameId: string): Promise<GameMemberDto[]> {
  const res = await query<{ user_id: string; display_name: string; character_sheet_id: string | null }>(
    `SELECT gm.user_id, u.display_name, gm.character_sheet_id
       FROM game_members gm JOIN users u ON u.id = gm.user_id
      WHERE gm.game_id = $1
      ORDER BY gm.joined_at`,
    [gameId],
  );
  return res.rows.map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    characterSheetId: r.character_sheet_id,
  }));
}

/** Assembles the full Game detail: campaigns, roster, and (until Task 8) an
 *  empty map template list. */
export async function getGameDetail(gameId: string, userId: string): Promise<GameDetail | null> {
  const games = await listGames(userId);
  const game = games.find((g) => g.id === gameId);
  if (!game) return null;

  const campaignsRes = await query<{ id: string }>(
    'SELECT id FROM campaigns WHERE game_id = $1 ORDER BY created_at',
    [gameId],
  );
  const campaigns = (
    await Promise.all(campaignsRes.rows.map((r) => getCampaignDetail(r.id, userId)))
  ).filter((c): c is CampaignDetail => c !== null);

  const members = await listGameMembers(gameId);

  return { ...game, campaigns, mapTemplates: [], members };
}
```

- [ ] **Step 4: Run test (still expected FAIL until Task 8 adds the route)**

Run: `npx vitest run test/integration/games.test.ts`
Expected: FAIL — `GET /api/games/:id` 404s (route added in Task 8). Proceed directly to Task 7, then Task 8, before committing this test file's final state.

- [ ] **Step 5: Commit `repo.ts` alone for now**

```bash
git add backend/src/repo.ts
git commit -m "feat(games): add getGameDetail and listGameMembers"
```

---

### Task 7: Deployment migration script

**Files:**
- Create: `backend/db/migrate-games-hierarchy.sql`

**Interfaces:**
- Consumes: `games`/`game_members` tables (Task 1).
- Produces: a one-time, manually-run SQL script. Not consumed by any other task or by `npm test` — this step is intentionally not automated, since it operates on a real deployed instance's pre-existing data, which local dev/test never has (a fresh DB via `db:reset` has no pre-existing campaigns to migrate).

- [ ] **Step 1: Create `backend/db/migrate-games-hierarchy.sql`**

```sql
-- One-time migration for a DEPLOYED instance upgrading to the Games hierarchy
-- (docs/12 §6). Local dev/test never needs this: npm run db:reset always starts
-- from an empty schema, so there is no pre-existing data to wrap.
--
-- Run once, after applying schema.sql's new tables/columns to the deployed DB,
-- and BEFORE the application code that requires campaigns.game_id NOT NULL is
-- deployed (this script must run while game_id is still nullable/absent of a
-- NOT NULL constraint, or be run as part of the same maintenance window as the
-- schema.sql change, applying the NOT NULL constraint only after this backfill
-- completes).

-- 1. Wrap every existing campaign in its own new Game.
INSERT INTO games (id, gm_user_id, name)
SELECT gen_random_uuid(), c.gm_user_id, c.name
  FROM campaigns c
 WHERE c.game_id IS NULL;

-- 2. Point each campaign at the Game just created for it (matched by name +
--    gm_user_id, which is unique for this one-time backfill since each Game
--    above was minted 1:1 from a campaign in the same statement batch).
UPDATE campaigns c
   SET game_id = g.id
  FROM games g
 WHERE c.game_id IS NULL
   AND g.gm_user_id = c.gm_user_id
   AND g.name = c.name;

-- 3. Back-fill each new Game's roster from that campaign's existing members.
INSERT INTO game_members (game_id, user_id)
SELECT c.game_id, cm.user_id
  FROM campaign_members cm JOIN campaigns c ON c.id = cm.campaign_id
 ON CONFLICT DO NOTHING;

-- 4. Only after confirming every campaigns.game_id is populated (SELECT count(*)
--    FROM campaigns WHERE game_id IS NULL; -- should be 0), apply the NOT NULL
--    constraint if schema.sql's CREATE TABLE IF NOT EXISTS didn't already do so
--    on a fresh table:
-- ALTER TABLE campaigns ALTER COLUMN game_id SET NOT NULL;
```

- [ ] **Step 2: No automated test — document manual verification**

This script is not run by `npm test` (no pre-existing deployed data exists locally to migrate). Before running it against a real deployed instance: back up the database, run the script inside a transaction (`BEGIN; ... ; -- inspect row counts; COMMIT;`), and confirm `SELECT count(*) FROM campaigns WHERE game_id IS NULL` returns `0` before committing.

- [ ] **Step 3: Commit**

```bash
git add backend/db/migrate-games-hierarchy.sql
git commit -m "docs(migration): add one-time deployed-instance Games backfill script"
```

---

### Task 8: `requireGameGm` middleware + `GET /api/games/:id` + Map Library stub

**Files:**
- Modify: `backend/src/repo.ts`, `backend/src/routes.ts`
- Test: extend `test/integration/games.test.ts`

**Interfaces:**
- Consumes: `isGameGm` (Task 3), `getGameDetail` (Task 6).
- Produces: `repo.listMapTemplates(gameId: string): Promise<MapTemplateSummary[]>` (stub, always `[]` until Task 14), Express middleware `requireGameGm`, route `GET /api/games/:id`. `requireGameGm` and `listMapTemplates` are consumed as-is by Task 14 (Map Library routes) and Task 17–19 (Roster routes).

- [ ] **Step 1: Write the failing test**

Append to `test/integration/games.test.ts`:

```ts
describe('requireGameGm (Phase 1)', () => {
  it('GET /api/games/:id succeeds for the GM, 403s for anyone else', async () => {
    const gm = await registerToken('MiddlewareGm', '1234');
    const game = (await (
      await fetch(`${BACKEND_URL}/api/games`, {
        method: 'POST', headers: authH(gm), body: JSON.stringify({ name: 'MW Setting' }),
      })
    ).json()) as { id: string };

    const ok = await fetch(`${BACKEND_URL}/api/games/${game.id}`, { headers: authH(gm) });
    expect(ok.status).toBe(200);

    const intruder = await registerToken('MiddlewareIntruder', '1234');
    const forbidden = await fetch(`${BACKEND_URL}/api/games/${game.id}`, { headers: authH(intruder) });
    expect(forbidden.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/integration/games.test.ts`
Expected: FAIL — `404` (route doesn't exist).

- [ ] **Step 3: Edit `backend/src/repo.ts`**

Append:

```ts

/** Map Library for a Game (stub — Task 14 implements the real upload/list). */
export async function listMapTemplates(_gameId: string): Promise<MapTemplateSummary[]> {
  return [];
}
```

- [ ] **Step 4: Edit `backend/src/routes.ts`**

Append the middleware near the existing `requireCampaignGm` definition, following its exact shape:

```ts

const requireGameGm: RequestHandler = (req, res, next) => {
  void repo.isGameGm(req.params.id!, req.userId!)
    .then((ok) => { if (ok) next(); else res.status(403).json({ error: 'not_game_gm' }); })
    .catch(next);
};
```

Append the route:

```ts

apiRouter.get(
  '/games/:id',
  requireAuth,
  requireGameGm,
  ah(async (req, res) => {
    const detail = await repo.getGameDetail(req.params.id!, req.userId!);
    if (!detail) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(detail);
  }),
);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/integration/games.test.ts`
Expected: PASS (all tests in the file, including Task 6's detail-assembly test).

- [ ] **Step 6: Commit**

```bash
git add backend/src/repo.ts backend/src/routes.ts test/integration/games.test.ts
git commit -m "feat(games): add requireGameGm middleware and GET /api/games/:id"
```

---

# Phase 2 — Lobby shell + Game page (frontend)

### Task 9: Frontend `api.ts` — Games client methods; `createCampaign` takes a request object

**Files:**
- Modify: `frontend/src/api.ts`

**Interfaces:**
- Consumes: `GET/POST /api/games`, `GET /api/games/:id` (Tasks 3, 8), `CreateCampaignRequest` (Task 2).
- Produces: `api.listGames(): Promise<GameSummary[]>`, `api.createGame(name, description?): Promise<GameSummary>`, `api.getGame(gameId): Promise<GameDetail>`, `api.createCampaign(body: CreateCampaignRequest): Promise<CampaignDetail>` (replaces the old 2-arg form).

- [ ] **Step 1: Add type imports**

In `frontend/src/api.ts`, add `GameSummary`, `GameDetail`, `CreateCampaignRequest` to the existing `import type { ... } from '@vtt/shared'` block.

- [ ] **Step 2: Edit `frontend/src/api.ts`**

Append to the `api` object:

```ts
  listGames: () => req<GameSummary[]>('/api/games'),
  createGame: (name: string, description?: string) =>
    req<GameSummary>('/api/games', { method: 'POST', body: JSON.stringify({ name, description }) }),
  getGame: (gameId: string) => req<GameDetail>(`/api/games/${gameId}`),
```

Also replace the existing `createCampaign` method (it currently takes `(name, joinCode?)`) with a single-object signature matching `CreateCampaignRequest`, since Phase 5 needs `gameId`/`templateIds`/`memberUserIds` too. Replace:

```ts
  createCampaign: (name: string, joinCode?: string) =>
    req<CampaignDetail>('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({ name, joinCode }),
    }),
```

with:

```ts
  createCampaign: (body: CreateCampaignRequest) =>
    req<CampaignDetail>('/api/campaigns', { method: 'POST', body: JSON.stringify(body) }),
```

- [ ] **Step 3: Run typecheck to verify it passes**

Run: `npm run typecheck -w frontend`
Expected: FAIL initially — `Lobby.tsx`'s old call `api.createCampaign(newName.trim())` no longer matches the new signature. This is expected and resolved by Task 10 (Lobby.tsx rewrite), which removes that call site entirely. Confirm the *only* error is that one line in `Lobby.tsx`, then proceed — Task 10 fixes it in the same PR sequence.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api.ts
git commit -m "feat(frontend): add Games API client methods; createCampaign takes a request object"
```

---

### Task 10: Router — Lobby becomes a layout (sidebar shell) with `lobbyHomeRoute` + `gameRoute`

**Files:**
- Modify: `frontend/src/router.tsx` (full rewrite of the route tree, shown below)

**Interfaces:**
- Consumes: `api.getGame` (Task 9).
- Produces: routes `'/lobby'` (layout, component `Lobby`), `'/lobby/'` (index, component `LobbyHome`, not yet created — Task 11), `'/lobby/game/$gameId'` (component `GamePage`, not yet created — Task 11), route-api id strings `/authed/lobby`, `/authed/lobby/game/$gameId` for downstream `getRouteApi` calls.

- [ ] **Step 1: Run typecheck/build to see the current state**

Run: `npm run typecheck -w frontend`
Expected: the pre-existing failure from Task 9 Step 3 (Lobby.tsx's stale `createCampaign` call).

- [ ] **Step 2: Rewrite `frontend/src/router.tsx`**

```tsx
import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  Outlet,
} from '@tanstack/react-router';
import { MapView } from './routes/MapView';
import { Login } from './routes/Login';
import { Lobby } from './routes/Lobby';
import { LobbyHome } from './routes/LobbyHome';
import { GamePage } from './routes/GamePage';
import { CreateCampaignPage } from './routes/CreateCampaignPage';
import { MapsManager } from './routes/MapsManager';
import { api } from './api';
import { state } from './store';

const rootRoute = createRootRoute({ component: () => <Outlet /> });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: Login,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/lobby' });
  },
});

const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'authed',
  beforeLoad: () => {
    if (!state.session) throw redirect({ to: '/login' });
  },
  component: () => <Outlet />,
});

const lobbyRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/lobby',
  component: Lobby,
});

const lobbyHomeRoute = createRoute({
  getParentRoute: () => lobbyRoute,
  path: '/',
  component: LobbyHome,
});

const gameRoute = createRoute({
  getParentRoute: () => lobbyRoute,
  path: '/game/$gameId',
  loader: async ({ params }) => ({ game: await api.getGame(params.gameId) }),
  component: GamePage,
});

const createCampaignRoute = createRoute({
  getParentRoute: () => gameRoute,
  path: '/campaigns/new',
  component: CreateCampaignPage,
});

const campaignRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/campaign/$campaignId',
  loader: async ({ params }) => {
    const campaign = await api.getCampaign(params.campaignId);
    const isGm = campaign.gmUserId === state.session?.user.id;
    const mapId = isGm ? (campaign.liveMaps[0]?.mapId ?? null) : campaign.viewerMapId;
    return { mapId, campaign };
  },
  component: MapView,
});

const manageRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/campaign/$campaignId/manage',
  loader: async ({ params }) => {
    const campaign = await api.getCampaign(params.campaignId);
    if (campaign.gmUserId !== state.session?.user.id) throw redirect({ to: '/lobby' });
    const maps = await api.listMaps(params.campaignId);
    return { campaign, maps };
  },
  component: MapsManager,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  indexRoute,
  authedRoute.addChildren([
    lobbyRoute.addChildren([lobbyHomeRoute, gameRoute.addChildren([createCampaignRoute])]),
    campaignRoute,
    manageRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
```

- [ ] **Step 3: Commit deferred to Task 11**

This file references `LobbyHome`, `GamePage`, `CreateCampaignPage`, which don't exist yet — do not commit standalone; proceed directly to Task 11, then run typecheck/tests and commit both together.

---

### Task 11: `Lobby.tsx` (sidebar shell), `LobbyHome.tsx` (preserved player-facing list), `GamePage.tsx` + tab stubs, `CreateCampaignPage.tsx` (placeholder)

**Files:**
- Rewrite: `frontend/src/routes/Lobby.tsx`
- Create: `frontend/src/routes/LobbyHome.tsx`, `GamePage.tsx`, `GameCampaignsTab.tsx`, `GameMapLibraryTab.tsx`, `GameRosterTab.tsx`, `CreateCampaignPage.tsx` (Phase 5 fleshes this out fully; Task 26)

**Interfaces:**
- Consumes: `api.listGames`, `api.createGame`, `api.getGame`, `api.listCampaigns`, `api.joinCampaign` (existing), `GameDetail`/`GameSummary`/`CampaignSummary` types.
- Produces: components `Lobby`, `LobbyHome`, `GamePage`, `GameCampaignsTab`, `GameMapLibraryTab`, `GameRosterTab`, `CreateCampaignPage`, each exported as a named export matching the router's imports from Task 10. `GameCampaignsTab`/`GameMapLibraryTab`/`GameRosterTab` share the prop shape `{ game: GameDetail; onRefresh: () => Promise<void> }`, consumed identically in Phases 3/4/5.

- [ ] **Step 1: Rewrite `frontend/src/routes/Lobby.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from '@tanstack/react-router';
import type { GameSummary } from '@vtt/shared';
import { api, ApiError, clearToken } from '../api';
import { clearSession, state } from '../store';
import { field, ghostBtn, linkBtn, primaryBtn, surface } from './ui';

export function Lobby() {
  const navigate = useNavigate();
  const [games, setGames] = useState<GameSummary[]>([]);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      setGames(await api.listGames());
    } catch {
      setError('Could not load your Games.');
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

  async function createGame() {
    if (!newName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const game = await api.createGame(newName.trim());
      setNewName('');
      await refresh();
      void navigate({ to: '/lobby/game/$gameId', params: { gameId: game.id } });
    } catch (e) {
      setError(e instanceof ApiError ? `Could not create Game (${e.message})` : 'Could not create Game.');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    clearToken();
    clearSession();
    void navigate({ to: '/login' });
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        background: '#0a0a0f',
        color: '#e5e7eb',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        style={{
          ...surface,
          width: 260,
          flexShrink: 0,
          margin: 16,
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          overflow: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Your Games</div>
          <button style={linkBtn} onClick={logout}>
            log out
          </button>
        </div>
        <div style={{ opacity: 0.6, fontSize: 12 }}>{state.session?.user.displayName}</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {games.map((g) => (
            <button
              key={g.id}
              style={{ ...ghostBtn, textAlign: 'left', width: '100%' }}
              onClick={() => void navigate({ to: '/lobby/game/$gameId', params: { gameId: g.id } })}
            >
              {g.name}
              <div style={{ opacity: 0.6, fontSize: 11 }}>
                {g.campaignCount} campaign{g.campaignCount === 1 ? '' : 's'} · {g.memberCount} member
                {g.memberCount === 1 ? '' : 's'}
              </div>
            </button>
          ))}
          {games.length === 0 && <div style={{ opacity: 0.5, fontSize: 12 }}>No Games yet.</div>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 'auto' }}>
          <input
            style={field}
            placeholder="New Game name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button style={primaryBtn} onClick={createGame} disabled={busy}>
            {busy ? '…' : '+ New Game'}
          </button>
          {error && <div style={{ color: '#f87171', fontSize: 12 }}>{error}</div>}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center' }}>
        <Outlet />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `frontend/src/routes/LobbyHome.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import type { CampaignSummary } from '@vtt/shared';
import { api, ApiError } from '../api';
import { field, ghostBtn, primaryBtn } from './ui';

export function LobbyHome() {
  const navigate = useNavigate();
  const [camps, setCamps] = useState<CampaignSummary[]>([]);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const all = await api.listCampaigns();
      setCamps(all.filter((c) => !c.isGm));
    } catch {
      setError('Could not load campaigns.');
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

  async function join(c: CampaignSummary) {
    setError(null);
    try {
      await api.joinCampaign(c.id, codes[c.id]);
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError && e.message === 'bad_code' ? 'Wrong join code.' : 'Could not join.');
    }
  }

  function enter(c: CampaignSummary) {
    void navigate({ to: '/campaign/$campaignId', params: { campaignId: c.id } });
  }

  return (
    <div style={{ width: 480, maxWidth: '90vw', margin: '40px auto' }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Your Campaigns</div>

      {error && <div style={{ color: '#f87171', fontSize: 13, marginBottom: 8 }}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {camps.map((c) => (
          <div
            key={c.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 10,
              padding: 12,
              background: '#14141f',
              border: '1px solid #2a2a3a',
              borderRadius: 10,
            }}
          >
            <div>
              <div style={{ fontWeight: 600 }}>{c.name}</div>
              <div style={{ opacity: 0.6, fontSize: 12 }}>
                GM {c.gmName} · {c.memberCount} member{c.memberCount === 1 ? '' : 's'}
              </div>
            </div>
            {c.isMember ? (
              <button style={primaryBtn} onClick={() => enter(c)}>
                Enter
              </button>
            ) : (
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  style={{ ...field, width: 110 }}
                  placeholder="join code"
                  value={codes[c.id] ?? ''}
                  onChange={(e) => setCodes((m) => ({ ...m, [c.id]: e.target.value }))}
                />
                <button style={ghostBtn} onClick={() => join(c)}>
                  Join
                </button>
              </div>
            )}
          </div>
        ))}
        {camps.length === 0 && (
          <div style={{ opacity: 0.5, fontSize: 13 }}>No campaigns yet — ask your GM for a join code.</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `frontend/src/routes/GamePage.tsx`**

```tsx
import { useState } from 'react';
import { getRouteApi } from '@tanstack/react-router';
import { GameCampaignsTab } from './GameCampaignsTab';
import { GameMapLibraryTab } from './GameMapLibraryTab';
import { GameRosterTab } from './GameRosterTab';
import { api } from '../api';
import { tabChip } from './ui';

const routeApi = getRouteApi('/authed/lobby/game/$gameId');

type Tab = 'campaigns' | 'maps' | 'roster';

export function GamePage() {
  const loader = routeApi.useLoaderData();
  const [game, setGame] = useState(loader.game);
  const [tab, setTab] = useState<Tab>('campaigns');

  async function refresh() {
    setGame(await api.getGame(game.id));
  }

  return (
    <div style={{ width: 760, maxWidth: '92vw', margin: '40px auto' }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{game.name}</div>
      {game.description && (
        <div style={{ opacity: 0.6, fontSize: 13, marginBottom: 12 }}>{game.description}</div>
      )}

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #2a2a3a', marginBottom: 16 }}>
        <button style={tabChip(tab === 'campaigns')} onClick={() => setTab('campaigns')}>
          Campaigns
        </button>
        <button style={tabChip(tab === 'maps')} onClick={() => setTab('maps')}>
          Map Library
        </button>
        <button style={tabChip(tab === 'roster')} onClick={() => setTab('roster')}>
          Roster
        </button>
      </div>

      {tab === 'campaigns' && <GameCampaignsTab game={game} onRefresh={refresh} />}
      {tab === 'maps' && <GameMapLibraryTab game={game} onRefresh={refresh} />}
      {tab === 'roster' && <GameRosterTab game={game} onRefresh={refresh} />}
    </div>
  );
}
```

- [ ] **Step 4: Create `frontend/src/routes/GameCampaignsTab.tsx`** (minimal — Task 25 replaces wholesale)

```tsx
import { useNavigate } from '@tanstack/react-router';
import type { CampaignSummary, GameDetail } from '@vtt/shared';
import { ghostBtn, primaryBtn } from './ui';

export function GameCampaignsTab({ game }: { game: GameDetail; onRefresh: () => Promise<void> }) {
  const navigate = useNavigate();

  function enter(c: CampaignSummary) {
    void navigate({ to: '/campaign/$campaignId', params: { campaignId: c.id } });
  }
  function manage(c: CampaignSummary) {
    void navigate({ to: '/campaign/$campaignId/manage', params: { campaignId: c.id } });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {game.campaigns.map((c) => (
        <div
          key={c.id}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: 12,
            background: '#14141f',
            border: '1px solid #2a2a3a',
            borderRadius: 10,
          }}
        >
          <div>
            <div style={{ fontWeight: 600 }}>{c.name}</div>
            <div style={{ opacity: 0.6, fontSize: 12 }}>
              {c.memberCount} member{c.memberCount === 1 ? '' : 's'} · {c.status}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={ghostBtn} onClick={() => manage(c)}>
              Manage
            </button>
            <button style={primaryBtn} onClick={() => enter(c)}>
              Enter
            </button>
          </div>
        </div>
      ))}
      {game.campaigns.length === 0 && (
        <div style={{ opacity: 0.5, fontSize: 13 }}>No campaigns yet in this Game.</div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Create `frontend/src/routes/GameMapLibraryTab.tsx`** (stub — Task 16 replaces)

```tsx
import type { GameDetail } from '@vtt/shared';

export function GameMapLibraryTab({ game }: { game: GameDetail; onRefresh: () => Promise<void> }) {
  return (
    <div style={{ opacity: 0.5, fontSize: 13 }}>
      {game.mapTemplates.length === 0 ? 'No map templates yet.' : `${game.mapTemplates.length} template(s).`}
    </div>
  );
}
```

- [ ] **Step 6: Create `frontend/src/routes/GameRosterTab.tsx`** (stub — Task 20 replaces)

```tsx
import type { GameDetail } from '@vtt/shared';

export function GameRosterTab({ game }: { game: GameDetail; onRefresh: () => Promise<void> }) {
  return (
    <div style={{ opacity: 0.5, fontSize: 13 }}>
      {game.members.length === 0 ? 'No roster members yet.' : `${game.members.length} member(s).`}
    </div>
  );
}
```

- [ ] **Step 7: Create `frontend/src/routes/CreateCampaignPage.tsx`** (placeholder — Task 26 replaces)

```tsx
import { getRouteApi } from '@tanstack/react-router';

const gameRouteApi = getRouteApi('/authed/lobby/game/$gameId');

export function CreateCampaignPage() {
  const { game } = gameRouteApi.useLoaderData();
  return <div style={{ margin: 40 }}>New Campaign · {game.name} (coming in Phase 5)</div>;
}
```

- [ ] **Step 8: Run typecheck**

Run: `npm run typecheck -w frontend`
Expected: PASS. If `getRouteApi('/authed/lobby/game/$gameId')` reports a different literal id in the TS error, copy the exact string TanStack's generated types suggest and use it in both `GamePage.tsx` and `CreateCampaignPage.tsx`.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/router.tsx frontend/src/routes/Lobby.tsx frontend/src/routes/LobbyHome.tsx \
  frontend/src/routes/GamePage.tsx frontend/src/routes/GameCampaignsTab.tsx \
  frontend/src/routes/GameMapLibraryTab.tsx frontend/src/routes/GameRosterTab.tsx \
  frontend/src/routes/CreateCampaignPage.tsx
git commit -m "feat(frontend): Games sidebar shell + Game page with Campaigns/Map Library/Roster tabs"
```

---

### Task 12: Fix `test/e2e/login.spec.ts` (GM now navigates through the sidebar)

**Files:**
- Modify: `test/e2e/login.spec.ts`

**Interfaces:**
- Consumes: `Lobby`/`GamePage`/`GameCampaignsTab` (Task 11).
- Produces: nothing new.

- [ ] **Step 1: Run the e2e test to see the current failure**

Run: `npx playwright test test/e2e/login.spec.ts`
Expected: FAIL — the GM test's `page.getByText('Demo Campaign')` / `.getByRole('button', {name:'Enter'})` no longer appear directly on `/lobby` (it now shows "Your Campaigns" empty, since the GM isn't a pure-member of anything); the player test is unaffected (still passes) since `LobbyHome` preserves that flow exactly.

- [ ] **Step 2: Edit `test/e2e/login.spec.ts`**

Replace the GM test:

```ts
test('GM logs in, enters the seeded map, sees 2 tokens (server-derived role)', async ({ page }) => {
  await page.goto('/login');
  await login(page, 'Game Master', '1234');
  await page.getByText('Demo Campaign').first().click(); // the seeded Game in the sidebar
  await page.waitForURL('**/lobby/game/**');
  await expect(page.getByText('Demo Campaign').last()).toBeVisible(); // the campaign card
  await page.getByRole('button', { name: 'Enter' }).click();
  await page.waitForSelector('canvas');
  await expect.poll(() => bodyText(page)).toContain('VTT · GM');
  await expect.poll(async () => /tokens:\s*2/.test(await bodyText(page))).toBe(true);
});
```

Leave the player test (`'player enters the map with the hidden orc stripped (no toggle)'`) unchanged — `LobbyHome` preserves that flow byte-for-byte.

- [ ] **Step 3: Run test to verify it passes**

Run: `npx playwright test test/e2e/login.spec.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add test/e2e/login.spec.ts
git commit -m "test(e2e): update login.spec.ts GM flow for the Games sidebar"
```

---

### Task 13: Fix `test/e2e/tabs-relocate.spec.ts` (GM's login step)

**Files:**
- Modify: `test/e2e/tabs-relocate.spec.ts`

**Interfaces:**
- Consumes: Task 11/12's sidebar navigation.
- Produces: nothing new.

- [ ] **Step 1: Run the e2e test to see the current failure**

Run: `npx playwright test test/e2e/tabs-relocate.spec.ts`
Expected: FAIL — `gmPage.getByRole('button', { name: 'Enter' }).first().click()` right after GM login has no match on the bare `/lobby` page.

- [ ] **Step 2: Edit `test/e2e/tabs-relocate.spec.ts`**

Replace:

```ts
    await login(gmPage, 'Game Master', '1234');
    await gmPage.getByRole('button', { name: 'Enter' }).first().click();
    await gmPage.waitForSelector('canvas');
```

with:

```ts
    await login(gmPage, 'Game Master', '1234');
    await gmPage.getByText('Demo Campaign').first().click();
    await gmPage.waitForURL('**/lobby/game/**');
    await gmPage.getByRole('button', { name: 'Enter' }).click();
    await gmPage.waitForSelector('canvas');
```

The `playerPage` login block stays unchanged — the player still lands on `LobbyHome`.

- [ ] **Step 3: Run test to verify it passes**

Run: `npx playwright test test/e2e/tabs-relocate.spec.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add test/e2e/tabs-relocate.spec.ts
git commit -m "test(e2e): update tabs-relocate.spec.ts GM login flow for the Games sidebar"
```

---

# Phase 3 — Map Library

### Task 14: `createMapTemplate` + `POST`/`GET /api/games/:id/templates`

**Files:**
- Modify: `backend/src/repo.ts` (append to `// ── games ──` section, or a new `// ── map templates ──` sub-section)
- Modify: `backend/src/routes.ts` (append routes)
- Test: create `test/integration/map-templates.test.ts`

**Interfaces:**
- Consumes: `requireGameGm` (Task 8), `repo.listMapTemplates` (Task 8, currently always `[]`).
- Produces: `repo.createMapTemplate(gameId: string, m: { name: string; assetPath: string; gridType: 'square'|'hex'; gridSize: number; cols: number; rows: number }): Promise<MapTemplateSummary>`. Routes `POST /api/games/:id/templates`, `GET /api/games/:id/templates` (this `GET` REPLACES Task 8's stub-backed usage inside `getGameDetail` — Task 6's `getGameDetail` should now call the real `listMapTemplates` implemented here instead of returning `[]` inline).

- [ ] **Step 1: Write the failing test**

Create `test/integration/map-templates.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/integration/map-templates.test.ts`
Expected: FAIL — `404`.

- [ ] **Step 3: Edit `backend/src/repo.ts`**

Replace the Task 8 stub with a real implementation, and add `createMapTemplate`:

```ts

/** Upload a template into a Game's Map Library. */
export async function createMapTemplate(
  gameId: string,
  m: { name: string; assetPath: string; gridType: 'square' | 'hex'; gridSize: number; cols: number; rows: number },
): Promise<MapTemplateSummary> {
  const res = await query<{ id: string }>(
    `INSERT INTO map_templates (game_id, name, asset_path, grid_type, grid_size, cols, rows)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [gameId, m.name, m.assetPath, m.gridType, m.gridSize, m.cols, m.rows],
  );
  return { id: res.rows[0]!.id, gameId, ...m };
}
```

Replace the Task 8 `listMapTemplates` stub body:

```ts
export async function listMapTemplates(gameId: string): Promise<MapTemplateSummary[]> {
  const res = await query<{
    id: string; game_id: string; name: string; asset_path: string;
    grid_type: 'square' | 'hex'; grid_size: number; cols: number; rows: number;
  }>(
    `SELECT id, game_id, name, asset_path, grid_type, grid_size, cols, rows
       FROM map_templates WHERE game_id = $1 ORDER BY created_at`,
    [gameId],
  );
  return res.rows.map((r) => ({
    id: r.id, gameId: r.game_id, name: r.name, assetPath: r.asset_path,
    gridType: r.grid_type, gridSize: r.grid_size, cols: r.cols, rows: r.rows,
  }));
}
```

Also update `getGameDetail` (Task 6) to call this real function instead of hardcoding `[]`:

```ts
  const mapTemplates = await listMapTemplates(gameId);
  return { ...game, campaigns, mapTemplates, members };
```

- [ ] **Step 4: Edit `backend/src/routes.ts`**

Append (this reuses the existing `upload` multer instance defined near the top of the file for map images):

```ts

apiRouter.get(
  '/games/:id/templates',
  requireAuth,
  requireGameGm,
  ah(async (req, res) => {
    res.json(await repo.listMapTemplates(req.params.id!));
  }),
);

apiRouter.post(
  '/games/:id/templates',
  requireAuth,
  requireGameGm,
  upload.single('image'),
  ah(async (req, res) => {
    const id = req.params.id!;
    if (!req.file) {
      res.status(400).json({ error: 'no_image' });
      return;
    }
    const name =
      typeof req.body.name === 'string' && req.body.name.trim() ? req.body.name.trim() : 'Template';
    const gridSize = Math.round(Number(req.body.gridSize)) || 70;
    const cols = Math.max(1, Math.round(Number(req.body.cols)) || 1);
    const rows = Math.max(1, Math.round(Number(req.body.rows)) || 1);
    const template = await repo.createMapTemplate(id, {
      name,
      assetPath: `/assets/${req.file.filename}`,
      gridType: 'square',
      gridSize,
      cols,
      rows,
    });
    res.status(201).json(template);
  }),
);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/integration/map-templates.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/repo.ts backend/src/routes.ts test/integration/map-templates.test.ts
git commit -m "feat(map-library): add POST/GET /api/games/:id/templates"
```

---

### Task 15: Copy-on-assign — `createCampaign` accepts `templateIds`

**Files:**
- Modify: `backend/src/repo.ts` (`createCampaign`, extending Task 4's version)
- Modify: `backend/src/routes.ts` (`POST /api/campaigns`, extending Task 4's version)
- Test: extend `test/integration/map-templates.test.ts`

**Interfaces:**
- Consumes: `map_templates` table (Task 1), `createMapTemplate` (Task 14).
- Produces: `repo.createCampaign(userId: string, gameId: string, name: string, joinCode: string | null, templateIds: string[] = []): Promise<CampaignDetail>`.

- [ ] **Step 1: Write the failing test**

Append to `test/integration/map-templates.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/integration/map-templates.test.ts`
Expected: FAIL — `maps` is `[]` (templateIds currently ignored).

- [ ] **Step 3: Edit `backend/src/repo.ts`**

Replace `createCampaign` (as it stands after Task 4):

```ts
export async function createCampaign(
  userId: string,
  gameId: string,
  name: string,
  joinCode: string | null,
  templateIds: string[] = [],
): Promise<CampaignDetail> {
  const res = await query<{ id: string }>(
    `WITH c AS (
       INSERT INTO campaigns (name, gm_user_id, join_code, game_id)
       VALUES ($1, $2, $3, $4) RETURNING id, gm_user_id
     ), m AS (
       INSERT INTO campaign_members (campaign_id, user_id) SELECT id, gm_user_id FROM c
     )
     SELECT id FROM c`,
    [name, userId, joinCode, gameId],
  );
  const campaignId = res.rows[0]!.id;

  if (templateIds.length > 0) {
    await query(
      `INSERT INTO game_maps (campaign_id, name, asset_path, grid_type, grid_size, cols, rows, template_id)
       SELECT $1, name, asset_path, grid_type, grid_size, cols, rows, id
         FROM map_templates
        WHERE id = ANY($2::uuid[]) AND game_id = $3`,
      [campaignId, templateIds, gameId],
    );
  }

  return (await getCampaignDetail(campaignId, userId))!;
}
```

- [ ] **Step 4: Edit `backend/src/routes.ts`**

In `POST /api/campaigns`, extend the destructure and pass-through:

```ts
apiRouter.post(
  '/campaigns',
  requireAuth,
  ah(async (req, res) => {
    const { gameId, name, joinCode, templateIds } = req.body ?? {};
    if (typeof gameId !== 'string' || gameId.trim().length < 1) {
      res.status(400).json({ error: 'invalid_game' });
      return;
    }
    if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 80) {
      res.status(400).json({ error: 'invalid_name' });
      return;
    }
    if (!(await repo.isGameGm(gameId, req.userId!))) {
      res.status(403).json({ error: 'not_game_gm' });
      return;
    }
    const code = typeof joinCode === 'string' && joinCode.trim() ? joinCode.trim() : null;
    const templates = Array.isArray(templateIds) ? templateIds.filter((t) => typeof t === 'string') : [];
    res.status(201).json(await repo.createCampaign(req.userId!, gameId, name.trim(), code, templates));
  }),
);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/integration/map-templates.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/repo.ts backend/src/routes.ts test/integration/map-templates.test.ts
git commit -m "feat(map-library): copy selected templates into a new campaign's game_maps"
```

---

### Task 16: Frontend — Map Library tab (upload + list)

**Files:**
- Modify: `frontend/src/api.ts` (append `listMapTemplates`, `uploadMapTemplate`)
- Modify: `frontend/src/routes/mapUpload.ts` (append `uploadMapTemplateWithDims`)
- Rewrite: `frontend/src/routes/GameMapLibraryTab.tsx` (replaces Task 11's stub)

**Interfaces:**
- Consumes: `GET/POST /api/games/:id/templates` (Task 14), `readDims` (existing helper in `mapUpload.ts`).
- Produces: `api.listMapTemplates(gameId): Promise<MapTemplateSummary[]>`, `api.uploadMapTemplate(gameId, file, meta): Promise<MapTemplateSummary>`, `uploadMapTemplateWithDims(gameId, file, meta): Promise<MapTemplateSummary>`.

- [ ] **Step 1: Edit `frontend/src/api.ts`**

Append imports `MapTemplateSummary` to the type-import list (Task 9's block), and append to the `api` object:

```ts
  listMapTemplates: (gameId: string) => req<MapTemplateSummary[]>(`/api/games/${gameId}/templates`),
  async uploadMapTemplate(
    gameId: string,
    file: File,
    meta: { name: string; gridSize: number; cols: number; rows: number },
  ): Promise<MapTemplateSummary> {
    const fd = new FormData();
    fd.append('image', file);
    fd.append('name', meta.name);
    fd.append('gridSize', String(meta.gridSize));
    fd.append('cols', String(meta.cols));
    fd.append('rows', String(meta.rows));
    const token = getToken();
    const res = await fetch(BASE + `/api/games/${gameId}/templates`, {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: fd,
    });
    if (!res.ok) {
      let msg = res.statusText;
      try {
        const b = (await res.json()) as { error?: string };
        if (b.error) msg = b.error;
      } catch {
        /* non-JSON */
      }
      throw new ApiError(res.status, msg);
    }
    return (await res.json()) as MapTemplateSummary;
  },
```

- [ ] **Step 2: Edit `frontend/src/routes/mapUpload.ts`**

Append:

```ts
export async function uploadMapTemplateWithDims(
  gameId: string,
  file: File,
  meta: { name: string; gridSize: number },
): Promise<import('@vtt/shared').MapTemplateSummary> {
  const { w, h } = await readDims(file);
  const cols = Math.max(1, Math.ceil(w / meta.gridSize));
  const rows = Math.max(1, Math.ceil(h / meta.gridSize));
  return api.uploadMapTemplate(gameId, file, { name: meta.name, gridSize: meta.gridSize, cols, rows });
}
```

- [ ] **Step 3: Rewrite `frontend/src/routes/GameMapLibraryTab.tsx`**

```tsx
import { useState } from 'react';
import type { GameDetail } from '@vtt/shared';
import { ApiError } from '../api';
import { uploadMapTemplateWithDims } from './mapUpload';
import { field, primaryBtn } from './ui';

export function GameMapLibraryTab({ game, onRefresh }: { game: GameDetail; onRefresh: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [gridSize, setGridSize] = useState(70);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    if (!file) {
      setError('Choose an image first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await uploadMapTemplateWithDims(game.id, file, { name: name.trim() || file.name, gridSize });
      setName('');
      setFile(null);
      await onRefresh();
    } catch (e) {
      setError(e instanceof ApiError ? `Upload failed (${e.message})` : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div
        style={{
          marginBottom: 16,
          padding: 12,
          background: '#14141f',
          border: '1px solid #2a2a3a',
          borderRadius: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div style={{ fontWeight: 600 }}>Upload a map template</div>
        <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={{ ...field, flex: 1 }}
            placeholder="Template name (defaults to file name)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            style={{ ...field, width: 120 }}
            type="number"
            min={10}
            value={gridSize}
            onChange={(e) => setGridSize(Math.max(10, Number(e.target.value) || 70))}
            title="Cell size in pixels"
          />
          <button style={primaryBtn} onClick={upload} disabled={busy}>
            {busy ? '…' : 'Upload'}
          </button>
        </div>
      </div>

      {error && <div style={{ color: '#f87171', fontSize: 13, marginBottom: 8 }}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {game.mapTemplates.map((t) => (
          <div
            key={t.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: 10,
              background: '#14141f',
              border: '1px solid #2a2a3a',
              borderRadius: 8,
            }}
          >
            <div>
              <div style={{ fontWeight: 600 }}>{t.name}</div>
              <div style={{ opacity: 0.6, fontSize: 12 }}>
                {t.cols}×{t.rows} cells · {t.gridSize}px
              </div>
            </div>
          </div>
        ))}
        {game.mapTemplates.length === 0 && (
          <div style={{ opacity: 0.5, fontSize: 13 }}>
            No templates yet. Upload one above, then pick it when creating a Campaign.
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck -w frontend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api.ts frontend/src/routes/mapUpload.ts frontend/src/routes/GameMapLibraryTab.tsx
git commit -m "feat(frontend): Map Library tab -- upload and list templates"
```

---

# Phase 4 — Roster

### Task 17: `joinGame` + `POST /api/games/:id/join`

**Files:**
- Modify: `backend/src/repo.ts`, `backend/src/routes.ts`
- Test: create `test/integration/roster.test.ts`

**Interfaces:**
- Consumes: `games.join_code` (Task 1).
- Produces: `repo.joinGame(userId: string, gameId: string, joinCode: string | undefined): Promise<{ ok: true } | { ok: false; reason: 'not_found' | 'bad_code' }>`. Route `POST /api/games/:id/join`.

- [ ] **Step 1: Write the failing test**

Create `test/integration/roster.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/integration/roster.test.ts`
Expected: FAIL — `404` (`POST /api/games/:id/join` doesn't exist, `GET .../members` doesn't exist yet either — added together with Task 18).

- [ ] **Step 3: Edit `backend/src/repo.ts`**

Append:

```ts

export async function joinGame(
  userId: string,
  gameId: string,
  joinCode: string | undefined,
): Promise<{ ok: true } | { ok: false; reason: 'not_found' | 'bad_code' }> {
  const g = await query<{ id: string; join_code: string }>('SELECT id, join_code FROM games WHERE id = $1', [
    gameId,
  ]);
  const row = g.rows[0];
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.join_code !== joinCode) return { ok: false, reason: 'bad_code' };
  await query('INSERT INTO game_members (game_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
    gameId,
    userId,
  ]);
  return { ok: true };
}
```

- [ ] **Step 4: Edit `backend/src/routes.ts`**

Append:

```ts

apiRouter.post(
  '/games/:id/join',
  requireAuth,
  ah(async (req, res) => {
    const id = req.params.id!;
    const joinCode = typeof req.body?.joinCode === 'string' ? req.body.joinCode : undefined;
    const r = await repo.joinGame(req.userId!, id, joinCode);
    if (!r.ok) {
      res.status(r.reason === 'not_found' ? 404 : 403).json({ error: r.reason });
      return;
    }
    res.json({ ok: true });
  }),
);
```

- [ ] **Step 5: Run test (still expected FAIL until Task 18 adds `GET .../members`)**

Run: `npx vitest run test/integration/roster.test.ts`
Expected: FAIL — the join succeeds (200) but `GET /api/games/:id/members` 404s. Proceed directly to Task 18 before committing.

---

### Task 18: `GET /api/games/:id/members`

**Files:**
- Modify: `backend/src/routes.ts`

**Interfaces:**
- Consumes: `repo.listGameMembers` (Task 6, already implemented).
- Produces: route `GET /api/games/:id/members`.

- [ ] **Step 1: Edit `backend/src/routes.ts`**

Append right after the `POST /api/games/:id/join` route from Task 17:

```ts

apiRouter.get(
  '/games/:id/members',
  requireAuth,
  requireGameGm,
  ah(async (req, res) => {
    res.json(await repo.listGameMembers(req.params.id!));
  }),
);
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run test/integration/roster.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/src/repo.ts backend/src/routes.ts test/integration/roster.test.ts
git commit -m "feat(roster): add POST /api/games/:id/join and GET /api/games/:id/members"
```

---

### Task 19: Character-sheet attach — `setGameMemberSheet` + `listEligibleSheets`

**Files:**
- Modify: `backend/src/repo.ts`, `backend/src/routes.ts`
- Test: extend `test/integration/roster.test.ts`

**Interfaces:**
- Consumes: `character_sheets` table (existing, docs/02).
- Produces: `repo.listEligibleSheets(gameId: string, userId: string): Promise<EligibleSheetDto[]>`, `repo.setGameMemberSheet(gameId: string, userId: string, characterSheetId: string | null): Promise<{ ok: true } | { ok: false; reason: 'not_member' | 'invalid_sheet' }>`. Routes `GET /api/games/:id/members/:userId/sheets`, `PATCH /api/games/:id/members/:userId`.

- [ ] **Step 1: Write the failing test**

Append to `test/integration/roster.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/integration/roster.test.ts`
Expected: FAIL — `404` on both new routes (and `memberUserIds` isn't wired yet either — that's fine, Task 21 covers it; this test only exercises the sheets endpoints here).

- [ ] **Step 3: Edit `backend/src/repo.ts`**

Append:

```ts

export async function listEligibleSheets(gameId: string, userId: string): Promise<EligibleSheetDto[]> {
  const res = await query<{ id: string; name: string }>(
    `SELECT cs.id, cs.name
       FROM character_sheets cs JOIN campaigns c ON c.id = cs.campaign_id
      WHERE cs.owner_user_id = $2 AND c.game_id = $1
      ORDER BY cs.created_at`,
    [gameId, userId],
  );
  return res.rows;
}

export async function setGameMemberSheet(
  gameId: string,
  userId: string,
  characterSheetId: string | null,
): Promise<{ ok: true } | { ok: false; reason: 'not_member' | 'invalid_sheet' }> {
  const member = await query('SELECT 1 FROM game_members WHERE game_id = $1 AND user_id = $2', [
    gameId,
    userId,
  ]);
  if (member.rows.length === 0) return { ok: false, reason: 'not_member' };
  if (characterSheetId !== null) {
    const sheet = await query(
      `SELECT 1 FROM character_sheets cs
         JOIN campaigns c ON c.id = cs.campaign_id
        WHERE cs.id = $1 AND cs.owner_user_id = $2 AND c.game_id = $3`,
      [characterSheetId, userId, gameId],
    );
    if (sheet.rows.length === 0) return { ok: false, reason: 'invalid_sheet' };
  }
  await query('UPDATE game_members SET character_sheet_id = $3 WHERE game_id = $1 AND user_id = $2', [
    gameId,
    userId,
    characterSheetId,
  ]);
  return { ok: true };
}
```

- [ ] **Step 4: Edit `backend/src/routes.ts`**

Append:

```ts

apiRouter.get(
  '/games/:id/members/:userId/sheets',
  requireAuth,
  requireGameGm,
  ah(async (req, res) => {
    res.json(await repo.listEligibleSheets(req.params.id!, req.params.userId!));
  }),
);

apiRouter.patch(
  '/games/:id/members/:userId',
  requireAuth,
  requireGameGm,
  ah(async (req, res) => {
    const raw = req.body?.characterSheetId;
    const characterSheetId = raw === null || raw === undefined ? null : String(raw);
    const r = await repo.setGameMemberSheet(req.params.id!, req.params.userId!, characterSheetId);
    if (!r.ok) {
      res.status(r.reason === 'not_member' ? 404 : 400).json({ error: r.reason });
      return;
    }
    res.json({ ok: true });
  }),
);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/integration/roster.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/repo.ts backend/src/routes.ts test/integration/roster.test.ts
git commit -m "feat(roster): add character-sheet attach (list eligible + PATCH member)"
```

---

### Task 20: Frontend — Roster tab (join code, members, attach)

**Files:**
- Modify: `frontend/src/api.ts`
- Rewrite: `frontend/src/routes/GameRosterTab.tsx` (replaces Task 11's stub)

**Interfaces:**
- Consumes: `GET/PATCH /api/games/:id/members*`, `GET /api/games/:id/members/:userId/sheets` (Tasks 18-19).
- Produces: `api.listGameMembers(gameId): Promise<GameMemberDto[]>`, `api.listEligibleSheets(gameId, userId): Promise<EligibleSheetDto[]>`, `api.attachSheet(gameId, userId, characterSheetId: string | null): Promise<{ ok: true }>`.

- [ ] **Step 1: Edit `frontend/src/api.ts`**

Add `GameMemberDto`, `EligibleSheetDto` to the type imports, and append to the `api` object:

```ts
  listGameMembers: (gameId: string) => req<GameMemberDto[]>(`/api/games/${gameId}/members`),
  listEligibleSheets: (gameId: string, userId: string) =>
    req<EligibleSheetDto[]>(`/api/games/${gameId}/members/${userId}/sheets`),
  attachSheet: (gameId: string, userId: string, characterSheetId: string | null) =>
    req<{ ok: true }>(`/api/games/${gameId}/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ characterSheetId }),
    }),
```

- [ ] **Step 2: Rewrite `frontend/src/routes/GameRosterTab.tsx`**

```tsx
import { useEffect, useState } from 'react';
import type { EligibleSheetDto, GameDetail } from '@vtt/shared';
import { api, ApiError } from '../api';
import { field, ghostBtn, surface } from './ui';

export function GameRosterTab({ game, onRefresh }: { game: GameDetail; onRefresh: () => Promise<void> }) {
  const [sheetOptions, setSheetOptions] = useState<Record<string, EligibleSheetDto[]>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const entries = await Promise.all(
        game.members.map(async (m) => [m.userId, await api.listEligibleSheets(game.id, m.userId)] as const),
      );
      setSheetOptions(Object.fromEntries(entries));
    })();
  }, [game.id, game.members]);

  async function attach(userId: string, characterSheetId: string) {
    setError(null);
    try {
      await api.attachSheet(game.id, userId, characterSheetId || null);
      await onRefresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not attach sheet.');
    }
  }

  return (
    <div>
      <div style={{ ...surface, padding: 12, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ fontSize: 13, opacity: 0.8 }}>Join code for new players</div>
        <input style={{ ...field, width: 140, fontFamily: 'monospace' }} readOnly value={game.joinCode} />
      </div>

      {error && <div style={{ color: '#f87171', fontSize: 13, marginBottom: 8 }}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {game.members.map((m) => (
          <div
            key={m.userId}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: 10,
              background: '#14141f',
              border: '1px solid #2a2a3a',
              borderRadius: 8,
            }}
          >
            <div style={{ fontWeight: 600 }}>{m.displayName}</div>
            <select value={m.characterSheetId ?? ''} onChange={(e) => void attach(m.userId, e.target.value)} style={field}>
              <option value="">No sheet attached</option>
              {(sheetOptions[m.userId] ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        ))}
        {game.members.length === 0 && (
          <div style={{ opacity: 0.5, fontSize: 13 }}>No roster members yet. Share the join code above.</div>
        )}
      </div>
      <button style={{ ...ghostBtn, marginTop: 12 }} onClick={() => void onRefresh()}>
        Refresh roster
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck -w frontend`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api.ts frontend/src/routes/GameRosterTab.tsx
git commit -m "feat(frontend): Roster tab -- join code, members, character-sheet attach"
```

---

### Task 21: `createCampaign` accepts `memberUserIds`

**Files:**
- Modify: `backend/src/repo.ts` (`createCampaign`, extending Task 15's version)
- Modify: `backend/src/routes.ts` (`POST /api/campaigns`, extending Task 15's version)
- Test: extend `test/integration/roster.test.ts`

**Interfaces:**
- Consumes: `game_members` table (Task 1).
- Produces: `repo.createCampaign(userId, gameId, name, joinCode, templateIds = [], memberUserIds: string[] = []): Promise<CampaignDetail>` — final signature, used unchanged by Phase 5.

- [ ] **Step 1: Write the failing test**

Append to `test/integration/roster.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/integration/roster.test.ts`
Expected: FAIL — `memberIds` doesn't contain `rosterPlayerId` (currently ignored).

- [ ] **Step 3: Edit `backend/src/repo.ts`**

Replace `createCampaign` (as it stands after Task 15), adding the `memberUserIds` param and insert:

```ts
export async function createCampaign(
  userId: string,
  gameId: string,
  name: string,
  joinCode: string | null,
  templateIds: string[] = [],
  memberUserIds: string[] = [],
): Promise<CampaignDetail> {
  const res = await query<{ id: string }>(
    `WITH c AS (
       INSERT INTO campaigns (name, gm_user_id, join_code, game_id)
       VALUES ($1, $2, $3, $4) RETURNING id, gm_user_id
     ), m AS (
       INSERT INTO campaign_members (campaign_id, user_id) SELECT id, gm_user_id FROM c
     )
     SELECT id FROM c`,
    [name, userId, joinCode, gameId],
  );
  const campaignId = res.rows[0]!.id;

  if (templateIds.length > 0) {
    await query(
      `INSERT INTO game_maps (campaign_id, name, asset_path, grid_type, grid_size, cols, rows, template_id)
       SELECT $1, name, asset_path, grid_type, grid_size, cols, rows, id
         FROM map_templates
        WHERE id = ANY($2::uuid[]) AND game_id = $3`,
      [campaignId, templateIds, gameId],
    );
  }

  if (memberUserIds.length > 0) {
    await query(
      `INSERT INTO campaign_members (campaign_id, user_id)
       SELECT $1, gm.user_id FROM game_members gm
        WHERE gm.game_id = $2 AND gm.user_id = ANY($3::uuid[])
       ON CONFLICT DO NOTHING`,
      [campaignId, gameId, memberUserIds],
    );
  }

  return (await getCampaignDetail(campaignId, userId))!;
}
```

- [ ] **Step 4: Edit `backend/src/routes.ts`**

Extend `POST /api/campaigns` to read and pass `memberUserIds`:

```ts
apiRouter.post(
  '/campaigns',
  requireAuth,
  ah(async (req, res) => {
    const { gameId, name, joinCode, templateIds, memberUserIds } = req.body ?? {};
    if (typeof gameId !== 'string' || gameId.trim().length < 1) {
      res.status(400).json({ error: 'invalid_game' });
      return;
    }
    if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 80) {
      res.status(400).json({ error: 'invalid_name' });
      return;
    }
    if (!(await repo.isGameGm(gameId, req.userId!))) {
      res.status(403).json({ error: 'not_game_gm' });
      return;
    }
    const code = typeof joinCode === 'string' && joinCode.trim() ? joinCode.trim() : null;
    const templates = Array.isArray(templateIds) ? templateIds.filter((t) => typeof t === 'string') : [];
    const members = Array.isArray(memberUserIds) ? memberUserIds.filter((m) => typeof m === 'string') : [];
    res
      .status(201)
      .json(await repo.createCampaign(req.userId!, gameId, name.trim(), code, templates, members));
  }),
);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/integration/roster.test.ts`
Expected: PASS (all `roster.test.ts` tests, including Task 19's, which referenced `memberUserIds` wiring).

- [ ] **Step 6: Commit**

```bash
git add backend/src/repo.ts backend/src/routes.ts test/integration/roster.test.ts
git commit -m "feat(roster): seed campaign_members from selected roster subset on creation"
```

---

# Phase 5 — Campaigns tab + lifecycle

### Task 22: Lifecycle transitions — `startCampaignSession`/`endCampaignSession`/`completeCampaign`

**Files:**
- Modify: `backend/src/repo.ts`, `backend/src/routes.ts`
- Test: create `test/integration/campaign-lifecycle.test.ts`

**Interfaces:**
- Consumes: `campaigns.status` enum (Task 1), existing `requireCampaignGm` middleware (unchanged).
- Produces: `repo.startCampaignSession(campaignId): Promise<{ ok: true; status: CampaignStatus } | { ok: false; reason: 'not_found' | 'invalid_transition' }>`, `repo.endCampaignSession(campaignId)` and `repo.completeCampaign(campaignId)` with the identical result shape. Routes `POST /api/campaigns/:id/start`, `/end`, `/complete`.

- [ ] **Step 1: Write the failing test**

Create `test/integration/campaign-lifecycle.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/integration/campaign-lifecycle.test.ts`
Expected: FAIL — `404` (routes don't exist).

- [ ] **Step 3: Edit `backend/src/repo.ts`**

Append:

```ts

type TransitionResult =
  | { ok: true; status: CampaignSummary['status'] }
  | { ok: false; reason: 'not_found' | 'invalid_transition' };

async function transitionCampaign(
  campaignId: string,
  toStatus: CampaignSummary['status'],
  fromStatuses: CampaignSummary['status'][],
): Promise<TransitionResult> {
  const res = await query<{ status: CampaignSummary['status'] }>(
    `UPDATE campaigns SET status = $2
        WHERE id = $1 AND status = ANY($3::campaign_status[])
      RETURNING status`,
    [campaignId, toStatus, fromStatuses],
  );
  if (res.rows[0]) return { ok: true, status: res.rows[0].status };
  const exists = await query('SELECT 1 FROM campaigns WHERE id = $1', [campaignId]);
  return { ok: false, reason: exists.rows.length ? 'invalid_transition' : 'not_found' };
}

export function startCampaignSession(campaignId: string): Promise<TransitionResult> {
  return transitionCampaign(campaignId, 'live', ['draft', 'paused']);
}

export function endCampaignSession(campaignId: string): Promise<TransitionResult> {
  return transitionCampaign(campaignId, 'paused', ['live']);
}

export function completeCampaign(campaignId: string): Promise<TransitionResult> {
  return transitionCampaign(campaignId, 'completed', ['draft', 'live', 'paused']);
}
```

- [ ] **Step 4: Edit `backend/src/routes.ts`**

Append (reuses the existing `requireCampaignGm` middleware, unchanged):

```ts

apiRouter.post(
  '/campaigns/:id/start',
  requireAuth,
  requireCampaignGm,
  ah(async (req, res) => {
    const r = await repo.startCampaignSession(req.params.id!);
    if (!r.ok) {
      res.status(r.reason === 'not_found' ? 404 : 409).json({ error: r.reason });
      return;
    }
    res.json({ status: r.status });
  }),
);

apiRouter.post(
  '/campaigns/:id/end',
  requireAuth,
  requireCampaignGm,
  ah(async (req, res) => {
    const r = await repo.endCampaignSession(req.params.id!);
    if (!r.ok) {
      res.status(r.reason === 'not_found' ? 404 : 409).json({ error: r.reason });
      return;
    }
    res.json({ status: r.status });
  }),
);

apiRouter.post(
  '/campaigns/:id/complete',
  requireAuth,
  requireCampaignGm,
  ah(async (req, res) => {
    const r = await repo.completeCampaign(req.params.id!);
    if (!r.ok) {
      res.status(r.reason === 'not_found' ? 404 : 409).json({ error: r.reason });
      return;
    }
    res.json({ status: r.status });
  }),
);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/integration/campaign-lifecycle.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/repo.ts backend/src/routes.ts test/integration/campaign-lifecycle.test.ts
git commit -m "feat(lifecycle): add Start/End Session and Mark Complete transitions"
```

---

### Task 23: Frontend `api.ts` — lifecycle methods

**Files:**
- Modify: `frontend/src/api.ts`

**Interfaces:**
- Consumes: `POST /api/campaigns/:id/{start,end,complete}` (Task 22).
- Produces: `api.startSession(campaignId): Promise<{ status: CampaignStatus }>`, `api.endSession(campaignId)`, `api.completeCampaign(campaignId)`.

- [ ] **Step 1: Edit `frontend/src/api.ts`**

Add `CampaignStatus` to the type imports, and append to the `api` object:

```ts
  startSession: (campaignId: string) =>
    req<{ status: CampaignStatus }>(`/api/campaigns/${campaignId}/start`, { method: 'POST' }),
  endSession: (campaignId: string) =>
    req<{ status: CampaignStatus }>(`/api/campaigns/${campaignId}/end`, { method: 'POST' }),
  completeCampaign: (campaignId: string) =>
    req<{ status: CampaignStatus }>(`/api/campaigns/${campaignId}/complete`, { method: 'POST' }),
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck -w frontend`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api.ts
git commit -m "feat(frontend): lifecycle API client methods"
```

---

### Task 24: `ui.ts` status badge helper

**Files:**
- Modify: `frontend/src/routes/ui.ts`

**Interfaces:**
- Consumes: `CampaignStatus` (shared).
- Produces: `statusColors: Record<CampaignStatus, string>`, `statusBadge(status: CampaignStatus): CSSProperties`.

- [ ] **Step 1: Edit `frontend/src/routes/ui.ts`**

Add the import and append at the end of the file:

```ts
import type { CSSProperties } from 'react';
import type { CampaignStatus } from '@vtt/shared';
```

```ts
export const statusColors: Record<CampaignStatus, string> = {
  draft: '#9ca3af',
  live: '#4ade80',
  paused: accentGm,
  completed: '#60a5fa',
};

export const statusBadge = (status: CampaignStatus): CSSProperties => ({
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: '#08130a',
  background: statusColors[status],
});
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck -w frontend`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/routes/ui.ts
git commit -m "feat(frontend): status badge color helper"
```

---

### Task 25: `GameCampaignsTab.tsx` — full card grid + lifecycle actions (replaces Task 11's minimal version)

**Files:**
- Rewrite: `frontend/src/routes/GameCampaignsTab.tsx`

**Interfaces:**
- Consumes: `api.startSession`/`endSession`/`completeCampaign` (Task 23), `statusBadge` (Task 24).
- Produces: nothing new downstream — this is a leaf UI component.

- [ ] **Step 1: Rewrite `frontend/src/routes/GameCampaignsTab.tsx`**

```tsx
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import type { CampaignStatus, CampaignSummary, GameDetail } from '@vtt/shared';
import { api, ApiError } from '../api';
import { ghostBtn, primaryBtn, statusBadge } from './ui';

const PRIMARY_ACTION: Record<CampaignStatus, string> = {
  live: 'Enter',
  paused: 'Start Session',
  draft: 'Manage',
  completed: 'View',
};

export function GameCampaignsTab({ game, onRefresh }: { game: GameDetail; onRefresh: () => Promise<void> }) {
  const navigate = useNavigate();
  const [showCompleted, setShowCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const visible = game.campaigns.filter((c) => showCompleted || c.status !== 'completed');

  function enter(c: CampaignSummary) {
    void navigate({ to: '/campaign/$campaignId', params: { campaignId: c.id } });
  }
  function manage(c: CampaignSummary) {
    void navigate({ to: '/campaign/$campaignId/manage', params: { campaignId: c.id } });
  }
  function primaryAction(c: CampaignSummary) {
    if (c.status === 'draft') return manage(c);
    if (c.status === 'paused') return void startSession(c);
    return enter(c);
  }

  async function startSession(c: CampaignSummary) {
    setBusyId(c.id);
    setError(null);
    try {
      await api.startSession(c.id);
      await onRefresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not start session.');
    } finally {
      setBusyId(null);
    }
  }
  async function endSession(c: CampaignSummary) {
    setBusyId(c.id);
    setError(null);
    try {
      await api.endSession(c.id);
      await onRefresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not end session.');
    } finally {
      setBusyId(null);
    }
  }
  async function markComplete(c: CampaignSummary) {
    if (!window.confirm(`Mark "${c.name}" complete? This cannot be undone.`)) return;
    setBusyId(c.id);
    setError(null);
    try {
      await api.completeCampaign(c.id);
      await onRefresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not mark complete.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <label style={{ fontSize: 12, opacity: 0.8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={showCompleted} onChange={(e) => setShowCompleted(e.target.checked)} />
          Show completed
        </label>
        <button
          style={primaryBtn}
          onClick={() => void navigate({ to: '/lobby/game/$gameId/campaigns/new', params: { gameId: game.id } })}
        >
          + New Campaign
        </button>
      </div>

      {error && <div style={{ color: '#f87171', fontSize: 13, marginBottom: 8 }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
        {visible.map((c) => (
          <div key={c.id} style={{ padding: 14, background: '#14141f', border: '1px solid #2a2a3a', borderRadius: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ fontWeight: 600 }}>{c.name}</div>
              <span style={statusBadge(c.status)}>{c.status}</span>
            </div>
            <div style={{ opacity: 0.6, fontSize: 12, margin: '6px 0 10px' }}>
              {c.memberCount} member{c.memberCount === 1 ? '' : 's'}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button style={primaryBtn} disabled={busyId === c.id} onClick={() => primaryAction(c)}>
                {PRIMARY_ACTION[c.status]}
              </button>
              {c.status === 'draft' && (
                <button style={ghostBtn} disabled={busyId === c.id} onClick={() => void startSession(c)}>
                  Start Session
                </button>
              )}
              {c.status === 'live' && (
                <button style={ghostBtn} disabled={busyId === c.id} onClick={() => void endSession(c)}>
                  End Session
                </button>
              )}
              {c.status === 'paused' && (
                <button style={ghostBtn} disabled={busyId === c.id} onClick={() => manage(c)}>
                  Manage
                </button>
              )}
              {c.status !== 'completed' && (
                <button style={ghostBtn} disabled={busyId === c.id} onClick={() => void markComplete(c)}>
                  Mark Complete
                </button>
              )}
            </div>
          </div>
        ))}
        {visible.length === 0 && <div style={{ opacity: 0.5, fontSize: 13 }}>No campaigns yet. Create one above.</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck -w frontend`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/routes/GameCampaignsTab.tsx
git commit -m "feat(frontend): Campaigns tab card grid with status badges and lifecycle actions"
```

---

### Task 26: `CreateCampaignPage.tsx` — single-page Create Campaign (replaces Task 11's placeholder)

**Files:**
- Rewrite: `frontend/src/routes/CreateCampaignPage.tsx`

**Interfaces:**
- Consumes: `api.createCampaign` (Task 9, final signature from Task 21's backend), parent `gameRoute`'s loader data (`game: GameDetail`, includes `mapTemplates`/`members`).
- Produces: nothing new downstream.

- [ ] **Step 1: Rewrite `frontend/src/routes/CreateCampaignPage.tsx`**

```tsx
import { useState } from 'react';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { api, ApiError } from '../api';
import { chip, field, ghostBtn, primaryBtn } from './ui';

const gameRouteApi = getRouteApi('/authed/lobby/game/$gameId');

export function CreateCampaignPage() {
  const { game } = gameRouteApi.useLoaderData();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [templateIds, setTemplateIds] = useState<Set<string>>(new Set());
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(set: Set<string>, setSet: (s: Set<string>) => void, id: string) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSet(next);
  }

  async function create() {
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createCampaign({
        gameId: game.id,
        name: name.trim(),
        templateIds: [...templateIds],
        memberUserIds: [...memberIds],
      });
      void navigate({ to: '/lobby/game/$gameId', params: { gameId: game.id } });
    } catch (e) {
      setError(e instanceof ApiError ? `Could not create campaign (${e.message})` : 'Could not create campaign.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ width: 640, maxWidth: '92vw', margin: '40px auto' }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>New Campaign · {game.name}</div>

      <input
        style={{ ...field, width: '100%', marginBottom: 16 }}
        placeholder="Campaign name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <div style={{ display: 'flex', gap: 24 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Map Library templates</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {game.mapTemplates.map((t) => (
              <div key={t.id} style={chip(templateIds.has(t.id))} onClick={() => toggle(templateIds, setTemplateIds, t.id)}>
                {t.name}
              </div>
            ))}
            {game.mapTemplates.length === 0 && (
              <div style={{ opacity: 0.5, fontSize: 12 }}>No templates yet in this Game's Map Library.</div>
            )}
          </div>
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Roster members</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {game.members.map((m) => (
              <div key={m.userId} style={chip(memberIds.has(m.userId))} onClick={() => toggle(memberIds, setMemberIds, m.userId)}>
                {m.displayName}
              </div>
            ))}
            {game.members.length === 0 && (
              <div style={{ opacity: 0.5, fontSize: 12 }}>
                No roster members yet -- share the Game's join code from the Roster tab.
              </div>
            )}
          </div>
        </div>
      </div>

      {error && <div style={{ color: '#f87171', fontSize: 13, margin: '16px 0 0' }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 24 }}>
        <button style={ghostBtn} onClick={() => void navigate({ to: '/lobby/game/$gameId', params: { gameId: game.id } })}>
          Cancel
        </button>
        <button style={primaryBtn} onClick={create} disabled={busy}>
          {busy ? '…' : 'Create Campaign'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck -w frontend`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/routes/CreateCampaignPage.tsx
git commit -m "feat(frontend): single-page Create Campaign (name + template/roster multi-select)"
```

---

### Task 27: e2e — full lifecycle + create-campaign flow

**Files:**
- Create: `test/e2e/campaign-lifecycle.spec.ts`

**Interfaces:**
- Consumes: everything built in Phases 2-5 (sidebar, Game page tabs, Create Campaign page, lifecycle buttons).
- Produces: nothing downstream — this is the final acceptance check for the whole plan.

- [ ] **Step 1: Write the e2e spec**

Create `test/e2e/campaign-lifecycle.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test';

async function loginGM(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByPlaceholder('Display name').fill('Game Master');
  await page.getByPlaceholder('PIN (4-6 digits)').fill('1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/lobby');
}

test('GM creates a Game + Campaign and walks the full lifecycle', async ({ page }) => {
  await loginGM(page);

  await page.getByPlaceholder('New Game name').fill('E2E Lifecycle Setting');
  await page.getByRole('button', { name: '+ New Game' }).click();
  await page.waitForURL('**/lobby/game/**');

  await page.getByRole('button', { name: '+ New Campaign' }).click();
  await page.waitForURL('**/campaigns/new');
  await page.getByPlaceholder('Campaign name').fill('E2E Lifecycle Campaign');
  await page.getByRole('button', { name: 'Create Campaign' }).click();
  await page.waitForURL('**/lobby/game/**');

  const card = page.locator('text=E2E Lifecycle Campaign').locator('..').locator('..');
  await expect(card.getByText('draft')).toBeVisible();

  await card.getByRole('button', { name: 'Start Session' }).first().click();
  await expect(card.getByText('live')).toBeVisible();

  await card.getByRole('button', { name: 'End Session' }).click();
  await expect(card.getByText('paused')).toBeVisible();

  page.once('dialog', (d) => void d.accept());
  await card.getByRole('button', { name: 'Mark Complete' }).click();

  await expect(page.getByText('E2E Lifecycle Campaign')).toHaveCount(0);
  await page.getByLabel('Show completed').check();
  await expect(page.getByText('E2E Lifecycle Campaign')).toBeVisible();
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx playwright test test/e2e/campaign-lifecycle.spec.ts`
Expected: PASS. By this point every backend route (Tasks 3, 4, 8, 22) and frontend component (Tasks 9-12, 20, 23-26) is already committed, so this is the plan's end-to-end acceptance test. If a selector doesn't match, inspect `GameCampaignsTab.tsx`'s actual rendered structure and adjust the locator to scope to that specific card's container `div`.

- [ ] **Step 3: Commit**

```bash
git add test/e2e/campaign-lifecycle.spec.ts
git commit -m "test(e2e): full Games/Campaign lifecycle flow (create Game, create Campaign, transitions, Show completed)"
```

---

## Final Verification

- [ ] Run the full committed suite: `npm test` (builds `shared`, ensures `vtt_test` DB, runs all Vitest integration/unit tests, then all Playwright e2e specs).
- [ ] Run `npm run typecheck` across all three workspaces.
- [ ] Before deploying to any real instance with existing data, dry-run `backend/db/migrate-games-hierarchy.sql` (Task 7) against a backup/scratch copy first — it is not exercised by `npm test` since local dev always starts from an empty schema.

---

## Self-Review

**Spec coverage** (docs/12 section by section): §2 model (Lobby→Game→Campaign, concurrent campaigns, copy-on-assign, roster persistent/subset) → Tasks 1, 4, 15, 21. §3 data model deltas → Task 1. §4 lifecycle → Tasks 22, 25. §5 frontend shape (sidebar, tabs, card grid, single-page create) → Tasks 10-12, 16, 20, 25-26. §6 migration → Tasks 5 (seed) + 7 (deploy script). §7 authorization → `isGameGm` (Task 3) + `requireGameGm` (Task 8) alongside unchanged `requireCampaignGm`. §8 five phases → Phases 1-5 above. §9 deferred items are not built anywhere in this plan.

**Placeholder scan:** every step carries complete, runnable code; no "TBD"/"similar to Task N"/prose-only steps. Task 7's Step 2 is intentionally a documented manual-verification step (not a placeholder) since it operates on real deployed data `npm test` cannot exercise.

**Type/signature consistency:** `createCampaign` is introduced in Task 4 (`userId, gameId, name, joinCode`) and extended additively in Task 15 (`+ templateIds`) and Task 21 (`+ memberUserIds`) — every call site (`routes.ts`, test helpers) is updated in the same task that changes the signature. `isGameGm` (Task 3) is consumed inline by Task 4's route before `requireGameGm` (Task 8, which wraps `isGameGm` as Express middleware) exists — routes needing only a boolean check (like `POST /api/campaigns`) call `repo.isGameGm` directly; routes needing full route-level gating use `requireGameGm`. `listMapTemplates` is a stub (Task 8) later replaced by a real implementation in the same function name (Task 14) — `getGameDetail` (Task 6) is updated in Task 14 to call the real version. `listGameMembers` (Task 6) is fully implemented once and reused as-is by Task 18's route. `GameDetail`/`GameMemberDto`/`MapTemplateSummary`/`EligibleSheetDto`/`CampaignStatus`/`CreateCampaignRequest` are defined once (Task 2) and consumed verbatim by every later task. Route id strings (`/authed/lobby`, `/authed/lobby/game/$gameId`) are used consistently across Tasks 10, 12, 25, 26, with an explicit caveat (Tasks 10, 26) to reconcile against TanStack's generated literal if it differs slightly.

### Critical Files for Implementation
- `backend/db/schema.sql`
- `backend/src/repo.ts`
- `backend/src/routes.ts`
- `shared/src/api.ts`
- `frontend/src/router.tsx`
