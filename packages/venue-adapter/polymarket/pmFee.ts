import type { PolymarketActivityBuyCost } from "./pmActivity";
import { POLYMARKET_CLOB_API } from "./api";
import { resolvePolymarketBuyCostFromActivity } from "./pmActivity";
import { polymarketPluginGet } from "./transport";

/** CLOB `/clob-markets/{id}` 的 fee 曲线参数 */
export interface PolymarketMarketFeeDetails {
  /** 平台 feeRate（文档 `fd.r`） */
  feeRate: number;
  /** 曲线指数（文档 `fd.e`；公开主公式按 p×(1−p)，e 仅保留） */
  exponent: number;
  /** 是否仅 taker 收费 */
  takerOnly: boolean;
}

const FEE_CACHE_TTL_MS = 5 * 60_000;
const feeCache = new Map<string, { details: PolymarketMarketFeeDetails; expiresAt: number }>();

function round5(n: number): number {
  if (!Number.isFinite(n) || n <= 0)
    return 0;
  const rounded = Math.round(n * 100_000) / 100_000;
  // 官方：小于 0.00001 当 0
  return rounded < 0.00001 ? 0 : rounded;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** 解析 `/clob-markets` 的 `fd` */
export function parsePolymarketMarketFeeDetails(
  row: { fd?: { r?: unknown; e?: unknown; to?: unknown } | null } | null | undefined,
): PolymarketMarketFeeDetails {
  const fd = row?.fd;
  const feeRate = Number(fd?.r);
  const exponent = Number(fd?.e);
  return {
    feeRate: Number.isFinite(feeRate) && feeRate > 0 ? feeRate : 0,
    exponent: Number.isFinite(exponent) && exponent > 0 ? exponent : 1,
    takerOnly: fd?.to !== false,
  };
}

/**
 * 平台 taker fee（USDC）。
 * 文档主公式：`fee = C × feeRate × p × (1 − p)`，保留 5 位小数。
 * Maker 或不收费盘 → 0。
 */
export function computePolymarketPlatformFeeUsdc(params: {
  shares: number;
  price: number;
  feeRate: number;
  /** 预留；公开表与主公式一致时按 p×(1−p)，不升幂 */
  exponent?: number;
  takerOnly?: boolean;
  isTaker?: boolean;
}): number {
  const shares = Number(params.shares);
  const price = Number(params.price);
  const feeRate = Number(params.feeRate);
  const isTaker = params.isTaker !== false;
  const takerOnly = params.takerOnly !== false;
  if (!(shares > 0) || !(price > 0 && price < 1) || !(feeRate > 0))
    return 0;
  if (takerOnly && !isTaker)
    return 0;
  // 主公式（对齐 docs/trading/fees）；exponent≠1 的市场若官方另有曲线再迭代
  const fee = shares * feeRate * price * (1 - price);
  return round5(fee);
}

/** Builder taker 扁平费率（bps）；当前下单预填 0，预留叠加 */
export function computePolymarketBuilderFeeUsdc(notionalUsdc: number, takerBps: number): number {
  const notional = Number(notionalUsdc);
  const bps = Number(takerBps);
  if (!(notional > 0) || !(bps > 0))
    return 0;
  return round5(notional * bps / 10_000);
}

/**
 * 买单全成本：名义 G + 平台 fee（+ 可选 builder）。
 * fillPrice = 撮合均价 G/C；allInAvgPrice = (G+fee)/C（对齐官网 ¢）。
 */
export function computePolymarketBuyAllInStakeUsdc(params: {
  grossStakeUsdc: number;
  shares: number;
  feeRate?: number;
  exponent?: number;
  takerOnly?: boolean;
  isTaker?: boolean;
  builderTakerBps?: number;
  /** 若已算好 fee，直接用 */
  feeUsdc?: number;
}): {
  feeUsdc: number;
  allInStakeUsdc: number;
  /** 撮合均价（不含费） */
  fillPrice: number;
  /** 含费均价（官网历史徽章口径） */
  allInAvgPrice: number;
} {
  const gross = round4(Number(params.grossStakeUsdc) || 0);
  const shares = Number(params.shares) || 0;
  const fillPrice = shares > 0 && gross > 0 ? gross / shares : 0;
  let feeUsdc = Number(params.feeUsdc);
  if (!Number.isFinite(feeUsdc) || feeUsdc < 0) {
    feeUsdc = computePolymarketPlatformFeeUsdc({
      shares,
      price: fillPrice,
      feeRate: Number(params.feeRate) || 0,
      exponent: params.exponent,
      takerOnly: params.takerOnly,
      isTaker: params.isTaker,
    });
    feeUsdc = round4(
      feeUsdc + computePolymarketBuilderFeeUsdc(gross, Number(params.builderTakerBps) || 0),
    );
  }
  else {
    feeUsdc = round4(feeUsdc);
  }
  const allInStakeUsdc = round4(gross + feeUsdc);
  const allInAvgPrice = shares > 0 && allInStakeUsdc > 0
    ? allInStakeUsdc / shares
    : fillPrice;
  return {
    feeUsdc,
    allInStakeUsdc,
    fillPrice,
    allInAvgPrice,
  };
}

/** 拉取并缓存市场 fee 参数；失败视为 0 费率（并打日志，避免静默漏记） */
export async function fetchPolymarketMarketFeeDetails(
  conditionId: string,
): Promise<PolymarketMarketFeeDetails> {
  const id = String(conditionId ?? "").trim();
  const empty: PolymarketMarketFeeDetails = { feeRate: 0, exponent: 1, takerOnly: true };
  if (!id)
    return empty;

  const now = Date.now();
  const hit = feeCache.get(id);
  if (hit && hit.expiresAt > now)
    return hit.details;

  try {
    const row = await polymarketPluginGet<{ fd?: { r?: unknown; e?: unknown; to?: unknown } }>(
      `${POLYMARKET_CLOB_API}/clob-markets/${id}`,
    );
    const details = parsePolymarketMarketFeeDetails(row);
    feeCache.set(id, { details, expiresAt: now + FEE_CACHE_TTL_MS });
    return details;
  }
  catch (err) {
    console.warn(
      "[Polymarket] 拉取市场手续费参数失败，本单暂按 0 费率",
      id.slice(0, 18),
      err instanceof Error ? err.message : err,
    );
    return empty;
  }
}

/** 单测 / 登出：清 fee 缓存 */
export function clearPolymarketMarketFeeCache(): void {
  feeCache.clear();
}

function applyOfficialBuyCostToOrder<T extends {
  pmFeeUsdc?: number;
  pmShares?: number;
  pmFillPrice?: number;
  pmStakeUsdc?: number;
  betMoney?: number;
  odds?: number;
  reward?: number;
  money?: number;
  status?: string;
  pmSellState?: string;
  pmAttributedSellShares?: number;
  pmSide?: string;
}>(
  order: T,
  allIn: {
    feeUsdc: number;
    allInStakeUsdc: number;
    matchPrice: number;
    shares: number;
  },
): T {
  const shares = allIn.shares > 0 ? allIn.shares : Number(order.pmShares) || 0;
  const matchPrice = allIn.matchPrice > 0 ? allIn.matchPrice : Number(order.pmFillPrice) || 0;
  const odds = Number(order.odds) > 0
    ? Number(order.odds)
    : (matchPrice > 0 ? round4(1 / matchPrice) : 0);
  const gross = shares > 0 && matchPrice > 0 ? round4(shares * matchPrice) : 0;
  const next: T = {
    ...order,
    pmShares: shares > 0 ? shares : order.pmShares,
    // 直接用官网 activity.price / 撮合均价，不摊费用
    pmFillPrice: round4(matchPrice),
    pmFeeUsdc: allIn.feeUsdc > 0 ? allIn.feeUsdc : undefined,
    // 金额直接用官网 usdcSize（含费）
    pmStakeUsdc: allIn.allInStakeUsdc,
    betMoney: allIn.allInStakeUsdc,
    reward: odds > 0 && gross > 0 ? round4(gross * odds) : round4(shares),
    odds: odds > 0 ? odds : order.odds,
  };

  // 已结算且无卖出进度：盈亏按含费全成本重算，避免侧栏买入金额与盈亏差手续费
  const st = String(order.status ?? "").toLowerCase();
  const sellState = String(order.pmSellState ?? "").toLowerCase();
  const attr = Number(order.pmAttributedSellShares) || 0;
  const isBuy = String(order.pmSide ?? "buy").toLowerCase() !== "sell";
  if (
    isBuy
    && (st === "win" || st === "lose" || st === "lost")
    && attr <= 0.0001
    && sellState !== "partial"
    && sellState !== "closed"
    && allIn.allInStakeUsdc > 0
    && shares > 0
  ) {
    if (st === "win") {
      next.reward = round4(shares);
      next.money = round4(shares - allIn.allInStakeUsdc);
    }
    else {
      next.reward = 0;
      next.money = round4(-allIn.allInStakeUsdc);
    }
  }
  return next;
}

function activityToOfficialCost(
  cost: PolymarketActivityBuyCost,
): {
  feeUsdc: number;
  allInStakeUsdc: number;
  matchPrice: number;
  shares: number;
} {
  return {
    feeUsdc: cost.feeUsdc,
    allInStakeUsdc: cost.usdcSize,
    matchPrice: cost.matchPrice,
    shares: cost.shares,
  };
}

/**
 * 未卖出买单：优先用 Data API `/activity` 的 price / size / usdcSize（官网字段，不自算均价）。
 * activity 未索引时回退费率公式。
 * 部分卖出 / closed 不改 stake；持有到期（settled）仍可补费，并按买入金额校准 win/lose 盈亏。
 */
export async function enrichPolymarketBuyVenueOrderWithFee<T extends {
  orderId?: string;
  pmSide?: string;
  pmFeeUsdc?: number;
  pmConditionId?: string;
  pmTokenId?: string;
  pmShares?: number;
  pmFillPrice?: number;
  pmStakeUsdc?: number;
  pmAttributedSellShares?: number;
  pmSellState?: string;
  betMoney?: number;
  odds?: number;
  reward?: number;
  money?: number;
  status?: string;
  createAt?: number;
}>(
  order: T,
  options?: {
    proxyWallet?: string;
    /** 批量 enrich 时预拉取的 activity，避免每单打一次 HTTP */
    activityRows?: import("./pmActivity").PolymarketActivityTradeRow[];
    /**
     * CLOB orderId → transaction_hash[]（与 activity.transactionHash 1:1）。
     * getOrders 合并路径传入，避免仅靠份额/时间近似匹配。
     */
    txHashesByOrderId?: Map<string, string[]>;
  },
): Promise<T> {
  if (String(order.pmSide ?? "buy").toLowerCase() === "sell")
    return order;

  const sellState = String(order.pmSellState ?? "").toLowerCase();
  const attributed = Number(order.pmAttributedSellShares) || 0;
  // 仅跳过已有卖出进度；settled（持有到期）仍补费并校准盈亏
  if (
    attributed > 0.0001
    || sellState === "partial"
    || sellState === "closed"
  ) {
    return order;
  }

  const shares = Number(order.pmShares) || 0;
  const fillPrice = Number(order.pmFillPrice) || 0;
  const stakeNow = round4(Number(order.pmStakeUsdc) || Number(order.betMoney) || 0);
  const product = (shares > 0.0001 && fillPrice > 0 && fillPrice < 1)
    ? round4(shares * fillPrice)
    : 0;

  // 未卖出：有 proxy / 预拉取 activity 就尽量用官网覆盖
  const proxy = String(options?.proxyWallet ?? "").trim().toLowerCase();
  const orderIdKey = String(order.orderId ?? "").trim().toLowerCase();
  const txHashes = orderIdKey && options?.txHashesByOrderId
    ? options.txHashesByOrderId.get(orderIdKey)
    : undefined;
  const matchParams = {
    conditionId: String(order.pmConditionId ?? "").trim() || undefined,
    tokenId: String(order.pmTokenId ?? "").trim() || undefined,
    shares: shares > 0 ? shares : undefined,
    createAtMs: Number(order.createAt) || undefined,
    transactionHashes: txHashes?.length ? txHashes : undefined,
  };
  // A transaction can settle several orders for the same wallet/token.
  // Its total activity cash must not overwrite a smaller order's cost.
  // Local fill shares may be rounded to 4 decimals; allow only that dust.
  const activityFitsOrder = (cost: PolymarketActivityBuyCost): boolean =>
    Number.isFinite(shares) && shares > 0 && Math.abs(cost.shares - shares) <= 0.0001;
  if (Array.isArray(options?.activityRows)) {
    const { matchPolymarketActivityBuyCost } = await import("./pmActivity");
    const fromActivity = matchPolymarketActivityBuyCost(options.activityRows, matchParams);
    if (fromActivity && fromActivity.usdcSize > 0 && activityFitsOrder(fromActivity)) {
      return applyOfficialBuyCostToOrder(order, activityToOfficialCost(fromActivity));
    }
  }
  else if (
    /^0x[0-9a-f]{40}$/.test(proxy)
    && (matchParams.conditionId || matchParams.tokenId || matchParams.transactionHashes?.length)
  ) {
    const fromActivity = await resolvePolymarketBuyCostFromActivity(proxy, matchParams);
    if (fromActivity && fromActivity.usdcSize > 0 && activityFitsOrder(fromActivity)) {
      return applyOfficialBuyCostToOrder(order, activityToOfficialCost(fromActivity));
    }
  }

  const feeUsdc = Number(order.pmFeeUsdc);
  // 已有 fee 且 activity 未到：未结算保持；已结算则按含费买入金额校准 money
  if (Number.isFinite(feeUsdc) && feeUsdc > 0) {
    const st = String(order.status ?? "").toLowerCase();
    if ((st === "win" || st === "lose" || st === "lost") && shares > 0 && stakeNow > 0) {
      // fee 已记但 stake 仍贴名义时，补上 fee，避免 money 仍按名义
      const allInStake = (product > 0 && stakeNow <= product + 0.0001)
        ? round4(stakeNow + feeUsdc)
        : stakeNow;
      return applyOfficialBuyCostToOrder(order, {
        feeUsdc,
        allInStakeUsdc: allInStake,
        matchPrice: fillPrice,
        shares,
      });
    }
    return order;
  }

  if (!(shares > 0) || !(product > 0) || !(fillPrice > 0 && fillPrice < 1))
    return order;

  // stake 已明显高于名义 → 多半已是含费全成本，勿再叠公式 fee
  if (stakeNow > product + 0.0001) {
    const impliedFee = round4(stakeNow - product);
    return applyOfficialBuyCostToOrder(order, {
      feeUsdc: impliedFee,
      allInStakeUsdc: stakeNow,
      matchPrice: fillPrice,
      shares,
    });
  }

  const conditionId = String(order.pmConditionId ?? "").trim();
  if (!conditionId)
    return order;

  const fd = await fetchPolymarketMarketFeeDetails(conditionId);
  const allIn = computePolymarketBuyAllInStakeUsdc({
    grossStakeUsdc: product,
    shares,
    feeRate: fd.feeRate,
    exponent: fd.exponent,
    takerOnly: fd.takerOnly,
    isTaker: true,
  });
  if (!(allIn.allInStakeUsdc > 0))
    return order;

  return applyOfficialBuyCostToOrder(order, {
    feeUsdc: allIn.feeUsdc,
    allInStakeUsdc: allIn.allInStakeUsdc,
    matchPrice: allIn.fillPrice,
    shares,
  });
}

/** 批量补费；同账号只拉一次 /activity */
export async function enrichPolymarketBuyOrdersWithFees<T extends {
  orderId?: string;
  pmSide?: string;
  pmFeeUsdc?: number;
  pmConditionId?: string;
  pmTokenId?: string;
  pmShares?: number;
  pmFillPrice?: number;
  pmStakeUsdc?: number;
  pmAttributedSellShares?: number;
  pmSellState?: string;
  betMoney?: number;
  odds?: number;
  reward?: number;
  money?: number;
  status?: string;
  createAt?: number;
}>(
  orders: T[],
  options?: {
    proxyWallet?: string;
    /** CLOB orderId → txHash；与 activity 精确对齐 */
    txHashesByOrderId?: Map<string, string[]>;
  },
): Promise<T[]> {
  if (!orders.length)
    return orders;
  const proxy = String(options?.proxyWallet ?? "").trim().toLowerCase();
  let activityRows: import("./pmActivity").PolymarketActivityTradeRow[] | undefined;
  if (/^0x[0-9a-f]{40}$/.test(proxy)) {
    const { fetchPolymarketUserActivityTrades } = await import("./pmActivity");
    // 完整分页覆盖待核对买单的时间窗，避免高频账号只取首页漏掉旧单。
    const buys = orders.filter(o => String(o.pmSide ?? "buy").toLowerCase() !== "sell");
    const createdSeconds = buys.map((o) => {
      const created = Number(o.createAt);
      return created > 1e12 ? created / 1000 : created;
    });
    const startSec = createdSeconds.length && createdSeconds.every(t => Number.isFinite(t) && t > 0)
      ? Math.max(1, Math.floor(Math.min(...createdSeconds) - 900))
      : undefined;
    // A stored createAt can predate the final fill by hours/days.
    const endSec = Math.floor(Date.now() / 1000) + 60;
    activityRows = await fetchPolymarketUserActivityTrades(proxy, {
      limit: 200,
      side: "BUY",
      startSec,
      endSec,
    });
  }
  return Promise.all(orders.map(o => enrichPolymarketBuyVenueOrderWithFee(o, {
    proxyWallet: proxy,
    activityRows,
    txHashesByOrderId: options?.txHashesByOrderId,
  })));
}
