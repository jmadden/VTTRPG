// Local-host backend entrypoint: Express (assets + health) + Socket.io.
import './env.js'; // MUST be first: loads .env before db.ts builds the pool.
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@vtt/shared';
import { isDbConfigured } from './db.js';
import { apiRouter } from './routes.js';
import { registerSocketHandlers, type SocketData } from './socket/index.js';

const PORT = Number(process.env.PORT ?? 4000);
const ASSET_DIR = process.env.ASSET_DIR ?? './uploads';
const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim());

const app = express();
// CORS covers the REST /api in cross-origin dev (Vite :5173 -> backend :4000);
// same-origin prod does not need it. Reuses the parsed CORS_ORIGINS list, the
// same one Socket.io uses. Body parser feeds the /api login/campaign routes.
app.use(cors({ origin: CORS_ORIGINS }));
app.use(express.json());
app.use('/assets', express.static(ASSET_DIR));
app.get('/health', (_req, res) => {
  res.json({ ok: true, db: isDbConfigured() });
});
app.use('/api', apiRouter);

// Production / local-prod-parity: serve the built SPA same-origin (env-gated so
// `npm run dev` is unaffected). Render and `npm start` set SERVE_CLIENT=1.
if (process.env.SERVE_CLIENT === '1') {
  const distDir = fileURLToPath(new URL('../../frontend/dist', import.meta.url));
  const indexHtml = fileURLToPath(new URL('../../frontend/dist/index.html', import.meta.url));
  app.use(express.static(distDir));
  // SPA history fallback: serve index.html for client routes. Not for /api
  // (future REST 404s must stay JSON), /assets, or non-GET. Socket.io owns
  // /socket.io at the engine level, so Express never sees it.
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/assets')) {
      return next();
    }
    res.sendFile(indexHtml);
  });
}

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(
  httpServer,
  { cors: { origin: CORS_ORIGINS, methods: ['GET', 'POST'] } },
);

registerSocketHandlers(io);

httpServer.listen(PORT, () => {
  console.log(`[vtt] backend listening on http://localhost:${PORT}`);
  console.log(`[vtt] cors origins: ${CORS_ORIGINS.join(', ')}`);
  if (!isDbConfigured()) {
    console.warn('[vtt] DATABASE_URL not set — DB-backed events will error until a local Postgres is configured.');
  }
});
