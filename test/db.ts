// Reset the test database to a fresh schema + seed. Assumes the `vtt_test`
// database already exists (see the `test:db:ensure` script / docs/06).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { TEST_DATABASE_URL } from './config';

// Resolved from the repo root (the CWD for both `vitest` and `playwright`),
// which avoids import.meta (Playwright's config loader treats these as CJS).
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

export async function resetTestDb(): Promise<void> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await client.query(read('backend/db/schema.sql'));
    await client.query(read('backend/db/seed.sql'));
  } finally {
    await client.end();
  }
}
