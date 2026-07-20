import { getRouteApi } from '@tanstack/react-router';

const gameRouteApi = getRouteApi('/authed/lobby/game/$gameId');

export function CreateCampaignPage() {
  const { game } = gameRouteApi.useLoaderData();
  return <div style={{ margin: 40 }}>New Campaign · {game.name} (coming in Phase 5)</div>;
}
