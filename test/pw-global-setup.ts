// Playwright global setup: reset the test DB before the e2e run.
import { resetTestDb } from './db';

export default async function globalSetup(): Promise<void> {
  await resetTestDb();
}
