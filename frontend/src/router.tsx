import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  Outlet,
} from '@tanstack/react-router';
import { MapView } from './routes/MapView';
import { Login } from './routes/Login';
import { Lobby } from './routes/Lobby';
import { MapsManager } from './routes/MapsManager';
import { api } from './api';
import { state } from './store';

// Code-based route tree (no file-based routing / codegen).
const rootRoute = createRootRoute({ component: () => <Outlet /> });

// Public.
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: Login,
});

// '/' -> lobby (guarded below).
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/lobby' });
  },
});

// Pathless layout that guards its children: no session -> /login. The session
// is hydrated in main.tsx before render, so this reads synchronously.
const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'authed',
  beforeLoad: () => {
    if (!state.session) throw redirect({ to: '/login' });
  },
  component: () => <Outlet />,
});

const lobbyRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/lobby',
  component: Lobby,
});

const campaignRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/campaign/$campaignId',
  loader: async ({ params }) => {
    const campaign = await api.getCampaign(params.campaignId);
    if (!campaign.activeMapId) throw redirect({ to: '/lobby' });
    return { mapId: campaign.activeMapId, campaign };
  },
  component: MapView,
});

// GM-only map management (reachable even with no active map).
const manageRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/campaign/$campaignId/manage',
  loader: async ({ params }) => {
    const campaign = await api.getCampaign(params.campaignId);
    if (campaign.gmUserId !== state.session?.user.id) throw redirect({ to: '/lobby' });
    const maps = await api.listMaps(params.campaignId);
    return { campaign, maps };
  },
  component: MapsManager,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  indexRoute,
  authedRoute.addChildren([lobbyRoute, campaignRoute, manageRoute]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
