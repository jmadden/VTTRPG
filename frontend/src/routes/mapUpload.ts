// Shared upload helper: reused by MapsManager (library CRUD) and LibraryDrawer
// (upload straight into the live set), so the dims-from-image logic lives once.
import type { MapSummary } from '@vtt/shared';
import { api } from '../api';

/** Read an image's pixel dimensions client-side, so the server needs no image lib. */
export function readDims(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('bad_image'));
    };
    img.src = url;
  });
}

/** Upload an image as a new library map; cols/rows are computed from the
 *  image's pixel size and the requested grid cell size. */
export async function uploadMapWithDims(
  campaignId: string,
  file: File,
  meta: { name: string; gridSize: number },
): Promise<MapSummary> {
  const { w, h } = await readDims(file);
  const cols = Math.max(1, Math.ceil(w / meta.gridSize));
  const rows = Math.max(1, Math.ceil(h / meta.gridSize));
  return api.uploadMap(campaignId, file, { name: meta.name, gridSize: meta.gridSize, cols, rows });
}
