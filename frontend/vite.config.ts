import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server binds all interfaces (host:true) so LAN players can reach it.
export default defineConfig({
  plugins: [react()],
  // Load VITE_* vars from the monorepo-root .env (shared with the backend),
  // not just frontend/. Without this the root VITE_SERVER_URL is ignored and
  // the client falls back to http://localhost:4000.
  envDir: '..',
  server: {
    port: 5173,
    host: true,
  },
});
