import type { OrderRow } from "@/types/order";
import { truncateOddsTo3 } from "@changmen/shared/odds_format";
import { toFixed } from "@changmen/client-core/shared/format";
import { Currency, getExchange } from "@changmen/shared/currency";
import { resolvePmFillShares, resolvePmRemainingShares } from "@changmen/venue-adapter/polymarket";
import { normalizeOrderStatus } from "@/shared/orderDisplay";

/** Polymarket API 数值：保留有效小数，去掉尾部 0 */
export function formatPolymarketApiDecimal(value: number, maxDecimals = 6): string {
  if (!Number.isFinite(value))
    return "";
  const fixed = value.toFixed(maxDecimals);
  return fixed.replace(/\.?0+$/, "") || "0";
}

/** 侧栏展示的 PM 订单（买单 + changmen 卖单） */
export function isPmOrderListRow(row: OrderRow): boolean {
  return String(row.Type ?? "").trim() === "Polymarket";
}

export function isPmSellOrderListRow(row: OrderRow): boolean {
  return isPmOrderListRow(row) && row.PmSide === "sell";
}

export function isPmBuyOrderListRow(row: OrderRow): boolean {
  return isPmOrderListRow(row) && row.PmSide !== "sell";
}

/** 手动卖出（含部分卖 / settled 但已有卖出归因） */
export function isPmManuallySoldBuy(row: OrderRow): boolean {
  if (!isPmBuyOrderListRow(row))
    return false;
  const state = String(row.PmSellState ?? "").toLowerCase();
  if (state === "closed" || state === "partial")
    return true;
  const attr = Number(row.PmAttributedSellShares) || 0;
  return state === "settled" && attr > 0;
}

/** 赛果结算：settled 且无手动卖出归因 */
export function isPmMarketSettledBuy(row: OrderRow): boolean {
  if (!isPmBuyOrderListRow(row))
    return false;
  if (isPmManuallySoldBuy(row))
    return false;
  return String(row.PmSellState ?? "").toLowerCase() === "settled";
}

/** 侧栏买单生命周期小标签文案（角标输赢另见 resolvePmOrderListStatusClass） */
export function pmBuyLifecycleTagText(row: OrderRow): string | null {
  if (isPmManuallySoldBuy(row)) {
    const state = String(row.PmSellState ?? "").toLowerCase();
    // 仍有剩余仓：部分卖出；已卖光不再打「已卖出」（角标改输赢，卖出看附属块）
    if (state === "partial" && resolvePmRemainingShares(row) > 0)
      return "部分卖出";
    return null;
  }
  if (isPmMarketSettledBuy(row))
    return "已结算";
  return null;
}

/** 已实现盈亏 → 角标 Win/Lose（打平按 Win） */
export function statusClassFromRealizedMoney(money: unknown): "Win" | "Lose" {
  const n = Number(money);
  if (Number.isFinite(n) && n < 0)
    return "Lose";
  return "Win";
}

/**
 * 侧栏角标 class：手动平仓后 RDS 常仍为 Status=None（挡 Gamma）。
 * - 卖单：PmSell（已平仓动作）
 * - 买单全卖 / 赛果结算：按 Money（或 PmMatchResult）映 Win/Lose
 * - 部分卖 / 未结：待结算（None/Pending）
 */
export function resolvePmOrderListStatusClass(row: OrderRow): string {
  if (!isPmOrderListRow(row))
    return String(normalizeOrderStatus(String(row.Status ?? "None")));

  const raw = String(normalizeOrderStatus(String(row.Status ?? "None")));
  if (raw !== "None" && raw !== "Pending")
    return raw;

  if (isPmSellOrderListRow(row)) {
    // 卖单只表平仓动作结果，不用 Return「退」（易误解为退款）
    const bet = Number(row.BetMoney) || 0;
    if (bet <= 0)
      return "None";
    return "PmSell";
  }

  if (isPmManuallySoldBuy(row)) {
    const state = String(row.PmSellState ?? "").toLowerCase();
    if (state === "partial" && resolvePmRemainingShares(row) > 0)
      return raw; // 部分卖出仍待结算剩余仓
    return statusClassFromRealizedMoney(row.Money);
  }
  if (isPmMarketSettledBuy(row)) {
    const match = String(row.PmMatchResult ?? "").trim().toLowerCase();
    if (match === "win")
      return "Win";
    if (match === "lose")
      return "Lose";
    return statusClassFromRealizedMoney(row.Money);
  }

  return raw;
}

export function pmOrderSharesText(row: OrderRow): string | null {
  if (isPmSellOrderListRow(row)) {
    const sold = Number(row.PmShares);
    if (!Number.isFinite(sold) || sold <= 0.0001)
      return null;
    return formatPolymarketApiDecimal(sold);
  }
  // 买单始终展示原始成交份额（订单记录）；剩余仓位由「已卖出/部分卖出」标签表达
  const fill = resolvePmFillShares(row);
  if (!Number.isFinite(fill) || fill <= 0.0001)
    return null;
  return formatPolymarketApiDecimal(fill);
}

/**
 * 买单原始本金（CNY）：订单记录口径。
 * - 优先库内 BetMoney（含费全成本；卖出后不再改写原始本金）
 * - 旧数据 closed 且 bet_money=0：份额×撮合价(+fee) 还原
 */
export function pmOrderOriginalStakeDisplayCny(row: OrderRow): number {
  const stored = Number(row.BetMoney) || 0;
  if (stored > 0)
    return stored;

  const attr = Number(row.PmAttributedSellShares) || 0;
  const soldProgress = attr > 0
    || row.PmSellState === "partial"
    || row.PmSellState === "closed"
    || row.PmSellState === "settled";
  if (!soldProgress)
    return 0;

  const fill = resolvePmFillShares(row);
  const price = resolvePmFillPrice(row);
  const fee = Number(row.PmFeeUsdc);
  if (fill > 0.0001 && price != null && price > 0) {
    const gross = fill * price;
    const allIn = Number.isFinite(fee) && fee > 0 ? gross + fee : gross;
    return Math.round(allIn * getExchange(Currency.USDT));
  }
  return 0;
}

/**
 * 买单展示本金（CNY）= 原始成交本金；
 * 卖单回款：优先 PmStakeUsdc（事件合成）→ 再 deprecated BetMoney 兜底。
 */
export function pmOrderStakeDisplayCny(row: OrderRow): number {
  if (isPmSellOrderListRow(row)) {
    const stakeUsdc = Number(row.PmStakeUsdc);
    if (Number.isFinite(stakeUsdc) && stakeUsdc > 0) {
      const fx = getExchange(Currency.USDT);
      if (fx > 0)
        return Math.round(stakeUsdc * fx);
    }
    // @deprecated Phase 1 影子卖单行回款镜像；无事件/无 PmStakeUsdc 时兜底
    return Number(row.BetMoney) || 0;
  }
  return pmOrderOriginalStakeDisplayCny(row);
}

/** CNY 金额 → USDC（当前汇率；无有效汇率时返回 0） */
export function pmCnyToUsdc(cny: number): number {
  const n = Number(cny);
  if (!Number.isFinite(n) || n === 0)
    return 0;
  const fx = getExchange(Currency.USDT);
  if (!(fx > 0))
    return 0;
  return Math.round((n / fx) * 10000) / 10000;
}

/**
 * 买单原始本金（USDC）。
 * - 优先未卖出时的 pmStakeUsdc（官网 usdcSize / 含费全成本）
 * - 其次 BetMoney(CNY)/汇率
 * - 再：份额×撮合价 + fee（仅无库内成本时的兜底）
 */
export function pmOrderOriginalStakeDisplayUsdc(row: OrderRow): number {
  const attr = Number(row.PmAttributedSellShares) || 0;
  const stakeUsdc = Number(row.PmStakeUsdc);
  if (attr <= 0 && Number.isFinite(stakeUsdc) && stakeUsdc > 0)
    return Math.round(stakeUsdc * 10000) / 10000;

  const fromCny = pmCnyToUsdc(Number(row.BetMoney) || 0);
  if (fromCny > 0)
    return fromCny;

  const fill = resolvePmFillShares(row);
  const price = resolvePmFillPrice(row);
  const fee = Number(row.PmFeeUsdc);
  if (fill > 0.0001 && price != null && price > 0) {
    const gross = fill * price;
    const allIn = Number.isFinite(fee) && fee > 0 ? gross + fee : gross;
    return Math.round(allIn * 10000) / 10000;
  }

  return 0;
}

/** 买单展示本金（USDC）；卖单回款优先 PmStakeUsdc / PmSellProceeds */
export function pmOrderStakeDisplayUsdc(row: OrderRow): number {
  if (isPmSellOrderListRow(row)) {
    const stakeUsdc = Number(row.PmStakeUsdc);
    if (Number.isFinite(stakeUsdc) && stakeUsdc > 0)
      return Math.round(stakeUsdc * 10000) / 10000;
    const proceeds = Number(row.PmSellProceeds);
    if (Number.isFinite(proceeds) && proceeds > 0)
      return Math.round(proceeds * 10000) / 10000;
    // @deprecated Phase 1 影子卖单行 BetMoney(CNY)→U
    return pmCnyToUsdc(Number(row.BetMoney) || 0);
  }
  return pmOrderOriginalStakeDisplayUsdc(row);
}

/**
 * 买单盈亏（USDC）。
 * Money 在 RDS 为 CNY；有 PmRealizedPnlUsdc 时优先用。
 */
export function pmOrderProfitDisplayUsdc(row: OrderRow, peers: OrderRow[] = []): number | null {
  if (isPmSellOrderListRow(row))
    return null;

  const realized = Number(row.PmRealizedPnlUsdc);
  if (Number.isFinite(realized) && Math.abs(realized) > 1e-9)
    return Math.round(realized * 10000) / 10000;

  const cny = pmOrderProfitDisplayCny(row, peers);
  if (cny == null)
    return null;
  return pmCnyToUsdc(cny);
}

/**
 * 侧栏盈亏展示（CNY）。
 * - 卖单：不展示（返回 null → UI 显示 —）
 * - 买单：自身 Money（盈亏已记在买单）
 */
export function pmOrderProfitDisplayCny(row: OrderRow, _peers: OrderRow[] = []): number | null {
  if (isPmSellOrderListRow(row))
    return null;
  return Number(row.Money) || 0;
}

/**
 * 买单累计卖出回款 USDC（对标 PF `pfSellProceeds`）。
 * - 优先买单 `PmSellProceeds`（新成交真相）
 * - 其次 `positionEvents.sells[].proceeds` 合计
 * - 最后 @deprecated：关联影子卖单 `BetMoney`(CNY) ÷ 汇率（旧单兜底）
 */
export function resolvePmSellProceedsUsdc(buy: OrderRow, peers: OrderRow[] = []): number | null {
  if (!isPmBuyOrderListRow(buy))
    return null;
  const fromBuy = Number(buy.PmSellProceeds);
  // 仅正数视为真相；0/缺失走事件/卖单兜底，避免 sync 误写 0
  if (Number.isFinite(fromBuy) && fromBuy > 0)
    return fromBuy;

  const events = Array.isArray(buy.PositionEvents?.sells) ? buy.PositionEvents!.sells! : [];
  let fromEvents = 0;
  for (const ev of events) {
    const p = Number(ev?.proceeds);
    if (Number.isFinite(p) && p > 0)
      fromEvents += p;
  }
  if (fromEvents > 0)
    return Math.round(fromEvents * 10000) / 10000;

  const buyId = String(buy.OrderID ?? "").trim().toLowerCase();
  if (!buyId)
    return null;

  // @deprecated Phase 1：影子卖单行回款镜像
  const sellCny = peers
    .filter(p =>
      isPmSellOrderListRow(p)
      && String(p.PmBuyOrderId ?? "").trim().toLowerCase() === buyId,
    )
    .reduce((sum, p) => sum + (Number(p.BetMoney) || 0), 0);
  if (!(sellCny > 0))
    return null;
  const fx = getExchange(Currency.USDT);
  if (!(fx > 0))
    return null;
  return Math.round((sellCny / fx) * 10000) / 10000;
}

/** 侧栏价格列标题 */
export function pmOrderPriceLabel(row: OrderRow): string {
  return isPmSellOrderListRow(row) ? "卖单卖出价" : "买入价";
}

/** 侧栏侧别标签：买单 / 卖单 */
export function pmOrderSideTagText(row: OrderRow): string | null {
  if (!isPmOrderListRow(row))
    return null;
  return isPmSellOrderListRow(row) ? "卖单" : "买单";
}

/**
 * 买入价：优先存库 pmFillPrice（撮合价，不含费）。
 * 无存库时用 (stake−fee)/shares；再不行才 stake/shares（可能含费，仅兜底）。
 */
export function resolvePmFillPrice(row: OrderRow): number | null {
  const stored = Number(row.PmFillPrice);
  if (Number.isFinite(stored) && stored > 0 && stored < 1)
    return stored;

  const shares = Number(row.PmShares);
  const attr = Number(row.PmAttributedSellShares) || 0;
  const stakeUsdc = Number(row.PmStakeUsdc);
  const feeUsdc = Number(row.PmFeeUsdc);
  // 仅无卖出归因时 stake 才是满仓成本；partial/closed 的 pmStakeUsdc 是剩余
  if (
    attr <= 0
    && Number.isFinite(shares)
    && shares > 0.0001
    && Number.isFinite(stakeUsdc)
    && stakeUsdc > 0
  ) {
    const gross = Number.isFinite(feeUsdc) && feeUsdc > 0
      ? stakeUsdc - feeUsdc
      : stakeUsdc;
    const price = gross / shares;
    if (price > 0 && price < 1)
      return price;
  }
  return null;
}

export function pmOrderFillPriceText(row: OrderRow): string | null {
  const price = resolvePmFillPrice(row);
  if (price == null)
    return null;
  return formatPolymarketApiDecimal(price);
}

/** [changmen 扩展] FOK 拒单只展示提交报价；旧订单价格由已保存赔率反算，明确标为约值。 */
export function pmOrderSubmissionQuote(row: OrderRow): { priceText: string; oddsText: string } | null {
  if (!isPmBuyOrderListRow(row) || row.PmGtcExecutionId
    || String(normalizeOrderStatus(String(row.Status ?? ""))) !== "Reject")
    return null;
  const submittedPrice = Number(row.PmSubmittedPrice);
  const hasPrice = Number.isFinite(submittedPrice) && submittedPrice > 0 && submittedPrice < 1;
  const storedOdds = Number(row.Odds);
  const hasOdds = Number.isFinite(storedOdds) && storedOdds > 1;
  const odds = hasOdds ? storedOdds : hasPrice ? 1 / submittedPrice : null;
  return {
    priceText: hasPrice ? formatPolymarketApiDecimal(submittedPrice, 4)
      : hasOdds ? `≈${formatPolymarketApiDecimal(1 / storedOdds, 4)}` : "—",
    oddsText: odds == null ? "—" : toFixed(truncateOddsTo3(odds), 3),
  };
}

/** 从未结算买单视角：把 fo 条目转成 0~1 盘口价（与盘口 getOdds 同源，优先 clobPrice） */
export function clobPriceFromFoOddsEntry(entry: {
  clobPrice?: number;
  odds?: number;
} | null | undefined): number | null {
  if (!entry)
    return null;
  const clob = Number(entry.clobPrice);
  if (Number.isFinite(clob) && clob > 0 && clob < 1)
    return clob;
  // 盘口展示读的是 fo.odds；部分路径可能只写了 odds 未带 clobPrice
  const odds = Number(entry.odds);
  if (Number.isFinite(odds) && odds > 1) {
    const price = 1 / odds;
    if (price > 0 && price < 1)
      return price;
  }
  return null;
}

/** 欧赔 → 概率价（体育 sportOddsStore 只有欧赔） */
export function clobPriceFromDecimalOdds(decimalOdds: number): number | null {
  if (!Number.isFinite(decimalOdds) || decimalOdds <= 1)
    return null;
  const price = 1 / decimalOdds;
  return price > 0 && price < 1 ? price : null;
}

/** 未结算时「当前价」用 live；列表已分列买入价/当前价，此函数供单测保留 */
export function resolvePmListDisplayPrice(
  row: OrderRow,
  liveClobPrice?: number | null,
): number | null {
  const live = Number(liveClobPrice);
  const status = String(row.Status ?? "").trim().toLowerCase();
  // 可卖持仓（含 0.99 启发式判赢仍 open）显示当前价；official settled 后不再显示
  const wantLive = isPmBuyOrderListRow(row)
    && row.PmSellState !== "closed"
    && row.PmSellState !== "settled"
    && status !== "reject"
    && status !== "return"
    && status !== "pending";
  if (wantLive && Number.isFinite(live) && live > 0 && live < 1)
    return live;
  return resolvePmFillPrice(row);
}

export function pmOrderDisplayPriceText(
  row: OrderRow,
  liveClobPrice?: number | null,
): string | null {
  const price = resolvePmListDisplayPrice(row, liveClobPrice);
  if (price == null)
    return null;
  return formatPolymarketApiDecimal(price);
}

/** 赔率：优先订单 Odds（盘口/撮合）；否则 1/买入价 */
export function pmOrderOddsText(row: OrderRow): string {
  const storedOdds = Number(row.Odds);
  if (Number.isFinite(storedOdds) && storedOdds > 1)
    return toFixed(truncateOddsTo3(storedOdds), 3);
  const price = resolvePmFillPrice(row);
  const odds = price != null
    ? truncateOddsTo3(1 / price)
    : truncateOddsTo3(0);
  return toFixed(odds, 3);
}

/**
 * 未结买单按实时价标记浮盈亏（CNY，取整）。
 * 市值 = 剩余份额 × 当前价；成本 = 剩余 pmStakeUsdc（无则 fill×买入价）。
 */
export function pmUnrealizedPnlAtLiveCny(
  row: OrderRow,
  livePrice: number | null | undefined,
): number | null {
  if (!isPmBuyOrderListRow(row))
    return null;
  const live = Number(livePrice);
  if (!(live > 0 && live < 1))
    return null;
  const shares = resolvePmRemainingShares(row);
  if (!(shares > 0.0001))
    return null;
  let costUsdc = Number(row.PmStakeUsdc);
  if (!(Number.isFinite(costUsdc) && costUsdc > 0)) {
    const fill = resolvePmFillShares(row);
    const fillPrice = resolvePmFillPrice(row);
    if (!(fill > 0.0001) || fillPrice == null)
      return null;
    costUsdc = fill * fillPrice;
  }
  const pnlUsdc = shares * live - costUsdc;
  return Math.round(pnlUsdc * getExchange(Currency.USDT));
}

/** 侧栏实时浮盈亏文案 */
export function formatLiveUnrealizedPnlText(pnlCny: number | null | undefined): string | null {
  if (pnlCny == null || !Number.isFinite(pnlCny))
    return null;
  const n = Math.round(pnlCny);
  if (n > 0)
    return `浮盈：+${n}`;
  if (n < 0)
    return `浮亏：${n}`;
  return `浮盈：0`;
}

/** 概率价 → 展示欧赔（与「当前价」同行时必须同源） */
export function pmOddsTextFromClobPrice(clobPrice: number): string {
  if (!(clobPrice > 0 && clobPrice < 1))
    return toFixed(0, 3);
  return toFixed(truncateOddsTo3(1 / clobPrice), 3);
}
