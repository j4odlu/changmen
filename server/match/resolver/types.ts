import type { IdentityId, OptionalIdentityId, TeamLookupMethods } from "@changmen/match-identity/types";

/** Rows supplied by the DB workspace; resolver owns no SQL or connection pool. */
export interface CanonicalTeamRow {
  id: IdentityId;
  gb_team_id: IdentityId | null;
  game: string | null;
  name: string | null;
  acronym?: string | null;
}
export interface TeamProviderRow {
  team_id: IdentityId;
  provider: string;
  provider_id: IdentityId | null;
  game?: string | null;
}
export interface TeamPlatformRow {
  gb_team_id: IdentityId | null;
  venue: string;
  venue_team_id: OptionalIdentityId;
  venue_name: string | null;
  game?: string | null;
}
export interface SavedTeamMapping {
  gb_team_id: number;
  platform: string;
  venue_team_id: string;
  venue_name: string;
  game: string | null;
  source: "auto";
  confidence: number;
}
export interface TeamResolverPlugin extends Required<TeamLookupMethods> {
  lookupProviderId(teamId: OptionalIdentityId, provider: string): OptionalIdentityId;
}
export interface SportTeamPlugin {
  resolveKey(name: string, gameCode?: string): string;
  pairKey(home: string, away: string, startTimeMs: number, gameCode?: string): string | null;
}
