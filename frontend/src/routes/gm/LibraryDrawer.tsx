import { useEffect, useState, useSyncExternalStore } from 'react';
import { EV, type MapSummary } from '@vtt/shared';
import { api, ApiError, assetUrl } from '../../api';
import { socket } from '../../socket';
import { getVersion, state, subscribe } from '../../store';
import { uploadMapWithDims } from '../mapUpload';
import { eyebrow, field, ghostBtn, primaryBtn, space, surface } from '../ui';

interface Props {
  campaignId: string;
}

/** Add an existing library map as a live tab, or upload straight into the
 *  live set. Library CRUD itself still lives in MapsManager. */
export function LibraryDrawer({ campaignId }: Props) {
  useSyncExternalStore(subscribe, getVersion);
  const [maps, setMaps] = useState<MapSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [gridSize, setGridSize] = useState(70);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) void api.listMaps(campaignId).then(setMaps);
  }, [open, campaignId]);

  function addAsTab(m: MapSummary) {
    const next = [
      ...state.liveMaps.map((l) => ({ mapId: l.mapId, title: l.title, position: l.position })),
      { mapId: m.id, title: m.name, position: state.liveMaps.length },
    ];
    socket.emit(EV.SET_LIVE_MAPS, { campaignId, liveMaps: next }, (ack) => {
      if (!ack.ok) setError('Could not add tab.');
    });
  }

  async function uploadAndAdd() {
    if (!file) {
      setError('Choose an image first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const m = await uploadMapWithDims(campaignId, file, {
        name: name.trim() || file.name,
        gridSize,
      });
      setName('');
      setFile(null);
      setMaps((prev) => [...prev, m]);
      addAsTab(m);
    } catch (e) {
      setError(e instanceof ApiError ? `Upload failed (${e.message})` : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  const liveIds = new Set(state.liveMaps.map((m) => m.mapId));

  return (
    <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative' }}>
      <button style={ghostBtn} onClick={() => setOpen((o) => !o)}>
        {open ? 'Close Map Library' : 'Map Library'}
      </button>
      {open && (
        <div
          style={{
            ...surface,
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: 280,
            padding: space.md,
            fontSize: 13,
            color: '#e5e7eb',
            display: 'flex',
            flexDirection: 'column',
            gap: space.sm,
            boxShadow: '0 12px 24px rgba(0,0,0,0.35)',
          }}
        >
          {error && <div style={{ color: '#f87171', fontSize: 12 }}>{error}</div>}

          <div style={eyebrow}>Your maps</div>
          {maps.map((m) => {
            const isLive = liveIds.has(m.id);
            return (
              <div
                key={m.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: space.sm,
                  opacity: isLive ? 0.5 : 1,
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 4,
                    overflow: 'hidden',
                    flexShrink: 0,
                    background: '#0f0f16',
                    border: '1px solid #2a2a3a',
                  }}
                >
                  {m.assetPath && (
                    <img
                      src={assetUrl(m.assetPath)}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  )}
                </div>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {m.name}
                </span>
                {isLive ? (
                  <span style={{ fontSize: 11, opacity: 0.8, flexShrink: 0 }}>Added</span>
                ) : (
                  <button
                    data-testid={`library-add-${m.id}`}
                    style={{ ...ghostBtn, padding: '2px 8px', fontSize: 11, flexShrink: 0 }}
                    onClick={() => addAsTab(m)}
                  >
                    add
                  </button>
                )}
              </div>
            );
          })}
          {maps.length === 0 && (
            <div style={{ opacity: 0.5, fontSize: 12 }}>No maps yet — upload one below.</div>
          )}

          <div style={{ height: 1, background: '#2a2a3a', margin: `${space.xs}px 0` }} />

          <div style={eyebrow}>Upload new map</div>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            style={{ fontSize: 12 }}
          />
          <input
            style={field}
            placeholder="Map name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: space.sm, fontSize: 12, opacity: 0.8 }}>
            Grid cell size
            <input
              style={{ ...field, width: 64, marginLeft: 'auto' }}
              type="number"
              min={10}
              value={gridSize}
              onChange={(e) => setGridSize(Math.max(10, Number(e.target.value) || 70))}
            />
            px
          </label>
          <button style={primaryBtn} onClick={uploadAndAdd} disabled={busy}>
            {busy ? '…' : 'Upload + add as tab'}
          </button>
        </div>
      )}
    </div>
  );
}
