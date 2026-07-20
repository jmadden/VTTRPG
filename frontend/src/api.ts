// REST client for the /api auth + lobby routes. Owns the bearer token
// (localStorage). Base URL mirrors socket.ts: same-origin in prod, :4000 in dev.
import type {
  AuthResponse,
  AuthUser,
  CampaignDetail,
  CampaignStatus,
  CampaignSummary,
  CreateCampaignRequest,
  EligibleSheetDto,
  GameDetail,
  GameMemberDto,
  GameSummary,
  MapSummary,
  MapTemplateSummary,
} from '@vtt/shared';

const BASE =
  import.meta.env.VITE_SERVER_URL || (import.meta.env.DEV ? 'http://localhost:4000' : '');

/** Resolve a server asset path (e.g. "/assets/x.png") to a loadable URL. */
export function assetUrl(path: string): string {
  return BASE + path;
}

const TOKEN_KEY = 'vtt.token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const b = (await res.json()) as { error?: string };
      if (b.error) msg = b.error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  register: (displayName: string, pin: string) =>
    req<AuthResponse>('/api/register', {
      method: 'POST',
      body: JSON.stringify({ displayName, pin }),
    }),
  login: (displayName: string, pin: string) =>
    req<AuthResponse>('/api/login', {
      method: 'POST',
      body: JSON.stringify({ displayName, pin }),
    }),
  logout: () => req<void>('/api/logout', { method: 'POST' }),
  me: () => req<{ user: AuthUser }>('/api/me'),
  listGames: () => req<GameSummary[]>('/api/games'),
  createGame: (name: string, description?: string) =>
    req<GameSummary>('/api/games', { method: 'POST', body: JSON.stringify({ name, description }) }),
  getGame: (gameId: string) => req<GameDetail>(`/api/games/${gameId}`),
  listGameMembers: (gameId: string) => req<GameMemberDto[]>(`/api/games/${gameId}/members`),
  listEligibleSheets: (gameId: string, userId: string) =>
    req<EligibleSheetDto[]>(`/api/games/${gameId}/members/${userId}/sheets`),
  attachSheet: (gameId: string, userId: string, characterSheetId: string | null) =>
    req<{ ok: true }>(`/api/games/${gameId}/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ characterSheetId }),
    }),
  listMapTemplates: (gameId: string) => req<MapTemplateSummary[]>(`/api/games/${gameId}/templates`),
  async uploadMapTemplate(
    gameId: string,
    file: File,
    meta: { name: string; gridSize: number; cols: number; rows: number },
  ): Promise<MapTemplateSummary> {
    const fd = new FormData();
    fd.append('image', file);
    fd.append('name', meta.name);
    fd.append('gridSize', String(meta.gridSize));
    fd.append('cols', String(meta.cols));
    fd.append('rows', String(meta.rows));
    const token = getToken();
    const res = await fetch(BASE + `/api/games/${gameId}/templates`, {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: fd,
    });
    if (!res.ok) {
      let msg = res.statusText;
      try {
        const b = (await res.json()) as { error?: string };
        if (b.error) msg = b.error;
      } catch {
        /* non-JSON */
      }
      throw new ApiError(res.status, msg);
    }
    return (await res.json()) as MapTemplateSummary;
  },
  listCampaigns: () => req<CampaignSummary[]>('/api/campaigns'),
  createCampaign: (body: CreateCampaignRequest) =>
    req<CampaignDetail>('/api/campaigns', { method: 'POST', body: JSON.stringify(body) }),
  joinCampaign: (id: string, joinCode?: string) =>
    req<CampaignDetail>(`/api/campaigns/${id}/join`, {
      method: 'POST',
      body: JSON.stringify({ joinCode }),
    }),
  getCampaign: (id: string) => req<CampaignDetail>(`/api/campaigns/${id}`),
  startSession: (campaignId: string) =>
    req<{ status: CampaignStatus }>(`/api/campaigns/${campaignId}/start`, { method: 'POST' }),
  endSession: (campaignId: string) =>
    req<{ status: CampaignStatus }>(`/api/campaigns/${campaignId}/end`, { method: 'POST' }),
  completeCampaign: (campaignId: string) =>
    req<{ status: CampaignStatus }>(`/api/campaigns/${campaignId}/complete`, { method: 'POST' }),
  listMaps: (campaignId: string) => req<MapSummary[]>(`/api/campaigns/${campaignId}/maps`),
  // Multipart upload: separate from req() (which forces JSON). No content-type
  // header, so the browser sets the multipart boundary.
  async uploadMap(
    campaignId: string,
    file: File,
    meta: { name: string; gridSize: number; cols: number; rows: number },
  ): Promise<MapSummary> {
    const fd = new FormData();
    fd.append('image', file);
    fd.append('name', meta.name);
    fd.append('gridSize', String(meta.gridSize));
    fd.append('cols', String(meta.cols));
    fd.append('rows', String(meta.rows));
    const token = getToken();
    const res = await fetch(BASE + `/api/campaigns/${campaignId}/maps`, {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: fd,
    });
    if (!res.ok) {
      let msg = res.statusText;
      try {
        const b = (await res.json()) as { error?: string };
        if (b.error) msg = b.error;
      } catch {
        /* non-JSON */
      }
      throw new ApiError(res.status, msg);
    }
    return (await res.json()) as MapSummary;
  },
};
