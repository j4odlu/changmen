import type { PlatformId } from "@changmen/api-contract";

export interface CollectTeamDto {
  Type: PlatformId;
  TeamID: string | number;
  Name: string;
  GameID: string | number;
  Logo?: string;
}

export interface CollectMatchDto {
  Type: PlatformId;
  SourceMatchID: string | number;
  SourceGameID: string | number;
  StartTime: number;
  BO?: number;
  HomeID: string | number;
  Home: string;
  AwayID: string | number;
  Away: string;
  Teams: CollectTeamDto[];
  /** OB game/index 的 is_live：1 未开赛，2 进行中 */
  IsLive?: number;
  /** [changmen 扩展] PB euro/odds rotNum：对阵归组键；SourceMatchID 仍为 event.id */
  RotNum?: string;
}

export interface CollectBetDto {
  Type: PlatformId;
  SourceMatchID: string | number;
  SourceBetID: string | number;
  Map: number;
  BetName: string;
  SourceHomeID: string | number;
  HomeName: string;
  HomeOdds: number;
  SourceAwayID: string | number;
  AwayName: string;
  AwayOdds: number;
  Status: "Normal" | "Locked" | string;
  /**
   * [changmen 扩展] PB euro/odds moneyLine.lineId。
   * A8 SaveBet 无此字段；旧前端忽略，仍用本机 lineCache。
   */
  LineID?: number;
}

export interface CollectConfigDto extends Record<string, unknown> {
  log: boolean;
  collect: [PlatformId, boolean][];
}
