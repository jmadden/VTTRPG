import { useState } from 'react';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import type { MapSummary } from '@vtt/shared';
import { api, ApiError } from '../api';
import { uploadMapWithDims } from './mapUpload';
import { field, linkBtn, panel, primaryBtn } from './ui';

const routeApi = getRouteApi('/authed/campaign/$campaignId/manage');

// Pure library CRUD (gm-maps-1b): "active map" is gone — which maps are live
// is managed from the in-game tab bar/library drawer, not here.
export function MapsManager() {
  const loader = routeApi.useLoaderData();
  const navigate = useNavigate();
  const [maps, setMaps] = useState<MapSummary[]>(loader.maps);
  const [name, setName] = useState('');
  const [gridSize, setGridSize] = useState(70);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const campaignId = loader.campaign.id;

  async function refresh() {
    setMaps(await api.listMaps(campaignId));
  }

  async function upload() {
    if (!file) {
      setError('Choose an image first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await uploadMapWithDims(campaignId, file, { name: name.trim() || file.name, gridSize });
      setName('');
      setFile(null);
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? `Upload failed (${e.message})` : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ ...panel, alignItems: 'flex-start', overflow: 'auto' }}>
      <div style={{ width: 520, maxWidth: '90vw', margin: '40px auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>Maps · {loader.campaign.name}</div>
          <div style={{ fontSize: 13 }}>
            <button style={linkBtn} onClick={() => void navigate({ to: '/lobby' })}>
              lobby
            </button>
            <button
              style={{ ...primaryBtn, marginLeft: 8 }}
              onClick={() => void navigate({ to: '/campaign/$campaignId', params: { campaignId } })}
            >
              Enter
            </button>
          </div>
        </div>

        <div
          style={{
            margin: '16px 0',
            padding: 12,
            background: '#14141f',
            border: '1px solid #2a2a3a',
            borderRadius: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ fontWeight: 600 }}>Upload a map</div>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              style={{ ...field, flex: 1 }}
              placeholder="Map name (defaults to file name)"
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
          <div style={{ opacity: 0.6, fontSize: 12 }}>
            Grid columns/rows are computed from the image and the cell size.
          </div>
        </div>

        {error && <div style={{ color: '#f87171', fontSize: 13, marginBottom: 8 }}>{error}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {maps.map((m) => (
            <div
              key={m.id}
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
                <div style={{ fontWeight: 600 }}>{m.name}</div>
                <div style={{ opacity: 0.6, fontSize: 12 }}>
                  {m.cols}×{m.rows} cells · {m.gridSize}px
                </div>
              </div>
            </div>
          ))}
          {maps.length === 0 && (
            <div style={{ opacity: 0.5, fontSize: 13 }}>
              No maps yet. Upload one above, then add it as a live tab from
              inside the game.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
