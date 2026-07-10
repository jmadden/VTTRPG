// Local-host backend entrypoint: Express (assets + health) + Socket.io.
import './env.js'; // MUST be first: loads .env before db.ts builds the pool.
import { createServer } from 'node:http';
import express from 'express';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@vtt/shared';
import { isDbConfigured } from './db.js';
import { registerSocketHandlers, type SocketData } from './socket/index.js';

const PORT = Number(process.env.PORT ?? 4000);
const ASSET_DIR = process.env.ASSET_DIR ?? './uploads';
const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim());

const app = express();
app.use('/assets', express.static(ASSET_DIR));
app.get('/health', (_req, res) => {
  res.json({ ok: true, db: isDbConfigured() });
});

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
