import type { GameDetail } from '@vtt/shared';

export function GameRosterTab({ game }: { game: GameDetail; onRefresh: () => Promise<void> }) {
  return (
    <div style={{ opacity: 0.5, fontSize: 13 }}>
      {game.members.length === 0 ? 'No roster members yet.' : `${game.members.length} member(s).`}
    </div>
  );
}
