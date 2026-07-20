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
import { LobbyHome } from './routes/LobbyHome';
import { GamePage } from './routes/GamePage';
import { CreateCampaignPage } from './routes/CreateCampaignPage';
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

// docs/12: persistent sidebar shell listing the GM's Games. Its default
// child (lobbyHomeRoute) is the pre-existing flat "your campaigns as a
// player" view (docs/12 §2: unaffected) -- selecting a Game in the sidebar
// swaps this area for that Game's own tabs (gameRoute -> GamePage).
const lobbyRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/lobby',
  component: Lobby,
});

const lobbyHomeRoute = createRoute({
  getParentRoute: () => lobbyRoute,
  path: '/',
  component: LobbyHome,
});

// A layout route: loads the Game once and renders whichever child matches
// (the tabs view by default, or Create Campaign) via Outlet. Mirrors the
// lobbyRoute/lobbyHomeRoute shell pattern above.
const gameRoute = createRoute({
  getParentRoute: () => lobbyRoute,
  path: '/game/$gameId',
  loader: async ({ params }) => ({ game: await api.getGame(params.gameId) }),
  component: () => <Outlet />,
});

const gameIndexRoute = createRoute({
  getParentRoute: () => gameRoute,
  path: '/',
  component: GamePage,
});

const createCampaignRoute = createRoute({
  getParentRoute: () => gameRoute,
  path: '/campaigns/new',
  component: CreateCampaignPage,
});

const campaignRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/campaign/$campaignId',
  loader: async ({ params }) => {
    const campaign = await api.getCampaign(params.campaignId);
    const isGm = campaign.gmUserId === state.session?.user.id;
    // GM starts on the first live tab (or no map, if the live set is empty —
    // MapView renders the tab bar + library drawer with no canvas). A player
    // starts wherever their own token currently sits ("a player is where
    // their token is" — docs/11 §2), or null for an in-component waiting
    // screen if unplaced. No redirect on null in either case (docs/11 §7).
    const mapId = isGm ? (campaign.liveMaps[0]?.mapId ?? null) : campaign.viewerMapId;
    return { mapId, campaign };
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
  authedRoute.addChildren([
    lobbyRoute.addChildren([lobbyHomeRoute, gameRoute.addChildren([gameIndexRoute, createCampaignRoute])]),
    campaignRoute,
    manageRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
