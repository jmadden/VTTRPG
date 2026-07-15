// ============================================================================
// api.ts — REST DTOs shared by @vtt/backend and @vtt/frontend.
// The auth/lobby HTTP contract (see docs/09). Socket payloads live in
// contracts.ts; these are the request/response shapes for the /api routes.
// ============================================================================

import type { LiveMapEntry } from './contracts.js';

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
}

/** A member row in the campaign detail. */
export interface CampaignMemberDto {
  id: string;
  displayName: string;
  isGm: boolean;
}

/** A campaign member's current token/map, for the GM's Players Panel. */
export interface MemberTokenDto {
  userId: string;
  tokenId: string;
  mapId: string;
}

/** Full campaign detail: feeds the lobby detail + map entry.
 *  `viewerMapId` / `memberTokens` are computed per-viewer (see getCampaignDetail). */
export interface CampaignDetail {
  id: string;
  name: string;
  gmUserId: string;
  members: CampaignMemberDto[];
  liveMaps: LiveMapEntry[];
  // The map the requesting viewer's own token currently sits on (null if
  // unplaced, or if the viewer is the GM and has no token of their own).
  viewerMapId: string | null;
  // GM-only: every member's current token/map, for the Players Panel. Empty
  // for non-GM viewers.
  memberTokens: MemberTokenDto[];
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
