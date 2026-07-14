// ============================================================================
// api.ts — REST DTOs shared by @vtt/backend and @vtt/frontend.
// The auth/lobby HTTP contract (see docs/09). Socket payloads live in
// contracts.ts; these are the request/response shapes for the /api routes.
// ============================================================================

/** The authenticated user as returned to the client. Never includes pin_hash. */
export interface AuthUser {
  id: string;
  displayName: string;
}

/** register / login response: a bearer token plus the user. */
export interface AuthResponse {
  token: string;
  user: AuthUser;
}

/** register / login request body. PIN is 4-6 digits. */
export interface AuthRequest {
  displayName: string;
  pin: string;
}

/** A campaign as shown in the lobby list. */
export interface CampaignSummary {
  id: string;
  name: string;
  gmName: string;
  memberCount: number;
  isMember: boolean;
  isGm: boolean;
  activeMapId: string | null;
}

/** A member row in the campaign detail. */
export interface CampaignMemberDto {
  id: string;
  displayName: string;
  isGm: boolean;
}

/** Full campaign detail: feeds the lobby detail + map entry. */
export interface CampaignDetail {
  id: string;
  name: string;
  gmUserId: string;
  activeMapId: string | null;
  members: CampaignMemberDto[];
}

/** A map in a campaign's library. */
export interface MapSummary {
  id: string;
  name: string;
  assetPath: string | null;
  gridType: 'square' | 'hex';
  gridSize: number;
  cols: number;
  rows: number;
}

/** Create-campaign request. `joinCode` is optional (nullable gate). */
export interface CreateCampaignRequest {
  name: string;
  joinCode?: string;
}

/** Join request: the per-campaign code (required when the campaign sets one). */
export interface JoinCampaignRequest {
  joinCode?: string;
}
