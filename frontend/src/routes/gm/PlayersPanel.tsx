import { useSyncExternalStore } from 'react';
import type { CampaignMemberDto, MemberTokenDto } from '@vtt/shared';
import { getVersion, state, subscribe } from '../../store';
import { eyebrow, space, surface } from '../ui';

interface Props {
  members: CampaignMemberDto[];
  memberTokens: MemberTokenDto[];
}

/** Each non-GM member's current token, draggable onto a TabBar tab to
 *  relocate them (the drop itself is handled by TabBar's onRelocateToken). */
export function PlayersPanel({ members, memberTokens }: Props) {
  useSyncExternalStore(subscribe, getVersion);
  const byUser = new Map(memberTokens.map((t) => [t.userId, t]));
  const players = members.filter((m) => !m.isGm);

  function titleFor(mapId: string): string {
    return state.liveMaps.find((m) => m.mapId === mapId)?.title ?? mapId.slice(0, 8);
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        ...surface,
        position: 'fixed',
        bottom: space.md,
        left: space.md,
        zIndex: 10,
        width: 220,
        padding: space.md,
        fontSize: 13,
        color: '#e5e7eb',
        display: 'flex',
        flexDirection: 'column',
        gap: space.xs,
      }}
    >
      <div style={{ ...eyebrow, marginBottom: space.xs }}>Players · drag onto a tab</div>
      {players.map((p) => {
        const tok = byUser.get(p.id);
        return (
          <div
            key={p.id}
            data-testid={`player-row-${p.id}`}
            draggable={!!tok}
            onDragStart={(e) => {
              if (tok) e.dataTransfer.setData('text/plain', tok.tokenId);
            }}
            style={{
              padding: '6px 8px',
              borderRadius: 6,
              border: '1px solid #2a2a3a',
              background: '#1a1a24',
              cursor: tok ? 'grab' : 'default',
              opacity: tok ? 1 : 0.5,
              fontSize: 13,
            }}
          >
            {p.displayName}{' '}
            <span style={{ opacity: 0.6, fontSize: 12 }}>
              {tok ? `· ${titleFor(tok.mapId)}` : '· unplaced'}
            </span>
          </div>
        );
      })}
      {players.length === 0 && <div style={{ opacity: 0.5, fontSize: 12 }}>No players yet.</div>}
    </div>
  );
}
