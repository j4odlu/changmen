/** IDs remain strings or numbers at venue and storage boundaries. */
export type IdentityId = string | number;
export type OptionalIdentityId = IdentityId | null | undefined;
export type PlatformMatchIds = Readonly<Record<string, OptionalIdentityId>>;

export interface TeamKeyContext {
  provider?: string;
  homeId?: OptionalIdentityId;
  awayId?: OptionalIdentityId;
}

export interface TeamLookupMethods {
  lookupByName?(gameCode: string, normalizedName: string): OptionalIdentityId;
  lookupById?(platform: string, platformId: OptionalIdentityId): OptionalIdentityId;
  lookupCanonicalName?(gbTeamId: string): string | null | undefined;
  lookupGameForGbTeamId?(gbTeamId: string): string | null | undefined;
  lookupGbTeamIdByNormalizedName?(normalizedName: string): OptionalIdentityId;
  lookupGbTeamIdByNormalizedNameForGame?(gameCode: string, normalizedName: string): OptionalIdentityId;
  saveMapping?(canonicalId: IdentityId, platform: string, platformId: IdentityId, platformName: unknown, gameCode?: string): void;
}

export type TeamLookupFunction = (gameCode: string, normalizedName: string) => OptionalIdentityId;
/** Both historical function plugins and object plugins share one injected instance. */
export type TeamPlugin = TeamLookupMethods | (TeamLookupFunction & TeamLookupMethods);

export interface CanonicalMatchKey {
  mergeKey: string;
  key: string;
  reversed: boolean;
  basis: "id" | "name" | "legacy";
}

export interface PlatformTeamRow {
  platform?: string;
  Platform?: string;
  home?: unknown;
  away?: unknown;
  Home?: unknown;
  Away?: unknown;
  homeId?: OptionalIdentityId;
  awayId?: OptionalIdentityId;
  HomeID?: OptionalIdentityId;
  AwayID?: OptionalIdentityId;
}

export type PickedPlatformTeamRow<T extends PlatformTeamRow, K extends keyof T = "platform"> =
  Omit<T, "home" | "away" | "platform"> & {
    home: string;
    away: string;
    platform: (K extends keyof T ? T[K] : undefined) | ("platform" extends keyof T ? T["platform"] : undefined);
  };

export interface TeamSideNames {
  platform?: string;
  home: string;
  away: string;
  title: string;
  canonical?: true;
}

export interface CanonicalTeamSideNames extends TeamSideNames {
  canonical: true;
}

export interface TeamNameResolvers {
  lookupGbTeamId(platform: string | undefined, platformId: string): OptionalIdentityId;
  lookupCanonicalName(gbTeamId: IdentityId): string | null | undefined;
}

export interface MatchBetRow {
  ID?: OptionalIdentityId;
  MatchID?: OptionalIdentityId;
  Map?: OptionalIdentityId;
}

export interface IdentityMatchRow {
  ID?: OptionalIdentityId;
  Bets?: readonly MatchBetRow[] | null;
}

export type AssignedMatch<T extends IdentityMatchRow> = Omit<T, "ID" | "Bets"> & {
  ID: number;
  Bets: (Omit<NonNullable<T["Bets"]>[number], "ID" | "MatchID"> & { ID: number; MatchID: number })[];
};

export interface BuiltClientMatch extends IdentityMatchRow {
  MergeKey?: string | null;
  Matchs?: PlatformMatchIds | null;
  Title?: string | null;
  Game?: string | null;
  GameID?: OptionalIdentityId;
  StartTime?: OptionalIdentityId;
  BO?: OptionalIdentityId;
  Round?: OptionalIdentityId;
  RoundStart?: OptionalIdentityId;
}

export interface ClientMatchIndexRow {
  id: IdentityId;
  merge_key?: string | null;
  matchs?: PlatformMatchIds | null;
  ended_at?: unknown;
  endedAt?: unknown;
}

export interface PlatformMatchLink {
  SourceMatchID?: OptionalIdentityId;
  ClientMatchId?: OptionalIdentityId;
  client_match_id?: OptionalIdentityId;
  match_id?: OptionalIdentityId;
}

export type PlatformMatchLinks = Readonly<Record<string, Readonly<Record<string, PlatformMatchLink>>>>;

export interface ClientMatchStub {
  title?: string | null;
  game?: string | null;
  game_id?: OptionalIdentityId;
  start_time?: OptionalIdentityId;
  bo?: OptionalIdentityId;
  round?: OptionalIdentityId;
  round_start?: OptionalIdentityId;
  matchs?: PlatformMatchIds | null;
}

/** The host owns I/O; this package never imports a database implementation. */
export interface ClientMatchIdentityAdapter {
  fetchClientMatchIndex(): Promise<readonly ClientMatchIndexRow[] | null | undefined>;
  insertClientMatchStub(mergeKey: string, stub: ClientMatchStub): Promise<number>;
  findClientMatchIdByMergeKey(mergeKey: string): Promise<OptionalIdentityId>;
}

export interface LinkedClientIdOptions {
  mergeKey?: string | null;
  existingIdKeyIndex?: ReadonlyMap<string, number>;
}

export interface ResolveClientMatchOptions extends LinkedClientIdOptions {
  matches?: PlatformMatchLinks | null;
}
