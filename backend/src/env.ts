// Loads the monorepo-root .env BEFORE any module that reads process.env.
// Imported first in index.ts so it evaluates ahead of db.ts (which builds the
// pg pool at import time). Works under tsx (src) and node (dist): both resolve
// ../../.env relative to this file.
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });
