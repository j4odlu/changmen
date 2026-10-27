import type { OptionalIdentityId } from "@changmen/match-identity/types";

/** 原始比赛快照；字段在归一化时转换，不要求已经具有 Client_GetMatchs 形状。 */
export interface PlatformMatchInput {
  SourceMatchID?: OptionalIdentityId;
  SourceGameID?: OptionalIdentityId;
  GameID?: OptionalIdentityId;
  HomeID?: unknown;
  AwayID?: unknown;
  home_id?: unknown;
  away_id?: unknown;
  SourceHomeID?: unknown;
  SourceAwayID?: unknown;
  Home?: unknown;
  Away?: unknown;
  home?: unknown;
  away?: unknown;
  StartTime?: unknown;
  BO?: unknown;
  ClientMatchId?: OptionalIdentityId;
  client_match_id?: OptionalIdentityId;
  match_id?: OptionalIdentityId;
  RotNum?: unknown;
  rotNum?: unknown;
  rot_num?: unknown;
}

export type PlatformMatchBuckets<T extends PlatformMatchInput = PlatformMatchInput> = Readonly<Record<string,
  Readonly<Record<string, T | null | undefined>> | readonly (T | null | undefined)[] | null | undefined
>>;

export interface PlatformEntry<T extends PlatformMatchInput = PlatformMatchInput> {
  platform: string;
  sourceMatchId: string;
  homeId: string;
  awayId: string;
  homeName: string;
  awayName: string;
  homeGb: string | null;
  awayGb: string | null;
  homeN: string;
  awayN: string;
  startMs: number;
  gameCode: string | null;
  Game: string;
  GameID: string;
  BO: number;
  rotNum: string;
  nativeRow: T;
  rowKey: string;
  clientMatchId: number | null;
}

export type NameKeyEntry = Pick<PlatformEntry, "homeN" | "awayN">;
export type IdKeyEntry = NameKeyEntry & Pick<PlatformEntry, "homeGb" | "awayGb">;
export type PairKeyEntry = Pick<PlatformEntry,
  "platform" | "GameID" | "gameCode" | "homeName" | "awayName" | "homeId" | "awayId" | "homeGb" | "awayGb"
>;
export type NamePairKeyEntry = NameKeyEntry & Pick<PlatformEntry, "GameID" | "gameCode" | "homeName" | "awayName">;

/** 保存的场馆盘口，保留 catalog 使用的额外原始字段。 */
export interface SavedBetInput extends Readonly<Record<string, unknown>> {
  SourceBetID?: OptionalIdentityId;
  SourceHomeID?: OptionalIdentityId;
  SourceAwayID?: OptionalIdentityId;
  HomeOdds?: OptionalIdentityId;
  AwayOdds?: OptionalIdentityId;
  Status?: string | null;
  Map?: OptionalIdentityId;
  MarketID?: OptionalIdentityId;
  LineID?: OptionalIdentityId;
}

export interface SavedBetBucket {
  readonly bets?: readonly SavedBetInput[] | null;
}
export type PlatformBetBuckets = Readonly<Record<string, readonly SavedBetInput[] | SavedBetBucket | null | undefined>>;

/** clone 接受既有的部分 Source，赔率保持原值。 */
export interface RawBetSourceInput {
  Type?: string | null;
  BetID?: OptionalIdentityId;
  HomeID?: OptionalIdentityId;
  AwayID?: OptionalIdentityId;
  HomeOdds?: OptionalIdentityId;
  AwayOdds?: OptionalIdentityId;
  Status?: string | null;
  HomeMarketID?: OptionalIdentityId;
  AwayMarketID?: OptionalIdentityId;
  LineID?: OptionalIdentityId;
}

export interface ClonedBetSource {
  Type: string | null | undefined;
  BetID: string;
  HomeID: string;
  AwayID: string;
  HomeOdds: OptionalIdentityId;
  AwayOdds: OptionalIdentityId;
  Status: string;
  HomeMarketID?: string;
  AwayMarketID?: string;
  LineID?: number;
}

/** 原生盘口归一化后的主客 Source；Type 保留所有场馆字符串。 */
export interface NativeBetSource extends ClonedBetSource {
  Type: string;
  HomeOdds: number;
  AwayOdds: number;
}
