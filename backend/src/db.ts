// Postgres access. Raw `pg` per the locked decision — no ORM.
// The pool connects lazily on first query; if no local DB is running yet, the
// query rejects and the caller logs it, but the server stays up.
import pg from 'pg';
import type { QueryResult, QueryResultRow } from 'pg';

const { Pool } = pg;

// Managed cloud Postgres (e.g. Render external connections) requires SSL; local
// Postgres does not. Gate it on DATABASE_SSL so local dev is unchanged.
const useSsl = process.env.DATABASE_SSL === '1' || process.env.DATABASE_SSL === 'true';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
});

// Prevent an idle-client/connection error from crashing the process.
pool.on('error', (err) => {
  console.error('[db] pool error:', err.message);
});

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params as unknown[]);
}
