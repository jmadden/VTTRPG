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

/** A campaign's lifecycle state (docs/12 §4), manually toggled by the GM. */
export type CampaignStatus = 'draft' | 'live' | 'paused' | 'completed';

/** A campaign as shown in the lobby list. */
export interface CampaignSummary {
  id: string;
  name: string;
  gmName: string;
  memberCount: number;
  isMember: boolean;
  isGm: boolean;
  status: CampaignStatus;
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
  status: CampaignStatus;
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

/** Create-campaign request (docs/12 §5): a campaign always belongs to a
 *  Game; `templateIds`/`memberUserIds` are the Map Library/Roster
 *  multi-select on the single-page create form, both optional. */
export interface CreateCampaignRequest {
  gameId: string;
  name: string;
  joinCode?: string;
  templateIds?: string[];
  memberUserIds?: string[];
}

/** Join request: the per-campaign code (required when the campaign sets one). */
export interface JoinCampaignRequest {
  joinCode?: string;
}

// ── games (docs/12) ─────────────────────────────────────────────────────────

/** A Game as shown in the Lobby sidebar. */
export interface GameSummary {
  id: string;
  name: string;
  description?: string;
  campaignCount: number;
  memberCount: number;
  joinCode: string;
}

/** A reusable Map Library entry — never played on directly (see game_maps). */
export interface MapTemplateSummary {
  id: string;
  gameId: string;
  name: string;
  assetPath: string;
  gridType: 'square' | 'hex';
  gridSize: number;
  cols: number;
  rows: number;
}

/** A Game's standing roster member. */
export interface GameMemberDto {
  userId: string;
  displayName: string;
  characterSheetId: string | null;
}

/** A character sheet a roster member could attach (Roster tab dropdown). */
export interface EligibleSheetDto {
  id: string;
  name: string;
}

/** Full Game detail: the Game page's Campaigns/Map Library/Roster tabs. */
export interface GameDetail extends GameSummary {
  campaigns: CampaignSummary[];
  mapTemplates: MapTemplateSummary[];
  members: GameMemberDto[];
}
