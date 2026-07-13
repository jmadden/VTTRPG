// REST client for the /api auth + lobby routes. Owns the bearer token
// (localStorage). Base URL mirrors socket.ts: same-origin in prod, :4000 in dev.
import type {
  AuthResponse,
  AuthUser,
  CampaignDetail,
  CampaignSummary,
} from '@vtt/shared';

const BASE =
  import.meta.env.VITE_SERVER_URL || (import.meta.env.DEV ? 'http://localhost:4000' : '');

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
  listCampaigns: () => req<CampaignSummary[]>('/api/campaigns'),
  createCampaign: (name: string, joinCode?: string) =>
    req<CampaignDetail>('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({ name, joinCode }),
    }),
  joinCampaign: (id: string, joinCode?: string) =>
    req<CampaignDetail>(`/api/campaigns/${id}/join`, {
      method: 'POST',
      body: JSON.stringify({ joinCode }),
    }),
  getCampaign: (id: string) => req<CampaignDetail>(`/api/campaigns/${id}`),
};
