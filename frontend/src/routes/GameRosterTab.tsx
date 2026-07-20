import { useEffect, useState } from 'react';
import type { EligibleSheetDto, GameDetail } from '@vtt/shared';
import { api, ApiError } from '../api';
import { field, ghostBtn, surface } from './ui';

export function GameRosterTab({ game, onRefresh }: { game: GameDetail; onRefresh: () => Promise<void> }) {
  const [sheetOptions, setSheetOptions] = useState<Record<string, EligibleSheetDto[]>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const entries = await Promise.all(
        game.members.map(async (m) => [m.userId, await api.listEligibleSheets(game.id, m.userId)] as const),
      );
      setSheetOptions(Object.fromEntries(entries));
    })();
  }, [game.id, game.members]);

  async function attach(userId: string, characterSheetId: string) {
    setError(null);
    try {
      await api.attachSheet(game.id, userId, characterSheetId || null);
      await onRefresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not attach sheet.');
    }
  }

  return (
    <div>
      <div style={{ ...surface, padding: 12, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ fontSize: 13, opacity: 0.8 }}>Join code for new players</div>
        <input style={{ ...field, width: 140, fontFamily: 'monospace' }} readOnly value={game.joinCode} />
      </div>

      {error && <div style={{ color: '#f87171', fontSize: 13, marginBottom: 8 }}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {game.members.map((m) => (
          <div
            key={m.userId}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: 10,
              background: '#14141f',
              border: '1px solid #2a2a3a',
              borderRadius: 8,
            }}
          >
            <div style={{ fontWeight: 600 }}>{m.displayName}</div>
            <select value={m.characterSheetId ?? ''} onChange={(e) => void attach(m.userId, e.target.value)} style={field}>
              <option value="">No sheet attached</option>
              {(sheetOptions[m.userId] ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        ))}
        {game.members.length === 0 && (
          <div style={{ opacity: 0.5, fontSize: 13 }}>No roster members yet. Share the join code above.</div>
        )}
      </div>
      <button style={{ ...ghostBtn, marginTop: 12 }} onClick={() => void onRefresh()}>
        Refresh roster
      </button>
    </div>
  );
}
