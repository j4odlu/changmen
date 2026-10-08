export interface AdminProfitRow {
  UserID: number;
  UserName: string;
  Money: number;
  Count?: number;
  BetMoney?: number;
  Date?: string;
}

export interface AdminDashboard {
  date: string;
  userCount: number;
  activeUsersToday: number;
  orderCount: number;
  totalMoney: number;
  totalBetMoney: number;
  topProfit: AdminProfitRow[];
}

export interface AdminAccountRateRow {
  minOdds: number;
  maxOdds: number;
  rate: number;
}

export interface AdminAccountGameRow {
  betCount: number;
  profit: number;
  odds: string[];
}

export interface AdminAccountDetail {
  accountId: number;
  platform: string;
  platformId: number;
  platformName: string;
  playerName: string;
  balance: number;
  credit: number;
  currency: string;
  winBalance: number;
  unsettle: number;
  proxyId: number;
  pause: boolean;
  markupOnly: boolean;
  noMarkup: boolean;
  active: boolean;
  minOdds: number;
  maxOdds: number;
  minDefault: number;
  maxDefault: number;
  profit: number;
  maxProfit: number;
  maxBetCount: number;
  maxOrder: number;
  todayOrder: number;
  today: number;
  orderCount: number;
  totalProfit: number;
  maxBalance: number;
  maxWinBalance: number;
  description: string;
  realName: string;
  mobile: string;
  city: string;
  multiply: number;
  maxBalanceOdds: number;
  lastOdds: boolean;
  workTimes: string[];
  rateConfig: AdminAccountRateRow[];
  game: Record<string, AdminAccountGameRow>;
  gateway?: string;
  token?: string;
  referer?: string;
  userAgent?: string;
  cookie?: string;
  gatewayHost: string;
  hasCredentials: boolean;
  updateTime: number;
  /** [changmen 扩展] 场馆会员 ID */
  venueMemberId?: string;
  /** [changmen 扩展] 场馆登录名 */
  venueAccountName?: string;
  /** [changmen 扩展] players.deleted_at；有值即软删 */
  deletedAt?: number | null;
  /** [changmen 扩展] 是否软删 */
  deleted?: boolean;
}

/** 管理端子账号扁平行（含归属用户） */
export interface AdminAccountListRow extends AdminAccountDetail {
  userId: string;
  userName: string;
  teamId?: string | null;
}

export type AdminUserSetting = Record<string, unknown>;

export interface AdminUserConfigDetail {
  user: {
    id: string;
    userName: string;
    role?: "admin" | "leader" | "user" | string;
    teamId?: string | null;
    isAdmin?: boolean;
    isOnline?: number;
    lastActiveAt?: number;
    lastLoginIp?: string;
    lastLoginAt?: number;
    createdAt: number;
    updatedAt: number;
  };
  configs: {
    USERCONFIG: Record<string, unknown>;
    CollectConfig: Record<string, unknown>;
    preferences: Record<string, unknown>;
    extraPreferences: Record<string, unknown>;
    ACCOUNT: Array<Record<string, unknown>>;
  };
  parseErrors: Record<string, string>;
  raw: {
    betting_config: Record<string, unknown>;
    collect_config: Record<string, unknown>;
    preferences: Record<string, unknown>;
  };
}

export interface AdminUserRow {
  id: string;
  userName: string;
  isAdmin?: boolean;
  role?: "admin" | "leader" | "user";
  teamId?: string | null;
  isOnline?: number;
  lastActiveAt?: number;
  lastLoginIp?: string;
  lastLoginAt?: number;
  bettingEnabled?: number;
  bettingScheduled?: number;
  bettingAutoOpenTime?: number;
  betMoney?: number;
  frozen?: number;
  frozenAt?: number;
  accountCount: number;
  accounts: AdminAccountDetail[];
  setting: AdminUserSetting;
  createdAt: number;
  updatedAt: number;
  todayMoney: number;
  todayCount: number;
  todayBetMoney: number;
}

export interface AdminOrderRow {
  id: number;
  userId: string;
  playerId: number;
  orderId: string;
  linkId: number;
  provider: string;
  match: string;
  bet: string;
  item: string;
  odds: number;
  betMoney: number;
  money: number;
  status: string;
  createAt: number;
  /** [changmen 扩展] 订单业务域；sports/football 表示足球订单存放在 orders。 */
  domain?: string;
  /** [changmen 扩展] 体育运动类型。 */
  sport?: string;
  /** [changmen 扩展] 订单来源。 */
  source?: string;
  /** [changmen 扩展] 原始游戏/运动码。 */
  game?: string;
  /** 历史订单回填：players.player_name（含已删账号） */
  playerName?: string;
  /** 历史订单回填：players.platform_name */
  platformName?: string;
  /** 历史订单回填：account_data.venueAccountName */
  venueAccountName?: string;
  /** 对应 players 已 soft-delete */
  playerDeleted?: boolean;
  matchId?: number;
  matchKey?: string;
  matchLabel?: string;
  /** 开赛时间 ms，来自 client_matches 或订单 raw */
  matchStartTime?: number;
  /** [changmen 扩展] Polymarket — 与工作台 rowToOrder / OrderRow.Pm* 对齐 */
  pmTokenId?: string;
  pmShares?: number;
  pmFillPrice?: number;
  pmStakeUsdc?: number;
  pmFeeUsdc?: number;
  pmConditionId?: string;
  pmOrigin?: "changmen" | "external";
  pmAttributedSellShares?: number;
  pmRealizedPnlUsdc?: number;
  /** 买单累计卖出回款 USDC（对标 pfSellProceeds；旧单可能缺失） */
  pmSellProceeds?: number;
  pmLastSellOrderId?: string;
  pmSellState?: "open" | "partial" | "closed" | "settled";
  pmSide?: "buy" | "sell";
  pmBuyOrderId?: string;
  /** [changmen 扩展] PredictFun — 与工作台 OrderRow.Pf* 对齐 */
  pfSide?: "buy" | "sell";
  pfBuyOrderId?: string;
  pfSellState?: "open" | "closed" | "settled";
  pfShares?: number;
  /** 用户持仓（官网成交 − 官网份额费 − Changmencodefee） */
  pfHoldShares?: number;
  /** 名义买入 USDT（限价×份额）；与 betMoney 实付区分 */
  pfNotionalUsdt?: number;
  /** 链上实付成交额 */
  pfFillCostUsdt?: number;
  /** 买入限价/盘口价 (0,1) */
  pfBookPrice?: number;
  pfTokenId?: string;
  pfMarketId?: string;
  /** 买单关联卖单 orderId */
  pfSellOrderId?: string;
  /** 卖出回款 USDT（官网回款 − 官网费 − Changmencodefee；卖单 betMoney 为镜像） */
  pfSellProceeds?: number;
  /** [changmen 扩展] PredictFun wallet 实扣手续费（明细；用户端展示不依赖） */
  pfFeeAmountWei?: string;
  pfFeeType?: "COLLATERAL" | "SHARES";
  pfFeeUsdt?: number;
  /** [changmen 扩展] PredictFun 官方市场 feeRateBps */
  pfFeeRateBps?: number;
  /** Changmencodefee 费率 bps（买扣份额 / 卖扣 USDT 各自落在对应单上） */
  pfChangmenCodeFeeRateBps?: number;
  /** Changmencodefee 买入扣份额 */
  pfChangmenCodeFeeShares?: number;
  /** Changmencodefee 卖出扣 USDT */
  pfChangmenCodeFeeUsdt?: number;
  /** [changmen 扩展] Phase 1 仓位卖出事件（买单；观察双写） */
  positionEvents?: {
    sells?: Array<{
      id: string;
      at?: number;
      shares?: number;
      price?: number;
      proceeds?: number;
      pnl?: number;
      origin?: "changmen" | "external";
      status?: string;
    }>;
  };
}

export interface AdminOrderPage {
  date: string;
  list: AdminOrderRow[];
  /** SQL create_at 当日条数（翻页用；与 enrich 后 list.length 可能不同） */
  total: number;
  pageIndex: number;
  pageSize: number;
  /** 是否还有下一页 SQL 行；enrich 整页滤空时仍可能为 true */
  hasMore?: boolean;
}

export interface AdminOrderMatrix {
  date: string;
  list: AdminOrderRow[];
  total: number;
}

export interface AdminOrderLogEntry {
  id?: number;
  createAt: number;
  title: string;
  kind: "check" | "bet" | "reject" | "other" | string;
  provider?: string | null;
  orderId?: string | null;
  matchedOrderId?: string | null;
  linkId?: number | null;
  attemptType?: "initial" | "retry" | "makeup" | "makeup_queue" | "makeup_cancel" | string | null;
  target?: "Home" | "Away" | string | null;
  accountLabel?: string | null;
  loseOrder?: boolean;
  match?: string | null;
  bet?: string | null;
  item?: string | null;
  odds?: number | null;
  newOdds?: number | null;
  betMoney?: number | null;
  planBetMoney?: number | null;
  stakeExchange?: number | null;
  stakeRate?: number | null;
  stakeCurrency?: string | null;
  itemId?: string | null;
  matchId?: string | number | null;
  betId?: string | number | null;
  success?: boolean | null;
  message?: string | null;
  checkError?: string | null;
  requestAmount?: number | null;
  requestOdds?: number | null;
  related?: boolean;
  relationScore?: number;
  relationReason?: string;
  placedAt?: number | null;
  observedAt?: number | null;
  rejectDelayMs?: number | null;
  settlement?: "filled" | "unfilled" | "timeout" | string | null;
  observedStatus?: string | null;
  rejectReason?: string | null;
  failedLegOdds?: number | null;
  failedPlatformLabel?: string | null;
  summary: string;
}

export interface AdminOrderLogStats {
  total: number;
  related: number;
  unrelated: number;
  truncated: boolean;
  limit: number;
}

export interface AdminOrderLogLogSegment {
  key: string;
  accountLabel: string | null;
  provider: string | null;
  isMakeUp: boolean;
  logs: AdminOrderLogEntry[];
}

export interface AdminOrderLogPlatform {
  provider: string | null;
  label: string;
  orders: AdminOrderLogOrder[];
  logs: AdminOrderLogEntry[];
}

export interface AdminOrderLogAttempt {
  key: string;
  order: AdminOrderLogOrder | null;
  logs: AdminOrderLogEntry[];
  logSegments?: AdminOrderLogLogSegment[];
}

export interface AdminOrderLogLegSection {
  key: string;
  legIndex: number;
  side: "Home" | "Away" | string;
  label: string;
  provider: string | null;
  attempts: AdminOrderLogAttempt[];
}

export interface AdminOrderLogOrderSection {
  key: string;
  label: string;
  order: AdminOrderLogOrder | null;
  logs: AdminOrderLogEntry[];
}

export interface AdminOrderLogOrder {
  orderId: string;
  link: number;
  provider: string;
  playerId: number | string;
  match: string;
  bet: string;
  item: string;
  odds: number;
  betMoney: number;
  money: number;
  status: string;
  createAt: number;
  pfSide?: "buy" | "sell";
  pmSide?: "buy" | "sell";
  /** 仓位累计卖出回款（买单；USDC/USDT） */
  pmSellProceeds?: number;
  pfSellProceeds?: number;
  /** Phase 1 减仓事件（写在买单） */
  positionEvents?: {
    sells?: Array<{
      id: string;
      at?: number;
      shares?: number;
      price?: number;
      proceeds?: number;
      pnl?: number;
      origin?: "changmen" | "external";
      status?: string;
    }>;
  };
}

export interface AdminOrderLogLookup {
  diagnosticSource?: "events" | "legacy";
  legacyLogsLoaded?: boolean;
  ordersQueried?: boolean;
  /** [changmen 扩展] 只读执行记录，默认优先于旧日志重建。 */
  observation?: {
    mode: "shadow";
    status: "available" | "unavailable";
    truncated: boolean;
    issues: string[];
    events: import("@changmen/shared/order_observation").OrderObservationEvent[];
    attempts: Array<{ attemptId: string; findings: string[]; evidence: string; events: import("@changmen/shared/order_observation").OrderObservationEvent[];
      confirmation?: { label: string; basis: string; proof: import("@changmen/shared/order_progress_evidence").ProgressProof };
      progress?: Partial<Record<"precheck" | "submission" | "binding", { label: string; proof: import("@changmen/shared/order_progress_evidence").ProgressProof }>> }>;
    queues?: Array<{ queueId: string; findings: string[] }>;
  };
  user: { id: string; userName: string };
  anchor: { type: string; value: string | number };
  link: number;
  linkType: string;
  groupLabel: string;
  logWindow: { fromMs: number; toMs: number };
  orders: AdminOrderLogOrder[];
  logs: AdminOrderLogEntry[];
  unrelatedLogs?: AdminOrderLogEntry[];
  logStats?: AdminOrderLogStats;
  platforms?: AdminOrderLogPlatform[];
  orderSections?: AdminOrderLogOrderSection[];
  legSections?: AdminOrderLogLegSection[];
}

/** 管理端「订单和用户维护」诊断 */
export interface AdminMaintenancePlayerRow {
  playerId: number;
  userId: string;
  userName: string;
  platformName: string;
  playerName: string;
  /** 场馆会员 ID（共用判定依据） */
  venueMemberId: string;
  venueAccountName?: string;
  deleted: boolean;
  createdAt: number;
  deletedAt: number | null;
  orderCount: number;
}

export interface AdminMaintenanceSharedVenue {
  venueAccountKey: string;
  provider: string;
  venueMemberId: string;
  users: string[];
  activeUsers: string[];
  bothActive: boolean;
  players: AdminMaintenancePlayerRow[];
  suggestion: string;
}

export interface AdminMaintenanceOrderDupRow {
  id: number;
  userId: string;
  userName: string;
  playerId: number;
  provider: string;
  status: string;
  money: number;
}

export interface AdminMaintenanceOrderDup {
  kind: "same_user" | "cross_user";
  orderId: string;
  users: string[];
  userIds: string[];
  count: number;
  day: string;
  createAt: number;
  rows: AdminMaintenanceOrderDupRow[];
  suggestion: string;
}

export interface AdminMaintenanceReport {
  generatedAt: number;
  tips: string[];
  sharedVenueAccounts: {
    generatedAt: number;
    total: number;
    bothActive: number;
    list: AdminMaintenanceSharedVenue[];
  };
  duplicateOrderIds: {
    generatedAt: number;
    sameUserTotal: number;
    crossUserTotal: number;
    byPair: Record<string, number>;
    byDay: Record<string, number>;
    sameUser: AdminMaintenanceOrderDup[];
    crossUser: AdminMaintenanceOrderDup[];
  };
}
