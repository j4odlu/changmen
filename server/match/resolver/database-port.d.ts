/** Typed public operations used from the JavaScript DB workspace. */
declare module "@changmen/db" {
  export function fetchAllCanonicalTeams(): Promise<import("./types.ts").CanonicalTeamRow[]>;
  export function fetchAllTeamProviderIds(): Promise<import("./types.ts").TeamProviderRow[] | null | undefined>;
  export function fetchAllTeamPlatformMaps(): Promise<import("./types.ts").TeamPlatformRow[]>;
  export function saveTeamMappingFireAndForget(row: import("./types.ts").SavedTeamMapping): void;
}
