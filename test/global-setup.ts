// Vitest global setup: reset the test DB and start the backend once for the
// integration specs. Unit specs ignore it (no network).
import { spawn, type ChildProcess } from 'node:child_process';
import { resetTestDb } from './db';
import { BACKEND_PORT, BACKEND_URL, TEST_DATABASE_URL } from './config';

async function waitForHealth(url: string, ms = 20000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`backend did not become healthy at ${url}`);
}

export default async function setup(): Promise<() => Promise<void>> {
  await resetTestDb();
  const backend: ChildProcess = spawn('node_modules/.bin/tsx', ['backend/src/index.ts'], {
    env: {
      ...process.env,
      DATABASE_URL: TEST_DATABASE_URL,
      PORT: String(BACKEND_PORT),
      CORS_ORIGINS: 'http://localhost:5173',
    },
    stdio: 'inherit',
  });
  await waitForHealth(`${BACKEND_URL}/health`);
  return async () => {
    backend.kill();
  };
}
