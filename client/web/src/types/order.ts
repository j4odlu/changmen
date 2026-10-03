import type { PlatformId } from "@changmen/client-core/types/esport";

export type {
  LoseOrderCancelledRecord,
  LoseOrderRecord,
  MakeupRuntimePhase,
  OrderStatus,
} from "@changmen/client-core/types/order";

/** 订单列表/UI 用 OrderRow（含 [changmen 扩展] PM 字段） */
export interface OrderRow {
  OrderID?: number | string;
  Link?: number;
  Type?: PlatformId | string;
  Match?: string;
  Bet?: string;
  Item?: string;
  Odds?: number;
  BetMoney?: number;
  Money?: number;
  Status?: import("@changmen/client-core/types/order").OrderStatus;
  CreateAt?: number;
  PlayerID?: number;
  Player?: OrderPlayerInfo;
  /** [changmen 扩展] 对应 player 已 soft-delete；展示用（对齐管理端 playerDeleted） */
  PlayerDeleted?: boolean;
  /** [changmen 扩展] 订单业务域；旧订单为空时按电竞处理 */
  Domain?: "esport" | "sports" | string;
  /** [changmen 扩展] 体育订单运动类型 */
  Sport?: "football" | string;
  /** [changmen 扩展] 订单来源，如 POD 跟单 */
  Source?: string;
  /** [changmen 扩展] POD 跟单票稳定 id，用于刷新后防重复 */
  PodClientId?: string;
  /** [changmen 扩展] POD 跟单时板上 PM 赛事 id，用于刷新后同场闸门 */
  PodPmMatchId?: string;
  PodRayMatchId?: string;
  PodMarketCode?: string;
  PodBoardSide?: string;
  /** [changmen 扩展] 原始订单游戏/运动码 */
  Game?: string;
  /** [changmen 扩展] Polymarket 持仓，来自 orders.raw */
  PmTokenId?: string;
  PmShares?: number;
  /** CLOB trade.price / 成交概率价（0–1）；不含手续费 */
  PmFillPrice?: number;
  /** 含手续费全成本 USDC（名义 + fee）；剩余敞口随卖出扣减 */
  PmStakeUsdc?: number;
  /** [changmen 扩展] 买单撮合手续费 USDC */
  PmFeeUsdc?: number;
  PmConditionId?: string;
  /** changmen 站内下单；官网同步为 external */
  PmOrigin?: "changmen" | "external";
  PmAttributedSellShares?: number;
  PmRealizedPnlUsdc?: number;
  /**
   * [changmen 扩展] 买单累计卖出回款 USDC（对标 PfSellProceeds）。
   * 展示仍可读卖单 BetMoney；本字段为经济真相，旧单可能缺失。
   */
  PmSellProceeds?: number;
  /** 最近一笔卖单 orderId */
  PmLastSellOrderId?: string;
  PmSellState?: "open" | "partial" | "closed" | "settled";
  /** buy=买入；sell=平仓 */
  PmSide?: "buy" | "sell";
  /** 卖单对应买单 orderId */
  PmBuyOrderId?: string;
  /**
   * [changmen 扩展] 市场赛果（持有到期）：Win/Lose。
   * 与 Status/Money 脱钩；中途卖出仍可有值。
   */
  PmMatchResult?: "Win" | "Lose";
  /** [changmen 扩展] PredictFun 1:1 买卖 */
  PfSide?: "buy" | "sell";
  PfBuyOrderId?: string;
  PfSellState?: "open" | "closed" | "settled";
  PfShares?: number;
  /** [changmen 扩展] 官网持仓口径份额经 Changmencodefee 处理后的用户持仓（成交 − 官网份额费 − Changmencodefee）。 */
  PfHoldShares?: number;
  /**
   * [changmen 扩展] 名义买入 USDT（限价×份额，如 14.12）。
   * 侧栏买入金额 / 图例未结预览优先读此；无则回退 BetMoney。
   */
  PfNotionalUsdt?: number;
  /** [changmen 扩展] 链上实付成交额（可低于名义） */
  PfFillCostUsdt?: number;
  /** [changmen 扩展] 买入限价/盘口价 (0,1) */
  PfBookPrice?: number;
  PfTokenId?: string;
  PfMarketId?: string;
  PfSellOrderId?: string;
  /** [changmen 扩展] 买单上卖出回款 USDT（RDS 落库值；卖单 BetMoney 为其展示镜像） */
  PfSellProceeds?: number;
  PfFeeAmountWei?: string;
  PfFeeType?: "COLLATERAL" | "SHARES";
  PfFeeUsdt?: number;
  PfFeeRateBps?: number;
  /** Changmencodefee（管理端展示；用户侧栏经 scrub 不下发明细） */
  PfChangmenCodeFeeRateBps?: number;
  PfChangmenCodeFeeShares?: number;
  PfChangmenCodeFeeUsdt?: number;
  /**
   * [changmen 扩展] Phase 1 仓位卖出事件（写在买单 raw.positionEvents）。
   * 仅双写生效后的买单会有；用于 UI 观察「仓位·N / 已记入 / 缺事件」。
   */
  PositionEvents?: {
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

export interface OrderPlayerInfo {
  Platform?: string;
  UserName?: string;
  Status?: import("@changmen/client-core/types/order").OrderStatus;
}

export interface FollowOrderInput {
  isOpen?: boolean;
  betMoney?: number;
  minMoney?: number;
  maxMoney?: number;
  odds?: number;
  publishers?: number[];
}

/** Follow KV 完整配置（对齐 bundle `FollowView` 的 users 字段） */
export interface FollowConfig {
  isOpen: boolean;
  betMoney: number;
  minMoney?: number;
  maxMoney?: number;
  odds: number;
  /** bundle 原字段 */
  users?: number[];
  /** 兼容旧字段 */
  publishers?: number[];
}
