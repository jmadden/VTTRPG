import { useState } from 'react';
import type { GameDetail } from '@vtt/shared';
import { ApiError } from '../api';
import { uploadMapTemplateWithDims } from './mapUpload';
import { field, primaryBtn } from './ui';

export function GameMapLibraryTab({ game, onRefresh }: { game: GameDetail; onRefresh: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [gridSize, setGridSize] = useState(70);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    if (!file) {
      setError('Choose an image first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await uploadMapTemplateWithDims(game.id, file, { name: name.trim() || file.name, gridSize });
      setName('');
      setFile(null);
      await onRefresh();
    } catch (e) {
      setError(e instanceof ApiError ? `Upload failed (${e.message})` : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div
        style={{
          marginBottom: 16,
          padding: 12,
          background: '#14141f',
          border: '1px solid #2a2a3a',
          borderRadius: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div style={{ fontWeight: 600 }}>Upload a map template</div>
        <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={{ ...field, flex: 1 }}
            placeholder="Template name (defaults to file name)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            style={{ ...field, width: 120 }}
            type="number"
            min={10}
            value={gridSize}
            onChange={(e) => setGridSize(Math.max(10, Number(e.target.value) || 70))}
            title="Cell size in pixels"
          />
          <button style={primaryBtn} onClick={upload} disabled={busy}>
            {busy ? '…' : 'Upload'}
          </button>
        </div>
      </div>

      {error && <div style={{ color: '#f87171', fontSize: 13, marginBottom: 8 }}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {game.mapTemplates.map((t) => (
          <div
            key={t.id}
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
            <div>
              <div style={{ fontWeight: 600 }}>{t.name}</div>
              <div style={{ opacity: 0.6, fontSize: 12 }}>
                {t.cols}×{t.rows} cells · {t.gridSize}px
              </div>
            </div>
          </div>
        ))}
        {game.mapTemplates.length === 0 && (
          <div style={{ opacity: 0.5, fontSize: 13 }}>
            No templates yet. Upload one above, then pick it when creating a Campaign.
          </div>
        )}
      </div>
    </div>
  );
}
