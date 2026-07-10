# 06 - Verification

How the system has been verified so far, and how to reproduce it. Note: the
end-to-end checks below were run as throwaway scripts during development and are
**not yet committed as a test suite**. Formalizing them (for example under
`backend/test` and a Playwright config) is a recommended next step; this doc
records what was asserted so that coverage is not lost.

## 1. Static typecheck

```bash
npm run build -w shared     # shared must be built first
npm run typecheck           # tsc --noEmit across shared, backend, frontend
```
All three workspaces pass under strict TypeScript (5.9), including
`noUncheckedIndexedAccess` and `verbatimModuleSyntax`.

## 2. Coordinate + filter logic (unit level)

A dependency-free port of `coords.ts` and the visibility filter was exercised:

- Square and hex cell round-trips (`cellToWorld` -> `worldToCell` returns the
  same key), including negative coordinates and cell boundaries.
- The full anti-cheat gating table: hidden-on-unrevealed dropped, GM fields
  stripped, and the four move transitions (`add` / `remove` / `none` / `move`).

## 3. Socket end-to-end (live DB, real Socket.io)

Two throwaway `socket.io-client` scripts connected to the running backend and
asserted, against the seeded demo map:

Visibility + reveal + move:
- Player does not receive the hidden Orc; no `hidden` field on player tokens.
- GM receives both tokens.
- Revealing the Orc's cell pushes it to the player via `newlyVisible`.
- Moving a hidden token into fog emits `token_remove`; out of fog emits
  `token_add`.
- A player-initiated `reveal_tiles` is ignored (GM-only enforced).

Conceal + movable:
- `state_sync` carries `movableTokenIds`; a player may not move the Orc; the GM
  may move every token.
- Concealing the Orc's cell sends the player `conceal_tiles` and a
  `token_remove` (re-hidden).
- A player-initiated `conceal_tiles` is ignored (GM-only enforced).

## 4. Browser end-to-end (Playwright + Chromium)

Headless Chromium drove the real UI, with assertions cross-checked against the
database via `pg`:

- The Pixi v8 canvas mounts with zero uncaught page errors.
- GM view shows 2 tokens; switching to Player drops to 1 (anti-cheat visible in
  the UI).
- Dragging a token snaps it to a cell center and persists the new position to
  the DB.
- GM click reveals a cell (persisted); switching to the Conceal tool and
  clicking paints fog back (removed from DB).
- Screenshots confirm the slate fog color and the HUD controls.

Reproduce (browsers are a one-time install):
```bash
npx playwright install chromium
npm run dev          # in one terminal
# then run a script that navigates to http://localhost:5173 and drives the UI
```

## Bugs caught by verification

- **Token drag silently did nothing** (found only in the browser, invisible to
  the socket tests): a token `Container` was interactive but had no `hitArea`,
  and its child `Graphics` is passive by default, so Pixi never registered
  `pointerdown`. Fixed with an explicit `Circle` hit area (doc 05).
- **Redraw could destroy the dragged token** if an external delta arrived
  mid-drag. Fixed by early-returning from the redraw effect while dragging.
- **Root `.env` not loaded** under `npm run dev` (CWD is the workspace dir).
  Fixed with `backend/src/env.ts` (imported first) and Vite `envDir: '..'`
  (doc 01).

## Recommended next steps for testing

- Commit the socket and browser scripts as a real suite with an `npm test`.
- Add a test database and reset fixtures so runs are isolated from dev data.
- Add CI to run typecheck + tests on push.
