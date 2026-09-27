import type { ApiEnvelope } from "./envelope.js";

export type { ApiEnvelope };

export type PlatformId
  = | "OB"
    | "RAY"
    | "TF"
    | "IA"
    | "SABA"
    | "PB"
    | "IM"
    | "IMT"
    | "HG"
    | "Stake"
    | "XBet"
    | "Dex"
    | "Polymarket"
    | "Limitless"
    | "SXBet"
    | "Azuro"
    | "PredictFun";

export interface LoginInfo {
  token: string;
  refreshToken?: string;
  /** [changmen 扩展] cookie 表示 refresh 会话已迁入 HttpOnly Cookie。 */
  sessionMode?: "legacy" | "cookie";
  userName: string;
  ID: number;
}

export interface UserInfo {
  ID: number;
  UserName: string;
  Setting: Record<string, unknown>;
  CreditPlateUserName?: string;
  IsAdmin?: boolean | 0 | 1;
  Role?: "admin" | "leader" | "user";
  TeamId?: string | null;
  /** [changmen 扩展] 当前用户 Market hub HTTP origin（无尾斜杠） */
  MarketHubOrigin?: string;
}

export interface ObGameOddTypeSpec {
  full: string;
  map: string;
}

/** [changmen 扩展] VPS predictfun-collector 写入，浏览器 WS 订阅用 */
export interface PredictFunMarketIndexEntry {
  sourceMatchId: string;
  categoryId: string;
  homeMarketId: string;
  awayMarketId: string;
  homeTokenId: string;
  awayTokenId: string;
  sourceBetId: string;
  /** 0=全场；Game N → N */
  map?: number;
  homeName: string;
  awayName: string;
  homeOdds: number;
  awayOdds: number;
  status: string;
  /**
   * 官方 orderbook Yes 侧对应的 onChainId（单盘双 outcome 时用于拆主客买价）。
   * 双盘（每队一 market）可省略：各盘 Yes = 该队 token。
   */
  yesTokenId?: string;
  /** 官方 getComplement 精度；缺省按 2 */
  decimalPrecision?: number;
  /** CLOB 买价种子（0~1），对齐 PM homeClobPrice；浏览器 Index 变更时种子 fo */
  homeClobPrice?: number;
  awayClobPrice?: number;
}

/** [changmen 扩展] predictfun_market_index.json */
export interface PredictFunMarketIndex {
  updatedAt: number;
  marketIds: string[];
  entries: PredictFunMarketIndexEntry[];
}

/** [changmen 扩展] 地图/全场市场胜负（以 PM 为准） */
export type PolymarketMapOutcomeSide = "home" | "away";
export type PolymarketMapOutcomeKind = "official" | "price";

/** [changmen 扩展] VPS polymarket-esports-collector 写入，浏览器 WS 订阅用 */
export interface PolymarketMarketIndexEntry {
  sourceMatchId: string;
  marketId: string;
  homeTokenId: string;
  awayTokenId: string;
  sourceBetId: string;
  map: number;
  homeName: string;
  awayName: string;
  homeOdds: number;
  awayOdds: number;
  status: string;
  /** CLOB 概率价，供浏览器种子写 fo / 预检 */
  homeClobPrice?: number;
  awayClobPrice?: number;
  /**
   * [changmen 扩展] 开赛时间 epoch ms（软保留 / 漏抓回填用）
   */
  startTime?: number;
  /**
   * [changmen 扩展] 该市场胜负（home/away 相对 Index 的 homeToken/awayToken）。
   * official = tokens[].winner；price = outcomePrices ≥ 0.99。
   */
  mapOutcome?: PolymarketMapOutcomeSide;
  outcomeKind?: PolymarketMapOutcomeKind;
  /** Gamma Event/Market.resolutionSource（直播/裁定来源 URL） */
  resolutionSource?: string;
  /** Gamma event.slug（与 sourceMatchId=event.id 并存，供 Matchs 别名查找） */
  eventSlug?: string;
}

/** [changmen 扩展] polymarket_market_index.json */
export interface PolymarketMarketIndex {
  updatedAt: number;
  assetIds: string[];
  entries: PolymarketMarketIndexEntry[];
}

/** [changmen 扩展] VPS sxbet-collector 写入，浏览器 Centrifugo → fo */
export interface SxBetMarketIndexEntry {
  sourceMatchId: string;
  marketHash: string;
  homeOddsId: string;
  awayOddsId: string;
  sourceBetId: string;
  homeName: string;
  awayName: string;
  homeOdds: number;
  awayOdds: number;
  status: string;
  /** epoch ms */
  startTime?: number;
  gameId?: string;
}

/** [changmen 扩展] sxbet_market_index.json */
export interface SxBetMarketIndex {
  updatedAt: number;
  marketHashes: string[];
  entries: SxBetMarketIndexEntry[];
}

export interface CollectPlatformInfo {
  Gateway: string;
  Token: string;
  BetName: string;
  GameOddTypes?: Record<string, ObGameOddTypeSpec>;
  /** [changmen 扩展] PM / PF / SXBet VPS 采集索引（按 provider 区分形状） */
  MarketIndex?: PredictFunMarketIndex | PolymarketMarketIndex | SxBetMarketIndex | null;
}

export interface BetSourceDto {
  Type: PlatformId;
  BetID: string;
  HomeID: string;
  AwayID: string;
  HomeOdds: number;
  AwayOdds: number;
  Status?: string;
  /** [changmen 扩展] 体育 1X2 平局欧赔；电竞路径不使用 */
  DrawOdds?: number;
  /** [changmen 扩展] 体育 OB 平局 oid，供体育 WS 订阅 */
  DrawID?: string;
  /** [changmen 扩展] PredictFun orderbook marketId（与 onChainId HomeID 不同） */
  HomeMarketID?: string;
  AwayMarketID?: string;
  /**
   * [changmen 扩展] PB moneyLine.lineId。
   * A8 GetMatchs 无此字段；旧前端忽略，下注仍走本机 lineCache。
   */
  LineID?: number;
}

export interface BetRowDto {
  ID: number;
  MatchID: number;
  Map: number;
  Name: string;
  HomeID: number;
  HomeName: string;
  AwayID: number;
  AwayName: string;
  Status?: string;
  /** matcher 进行中 OB 无 Map=0 时保留，供 Web 初赔行 */
  InitialHomeOdds?: number;
  InitialAwayOdds?: number;
  /**
   * [changmen 扩展] 体育规范盘口：moneyline | spreads | totals。
   * 电竞路径不使用。
   */
  MarketCode?: string;
  /**
   * [changmen 扩展] 让球/大小球线（相对主队；moneyline 为 null）。
   * 电竞路径不使用。
   */
  Line?: number | null;
  Sources: Record<string, BetSourceDto>;
}

export interface PmSportMapResult {
  map: number;
  winner: "home" | "away" | string;
  winnerName?: string;
}

/** Polymarket Sports WS 快照（client_matches.pm_sport） */
export interface PmSportSnapshot {
  gameId?: number;
  slug?: string;
  leagueAbbreviation?: string;
  homeTeam?: string;
  awayTeam?: string;
  status?: string;
  live?: boolean;
  ended?: boolean;
  period?: string;
  currentMap?: number | null;
  bo?: number;
  scoreRaw?: string;
  mapScore?: { home: number; away: number };
  /** @deprecated 旧快照可能仍有；新写入不再包含 */
  inMapScore?: string | null;
  /** @deprecated 旧快照可能仍有；新写入不再包含 */
  maps?: PmSportMapResult[];
  elapsed?: string;
  finishedTimestamp?: string;
  /** 赛果/直播来源 URL（Gamma resolutionSource） */
  resolutionSource?: string;
  label?: string;
  updatedAt?: number;
}

export interface ClientMatchDto {
  ID: number;
  Title: string;
  Game: string;
  GameID: number;
  StartTime: number;
  BO?: number;
  Round?: number;
  RoundStart?: number;
  Reverse?: PlatformId[];
  Matchs: Record<string, string | number>;
  Bets: BetRowDto[];
  PmSport?: PmSportSnapshot;
  /** [changmen 扩展] 足球浏览器合场：token 子集等猜测合并标记（§3c；猜测场禁入未来 N4 自动下单） */
  MergeGuess?: boolean;
  /** [changmen 扩展] 体育只读盘：场馆原生联赛名（Gamma series 标题，如 "K-league"）；Game 未识别联赛时前端用它分组显示 */
  League?: string;
}

export interface PageResult<T> {
  list: T[];
  total: number;
  pageIndex: number;
  pageSize: number;
  data?: T[];
  RecordCount?: number;
}

export interface OrderRow {
  OrderID?: number;
  Link?: number;
  Type?: PlatformId;
  Match?: string;
  Bet?: string;
  Item?: string;
  Odds?: number;
  BetMoney?: number;
  Money?: number;
  Status?: string;
  CreateAt?: number;
  PlayerID?: number;
  Player?: { Platform?: string; UserName?: string; Status?: string };
  Domain?: "esport" | "sports" | string;
  Sport?: "football" | string;
  Source?: string;
  PodClientId?: string;
  PodPmMatchId?: string;
  Game?: string;
  PmTokenId?: string;
  PmConditionId?: string;
  PmSide?: "buy" | "sell";
  PfSide?: "buy" | "sell";
}

export interface MoneyLogRow {
  logId?: number;
  ID?: number;
  Id?: number;
  playerId?: number;
  PlayerID?: number;
  Money?: number;
  money?: number;
  Type?: string;
  type?: string;
  Currency?: string;
  currency?: string;
  Description?: string;
  description?: string;
  Remark?: string;
  IsAuto?: number;
  isAuto?: number;
  CreateAt?: number;
  createAt?: number;
}

export interface UserProfitRow {
  UserID: number;
  UserName: string;
  Money: number;
  Count?: number;
  BetMoney?: number;
  Date?: string;
}

export interface TagPlatformRow {
  ID?: number;
  Id?: number;
  Name?: string;
  Platform?: string;
}

export interface PlayerOrderRow {
  OrderID?: number;
  PlayerID?: number;
  Match?: string;
  Bet?: string;
  Odds?: number;
  BetMoney?: number;
  Status?: string;
}

export interface UserListRow {
  Id?: number;
  UserID?: number;
  userId?: number;
  UserName?: string;
  userName?: string;
  isOnline?: number;
  Setting?: Record<string, unknown>;
}

export interface ChatMessageRow {
  ID?: number;
  Id?: number;
  User?: string;
  Content?: string;
  Time?: number;
  content?: string;
  UserName?: string;
  userName?: string;
  CreateAt?: number;
}
