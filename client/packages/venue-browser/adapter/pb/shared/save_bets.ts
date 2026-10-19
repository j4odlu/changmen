export interface PbStageSnapshot {
  stageId: number;
  winHome: number;
  winAway: number;
  winHomeId: string;
  winAwayId: string;
  winMarketId: string;
  /** euro/odds moneyLine.lineId；写入 SaveBet.LineID */
  winLineId?: number;
  winLocked: boolean;
  betName: string;
}

export interface PbMatchSnapshot {
  matchId: string;
  home: { name: string };
  away: { name: string };
  stages: PbStageSnapshot[];
}

export interface PbSaveBetRow {
  Type: string;
  SourceMatchID: string;
  SourceBetID: string;
  Map: number;
  BetName: string;
  SourceHomeID: string;
  HomeName: string;
  HomeOdds: number;
  SourceAwayID: string;
  AwayName: string;
  AwayOdds: number;
  Status: string;
  /** [changmen 扩展] 见 CollectBetDto.LineID */
  LineID?: number;
}

export interface PbFoOddEntry {
  id: string;
  odds: number;
  isLock: boolean;
  betId: string;
}

/** Ingest：单 stage moneyLine → fo 写入条目 */
export function listPbStageFoEntries(stage: PbStageSnapshot): PbFoOddEntry[] {
  return [
    {
      id: stage.winHomeId,
      odds: stage.winHome,
      isLock: stage.winLocked,
      betId: stage.winMarketId,
    },
    {
      id: stage.winAwayId,
      odds: stage.winAway,
      isLock: stage.winLocked,
      betId: stage.winMarketId,
    },
  ];
}

/** Report：单 stage → A8 SaveBet 行 */
export function pbStageToSaveBetRow(
  match: PbMatchSnapshot,
  stage: PbStageSnapshot,
  platform = "PB",
): PbSaveBetRow {
  const lineId = Number(stage.winLineId) || 0;
  return {
    Type: platform,
    SourceMatchID: match.matchId,
    SourceBetID: stage.winMarketId,
    Map: stage.stageId,
    BetName: stage.betName,
    SourceHomeID: stage.winHomeId,
    HomeName: match.home.name,
    HomeOdds: stage.winHome,
    SourceAwayID: stage.winAwayId,
    AwayName: match.away.name,
    AwayOdds: stage.winAway,
    Status: stage.winLocked ? "Locked" : "Normal",
    ...(lineId > 0 ? { LineID: lineId } : {}),
  };
}

/** Report：整场比赛 stages → SaveBet 行列表 */
export function buildPbSaveBetRowsFromMatch(
  match: PbMatchSnapshot,
  platform = "PB",
): PbSaveBetRow[] {
  return match.stages.map((stage) => pbStageToSaveBetRow(match, stage, platform));
}
