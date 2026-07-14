import { defineConfig } from '@playwright/test';
import { TEST_DATABASE_URL } from './test/config';

// E2E runs the real dev servers: backend :4000 + Vite :5173 (the frontend uses
// its dev fallback to :4000). Requires those ports free, so stop any running
// dev/Docker app first. DB is reset in globalSetup.
export default defineConfig({
  testDir: './test/e2e',
  globalSetup: './test/pw-global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: { baseURL: 'http://localhost:5173' },
  webServer: [
    {
      command: 'node_modules/.bin/tsx backend/src/index.ts',
      env: { DATABASE_URL: TEST_DATABASE_URL, PORT: '4000', CORS_ORIGINS: 'http://localhost:5173' },
      url: 'http://localhost:4000/health',
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: 'npm run dev -w frontend',
      env: { VITE_SERVER_URL: 'http://localhost:4000' },
      url: 'http://localhost:5173',
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
});
