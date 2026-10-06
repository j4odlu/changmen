import type { BetRowDto, ClientMatchDto, PlatformId, PmSportSnapshot, PmPrematchTokenSnapshot } from "@changmen/api-contract";
import { normalizeEpochMs } from "@changmen/shared/time/match_time";
import { readVenueOdds } from "../bridge/oddsAccess";

export type BetSide = "Home" | "Away";

/** OB 等采集常量（对齐 registry PLATFORMS.HG） */
const HG_PLATFORM: PlatformId = "HG";

export class ViewBetItem {
  type: PlatformId;
  matchId: string;
  betId: string;
  homeId: string;
  awayId: string;
  /** GetMatchs Sources.Status；matcher 聚合 SaveBet 锁盘时 fo 可能滞后 */
  sourceStatus: string;
  fallbackHomeOdds: number;
  fallbackAwayOdds: number;
  /**
   * [changmen 扩展] 体育板盘口 WS 订阅键。
   * PM = CLOB asset（通常同 homeId）；PF = marketId（可与 onChainId homeId 不同）。
   * 电竞路径不使用。
   */
  homeSubscribeId = "";
  awaySubscribeId = "";
  /**
   * [changmen 扩展] 体育 1X2 平局；电竞路径保持 0，BetRow 不展示第三格。
   */
  fallbackDrawOdds = 0;
  drawSubscribeId = "";
  /**
   * [changmen 扩展] PB Sources.LineID（moneyLine.lineId）。
   * 旧 GetMatchs 无此字段时为 0；下注回退本机 lineCache。
   */
  lineId = 0;

  constructor(source: BetRowDto["Sources"][string], providerMatchId: string) {
    this.type = source.Type;
    this.matchId = providerMatchId;
    this.betId = source.BetID;
    this.homeId = source.HomeID;
    this.awayId = source.AwayID;
    this.sourceStatus = String(source.Status ?? "Normal");
    this.lineId = Number(source.LineID) || 0;
    // [A8 可证实] HG 用 Sources 作 fallback；其它馆默认 0，只信 fo。
    // PredictFun 与 PM 同构：电竞不信 GetMatchs Sources 赔率；仍解析 MarketID 供订盘/下单。
    if (source.Type === HG_PLATFORM) {
      this.fallbackHomeOdds = Number(source.HomeOdds) || 0;
      this.fallbackAwayOdds = Number(source.AwayOdds) || 0;
    }
    else {
      this.fallbackHomeOdds = 0;
      this.fallbackAwayOdds = 0;
    }
    if (source.Type === "PredictFun") {
      this.homeSubscribeId = String(source.HomeMarketID ?? "").trim();
      this.awaySubscribeId = String(source.AwayMarketID ?? "").trim();
    }
  }

  getItemId(side: BetSide) {
    return side === "Home" ? this.homeId : this.awayId;
  }

  getOdds(side: BetSide) {
    const fallback = side === "Home" ? this.fallbackHomeOdds : this.fallbackAwayOdds;
    return readVenueOdds(this.type, this.getItemId(side), fallback);
  }

  /** 对齐 A8 `FQ.updateOdds`：把 fo 当前值写回 fallback，供 maxOdds 等使用 */
  updateOdds() {
    const home = this.getOdds("Home");
    const away = this.getOdds("Away");
    if (home === this.fallbackHomeOdds && away === this.fallbackAwayOdds)
      return;
    this.fallbackHomeOdds = home;
    this.fallbackAwayOdds = away;
  }
}

export class ViewBet {
  id: number;
  homeName: string;
  awayName: string;
  name: string;
  round: number;
  items: ViewBetItem[];
  initialHomeOdds: number;
  initialAwayOdds: number;
  isLive?: boolean;
  startTime?: number;
  /** [changmen 扩展] 体育规范盘口 */
  marketCode?: string;
  /** [changmen 扩展] 让球/大小线 */
  line?: number | null;

  constructor(row: BetRowDto, providers: Record<string, string | number>, liveRound: number, roundStart: number) {
    this.id = row.ID;
    this.homeName = row.HomeName;
    this.awayName = row.AwayName;
    this.name = row.Name;
    this.round = row.Map;
    this.marketCode = row.MarketCode;
    this.line = row.Line ?? null;
    this.initialHomeOdds = Number(row.InitialHomeOdds) || 0;
    this.initialAwayOdds = Number(row.InitialAwayOdds) || 0;
    if (liveRound !== 0 && liveRound === this.round) {
      this.isLive = true;
      this.startTime = roundStart > 0 ? roundStart : Date.now();
    }
    // Sources 的 key 即场馆 ID；Type 缺省时（如棒球 MVP 旧缓存）仍要用 key，否则 PlatformIcon 无 .Polymarket 等 class，只剩黑圆圈
    this.items = Object.entries(row.Sources ?? {}).map(([key, s]) => {
      const type = (s.Type || key) as PlatformId;
      return new ViewBetItem(
        { ...s, Type: type },
        String(providers[type] ?? ""),
      );
    });
  }

  getBetName(): string {
    // [changmen 扩展] 仅体育盘带 MarketCode；电竞 Bets.Name 是平台原文，不得由此改写标题
    if (this.marketCode) {
      if (this.name)
        return this.name;
      if (this.marketCode === "spreads")
        return this.line != null ? `让球 ${this.line}` : "让球";
      if (this.marketCode === "totals")
        return this.line != null ? `大小 ${this.line}` : "大小球";
      if (this.marketCode === "moneyline")
        return "全场胜负";
    }
    if (this.round === -1)
      return this.name ?? "";
    if (this.round === 0)
      return "全场胜负";
    return `[地图${this.round}] 获胜`;
  }

  maxOdds(side: BetSide): number {
    const fallbackKey = side === "Home" ? "fallbackHomeOdds" : "fallbackAwayOdds";
    let max = 0;
    for (const item of this.items) {
      const v = item[fallbackKey];
      if (v > max)
        max = v;
    }
    return max;
  }

  /** [A8 可证实] bundle `IQ.isBet` 为空实现；GetOrderOptions 不因 noSameBet 在此阶段排除平台 */
  isBetExcludedByNoSameRule(_type: PlatformId, _side: BetSide): boolean {
    return false;
  }
}

export class ViewMatch {
  id: number;
  title: string;
  game: string;
  gameId: number;
  bo: number;
  startAt: number;
  liveRound: number;
  liveRoundStart: number;
  reverse: PlatformId[];
  providers: Record<string, string | number>;
  bets: ViewBet[];
  pmSport?: PmSportSnapshot;
  pmPrematch?: Record<string, PmPrematchTokenSnapshot>;
  /** [changmen 扩展] 场馆原生联赛名；Game 未识别时供前端分组显示 */
  league?: string;

  constructor(dto: ClientMatchDto) {
    this.id = dto.ID;
    this.title = dto.Title;
    this.game = dto.Game;
    this.gameId = dto.GameID;
    this.bo = Number(dto.BO) || 0;
    this.startAt = normalizeEpochMs(dto.StartTime);
    this.reverse = dto.Reverse ?? [];
    this.providers = dto.Matchs ?? {};
    this.liveRound = dto.Round ?? 0;
    this.liveRoundStart = dto.RoundStart ?? 0;
    this.pmSport = dto.PmSport;
    this.pmPrematch = dto.PmPrematch;
    this.league = dto.League;
    this.bets = (dto.Bets ?? [])
      .map(b => new ViewBet(b, this.providers, this.liveRound, this.liveRoundStart))
      .sort((a, b) => a.round - b.round);
  }
}

export function toViewMatches(list: ClientMatchDto[]): ViewMatch[] {
  return list.map(m => new ViewMatch(m));
}
