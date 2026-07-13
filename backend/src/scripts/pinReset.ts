// Host-level PIN reset (docs/09 section 9): there is no HTTP reset endpoint by
// design. Usage:  npm run pin:reset -w backend -- "Display Name" 1234
import '../env.js';
import { pool } from '../db.js';
import { hashPin, isValidPin } from '../auth.js';

const name = process.argv[2];
const pin = process.argv[3];

if (!name || !isValidPin(pin)) {
  console.error('usage: npm run pin:reset -w backend -- "Display Name" <4-6 digit pin>');
  process.exit(1);
}

const hash = await hashPin(pin);
const res = await pool.query<{ id: string }>(
  'UPDATE users SET pin_hash = $2 WHERE lower(display_name) = lower($1) RETURNING id',
  [name, hash],
);
if (res.rowCount === 0) {
  console.error(`no user named "${name}"`);
  await pool.end();
  process.exit(1);
}
// Invalidate that user's existing sessions.
await pool.query('DELETE FROM sessions WHERE user_id = $1', [res.rows[0]!.id]);
console.log(`PIN reset for "${name}" (sessions cleared)`);
await pool.end();
