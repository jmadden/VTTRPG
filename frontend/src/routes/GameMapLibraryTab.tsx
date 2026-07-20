import type { GameDetail } from '@vtt/shared';

export function GameMapLibraryTab({ game }: { game: GameDetail; onRefresh: () => Promise<void> }) {
  return (
    <div style={{ opacity: 0.5, fontSize: 13 }}>
      {game.mapTemplates.length === 0 ? 'No map templates yet.' : `${game.mapTemplates.length} template(s).`}
    </div>
  );
}
