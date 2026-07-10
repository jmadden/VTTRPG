import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { router } from './router';

// No StrictMode: it double-invokes the mount effect in dev, which races the
// async Pixi Application.init and leaves orphan canvases. The stage lifecycle
// in MapView is already guarded, but skipping StrictMode keeps it simple.
const el = document.getElementById('root');
if (!el) throw new Error('#root not found');

createRoot(el).render(<RouterProvider router={router} />);
