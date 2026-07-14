// Shared test config. The committed suite runs against a dedicated `vtt_test`
// database, isolated from dev/Docker. Override via env for CI.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://localhost:5432/vtt_test';

// Vitest integration spawns the backend here (isolated from the :4000 app).
export const BACKEND_PORT = Number(process.env.TEST_BACKEND_PORT ?? 4100);
export const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;
