import type { PlatformId } from "@changmen/api-contract";
import type { BetOption } from "@changmen/client-core/models/betOption";
import type { BetResult } from "@changmen/client-core/models/betResult";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";

export interface AccountBalanceResult {
  balance: number;
  currency?: string;
  /** [changmen 扩展] 场馆会员 ID（如 OB balance.uid） */
  venueMemberId?: string;
  /** [changmen 扩展] 场馆登录名（如 OB balance.account） */
  venueAccountName?: string;
}

/** 对齐 A8 场馆订单 `Yt.*` 状态 */
export type VenueOrderStatus = "none" | "pending" | "reject" | "return" | "win" | "lose";

/** [changmen 扩展] Polymarket 持仓；其它场馆 getOrders 不填 */
export type PolymarketOrderOrigin = "changmen" | "external";

/** 逻辑持仓：changmen 按行卖出归因 */
export type PolymarketSellState = "open" | "partial" | "closed" | "settled";

/** 买单 vs 平仓卖单（各一条 VenueOrder） */
export type PolymarketOrderSide = "buy" | "sell";

export interface PolymarketVenueOrderExtras {
  pmTokenId?: string;
  pmShares?: number;
  /**
   * 买单展示均价（0–1）：官网 activity.price / CLOB 撮合均价（不含手续费）。
   */
  pmFillPrice?: number;
  /**
   * 买单成本 USDC：优先官网 activity.usdcSize（含费）；否则名义+公式 fee。
   * 剩余敞口随卖出扣减。
   */
  pmStakeUsdc?: number;
  pmSubmission?: import("@changmen/shared/pm_submission").PmSubmission;
  /** [changmen 扩展] 手续费 USDC：优先 usdcSize−price×size；否则公式回退 */
  pmFeeUsdc?: number;
  /** CLOB condition_id，User WS 订阅与卖出 delayed 检测 */
  pmConditionId?: string;
  /** changmen 站内下单 vs 官网同步 */
  pmOrigin?: PolymarketOrderOrigin;
  /** 本行 changmen 卖出累计份数 */
  pmAttributedSellShares?: number;
  pmRealizedPnlUsdc?: number;
  /**
   * [changmen 扩展] 买单累计卖出回款 USDC（对标 PF `pfSellProceeds`）。
   * 经济真相在买单；卖单 betMoney 仍为 CNY 展示镜像，勿当本金。
   */
  pmSellProceeds?: number;
  /** 最近一笔 changmen 卖单 orderId（可选） */
  pmLastSellOrderId?: string;
  pmSellState?: PolymarketSellState;
  /** buy=买入持仓；sell=平仓成交 */
  pmSide?: PolymarketOrderSide;
  /** 卖单对应买单 orderId */
  pmBuyOrderId?: string;
  /**
   * [changmen 扩展] 市场赛果（持有到期视角）：win/lose。
   * 与 status/money 脱钩——中途卖光仍可写入，供策略分析，不影响卖出盈亏统计。
   */
  pmMatchResult?: "win" | "lose";
  /**
   * [changmen 扩展] 执行下单后未成交落库用：
   * - unfilled：已受理后 FOK/取消
   * - api_failed：已调 betting 但未成交（常无官方 orderId）
   */
  pmRejectReason?: "unfilled" | "api_failed";
  /**
   * [changmen 扩展] 拒单金额单位已对齐（U→CNY）标记；回填脚本幂等用。
   */
  pmRejectMoneyFixedAt?: number;
  /**
   * [changmen 扩展] Phase 1 仓位卖出事件（写在买单上；服务端按 id 幂等合并）。
   * 盈亏权威仍为 pmSellProceeds / money 等聚合字段。
   */
  positionEvents?: {
    sells?: Array<{
      id: string;
      at?: number;
      shares?: number;
      price?: number;
      proceeds?: number;
      pnl?: number;
      origin?: PolymarketOrderOrigin;
      status?: string;
    }>;
  };
}

/** [changmen 扩展] PredictFun house 1:1 买卖（会员账号仅归属，仓位共用主号） */
export type PredictFunOrderSide = "buy" | "sell";
export type PredictFunSellState = "open" | "closing" | "closed" | "settled";

export interface PredictFunVenueOrderExtras {
  pfSide?: PredictFunOrderSide;
  pfBuyOrderId?: string;
  pfSellState?: PredictFunSellState;
  pfShares?: number;
  /** 官网持仓口径（VPS 写库；成交 − SHARES 手续费） */
  pfHoldShares?: number;
  /**
   * 名义买入 USDT（限价×份额）；与用户扣款 betMoney 对齐。
   * 链上实付 / 官网 fee 仅服务端与管理端可见，不下发用户 API。
   */
  pfNotionalUsdt?: number;
  /** @deprecated 用户 API 不再下发；管理端仍可读 */
  pfFillCostUsdt?: number;
  /** 买入限价/盘口价 (0,1) */
  pfBookPrice?: number;
  pfTokenId?: string;
  pfMarketId?: string;
  /** @deprecated 用户 API 不再下发；管理端仍可读 */
  pfFeeAmountWei?: string;
  /** @deprecated 用户 API 不再下发；管理端仍可读 */
  pfFeeType?: "COLLATERAL" | "SHARES";
  /** @deprecated 用户 API 不再下发；管理端仍可读 */
  pfFeeUsdt?: number;
  /** @deprecated 用户 API 不再下发；管理端仍可读 */
  pfFeeRateBps?: number;
  pfSellProceeds?: number;
  pfSellOrderId?: string;
}

export interface VenueOrder extends PolymarketVenueOrderExtras, PredictFunVenueOrderExtras {
  provider: PlatformId;
  orderId: string;
  odds: number;
  createAt: number;
  betMoney: number;
  reward: number;
  money: number;
  status: VenueOrderStatus;
  game: string;
  match: string;
  bet: string;
  item: string;
  /** [changmen 扩展] 订单业务域；非电竞运动订单写 orders 时必须带 sports。 */
  domain?: "esport" | "sports" | string;
  /** [changmen 扩展] 体育运动类型。 */
  sport?: "football" | string;
  /** [changmen 扩展] 订单来源，如 football-pod / football-board。 */
  source?: string;
  /** [changmen 扩展] POD 跟单票稳定 id，用于刷新后防重复。 */
  podClientId?: string;
  /** [changmen 扩展] POD 跟单时板上 PM 赛事 id，用于刷新后同场闸门。 */
  podPmMatchId?: string;
  podRayMatchId?: string;
  podMarketCode?: string;
  podBoardSide?: string;
  /**
   * [changmen 扩展] SaveOrder 直写最终套利 Link，缩短 create_at-1 占位窗口。
   * 对齐 docs/ARB_LINK_ID.md：Bind 仍为确认；有值时后端优先落库。
   */
  link?: number;
}

/** 对齐 A8 `isVenueReject`：拒单检测取列表首条，须保证最新单在前 */
export function sortVenueOrdersNewestFirst(orders: VenueOrder[]): VenueOrder[] {
  return [...orders].sort((a, b) => b.createAt - a.createAt || b.orderId.localeCompare(a.orderId));
}

/**
 * 订单状态层结论（POST/API 受理之后）。
 * - filled：最终成交
 * - unfilled：确认未成交（拒单 / FOK Cancellation / trade FAILED）
 * - timeout：仍待确认（官方 delay 窗或接口滞后未决；jb / 套利侧续查，**不入补单**）
 */
export type VenueLegSettlement = "filled" | "unfilled" | "timeout";

export interface VenueLegOutcome {
  orders: VenueOrder[];
  settlement: VenueLegSettlement;
}

/** 非 filled（含 timeout）。jb 须先查 `isVenueLegPendingConfirm` 再当拒单。 */
export function isVenueLegRejected(outcome: VenueLegOutcome): boolean {
  return outcome.settlement !== "filled";
}

/** 确认未成交，可补单；timeout 不算。 */
export function isVenueLegConfirmedUnfilled(outcome: VenueLegOutcome): boolean {
  return outcome.settlement === "unfilled";
}

export function isVenueLegPendingConfirm(outcome: VenueLegOutcome): boolean {
  return outcome.settlement === "timeout";
}

export interface ResolveLegOutcomeOpts {
  /**
   * 受理后确认：轮询官方 GetOrder / settle / trades。
   * PM delayed、PF 挂单等须为 true；false 时仅按 getOrders + orderId 判拒。
   */
  confirmPostAccepted?: boolean;
  /** 显式订单快照（测试/兜底）；有 fetchVenueOrders 时 A8 路径优先回调 */
  orders?: VenueOrder[];
  /**
   * 编排层拉单回调（含 saveOrders）。
   * [A8 可证实] A8 场馆须在 rejectWaitSec 之后调用，勿在编排入口预拉后塞入 orders。
   */
  fetchVenueOrders?: () => Promise<VenueOrder[]>;
  /**
   * 拒单检测前等待秒数（A8 类场馆：sleep 后拉单一次）。
   * 受理后确认场馆（PM delayed / PF）忽略此项，走 adapter 内确认时序。
   */
  rejectWaitSec?: number;
  /**
   * PM CLOB `condition_id`（下注 `option.betId`）。
   * Settlement Job 缺失时按官方 `GET /clob-markets/{id}` 的 `sd` 再轮询，避免默认 1s 窗内 FOK。
   */
  pmConditionId?: string;
}

export interface PlatformProvider {
  getBalance?(account: PlatformAccount): Promise<AccountBalanceResult | undefined>;
  getOrders?(account: PlatformAccount): Promise<VenueOrder[]>;
  checkBet(account: PlatformAccount, option: BetOption, context?: {
    role?: "execute" | "precheckOnly";
    prepareSigning?: Promise<boolean>;
  }): Promise<BetOption>;
  betting(account: PlatformAccount, option: BetOption): Promise<BetResult>;
  /** 订单状态层：POST 之后判定 filled / unfilled / timeout（拒单检测） */
  resolveLegOutcome?(
    account: PlatformAccount,
    result?: BetResult,
    opts?: ResolveLegOutcomeOpts,
  ): Promise<VenueLegOutcome>;
}

type StopFn = () => void;
export type CollectorFactory = () => StopFn;

export type CollectionMode =
  | "http_mqtt"
  | "http_ws"
  | "http_poll"
  | "aggregator_ws"
  | "parse_ws"
  | "plugin_http"
  | "plugin_graphql_ws"
  | "plugin_http_ws"
  | "vps_http_ws"
  | "none";

/** 平台能力元数据（与 registry/manifest.json 对齐） */
export interface PlatformAdapterMeta {
  id: PlatformId;
  /** 目录名，小写：ob、xbet */
  dir: string;
  sort: number;
  collect: boolean;
  bet: boolean;
  pluginOnly?: boolean;
  a8Channel?: boolean;
  collectionMode: CollectionMode;
  saveMatchIntervalMs?: number;
}

export interface PlatformAdapter {
  id: PlatformId;
  meta?: PlatformAdapterMeta;
  collector?: CollectorFactory;
  provider?: PlatformProvider;
}
