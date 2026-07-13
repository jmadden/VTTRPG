import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { router } from './router';
import { api, clearToken, getToken } from './api';
import { setSession } from './store';

// No StrictMode: it double-invokes the mount effect in dev, which races the
// async Pixi Application.init and leaves orphan canvases. The stage lifecycle
// in MapView is already guarded, but skipping StrictMode keeps it simple.
async function boot() {
  // Hydrate the session before rendering so the route guard reads it synchronously.
  const token = getToken();
  if (token) {
    try {
      const { user } = await api.me();
      setSession(user);
    } catch {
      clearToken(); // stale/invalid token
    }
  }
  const el = document.getElementById('root');
  if (!el) throw new Error('#root not found');
  createRoot(el).render(<RouterProvider router={router} />);
}

void boot();
