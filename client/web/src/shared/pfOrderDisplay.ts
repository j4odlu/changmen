import type { OrderRow } from "@/types/order";
import { truncateOddsTo3 } from "@changmen/shared/odds_format";
import { toFixed } from "@changmen/client-core/shared/format";
import { scaleUsdtToCnyDisplay } from "@changmen/shared/currency";
import { lookupPredictFunOrderLabels } from "@changmen/venue-browser/adapter/predictfun";
import { formatPolymarketApiDecimal, statusClassFromRealizedMoney } from "@/shared/pmOrderDisplay";
import { normalizeOrderStatus } from "@/shared/orderDisplay";
import { useMatchStore } from "@/stores/matchStore";

/** PredictFun 侧栏订单（买单 + 卖单） */
export function isPfOrderListRow(row: OrderRow): boolean {
  return String(row.Type ?? "").trim() === "PredictFun";
}

export function isPfSellOrderListRow(row: OrderRow): boolean {
  return isPfOrderListRow(row) && row.PfSide === "sell";
}

export function isPfBuyOrderListRow(row: OrderRow): boolean {
  return isPfOrderListRow(row) && row.PfSide !== "sell";
}

export function isPfManuallySoldBuy(row: OrderRow): boolean {
  return isPfBuyOrderListRow(row) && String(row.PfSellState ?? "").toLowerCase() === "closed";
}

/** 赛果结算（持有到期）：对齐 PM `PmSellState=settled` */
export function isPfMarketSettledBuy(row: OrderRow): boolean {
  if (!isPfBuyOrderListRow(row))
    return false;
  if (isPfManuallySoldBuy(row))
    return false;
  if (String(row.PfSellState ?? "").toLowerCase() === "settled")
    return true;
  const st = String(normalizeOrderStatus(String(row.Status ?? "None")));
  return st === "Win" || st === "Lose";
}

/**
 * 侧栏买单生命周期小标签（角标输赢另见 resolvePfOrderListStatusClass）。
 * 对齐 PM：手动全卖不打「已卖出」；赛果结算打「已结算」。
 */
export function pfBuyLifecycleTagText(row: OrderRow): string | null {
  if (isPfManuallySoldBuy(row))
    return null;
  if (isPfMarketSettledBuy(row))
    return "已结算";
  return null;
}

/**
 * 侧栏角标：手动卖出后 RDS 仍可能为 None。
 * 卖单 → PfSell；买单全卖 / 赛果结算 → 按 Money 映 Win/Lose（对齐 PM）。
 */
export function resolvePfOrderListStatusClass(row: OrderRow): string {
  if (!isPfOrderListRow(row))
    return String(normalizeOrderStatus(String(row.Status ?? "None")));

  const raw = String(normalizeOrderStatus(String(row.Status ?? "None")));
  if (raw !== "None" && raw !== "Pending")
    return raw;

  if (isPfSellOrderListRow(row)) {
    const bet = Number(row.BetMoney) || 0;
    if (bet <= 0)
      return "None";
    return "PfSell";
  }

  if (isPfManuallySoldBuy(row) || isPfMarketSettledBuy(row))
    return statusClassFromRealizedMoney(row.Money);

  return raw;
}

/** 「市场 844582」/ 纯数字 / 占位 — 须继续升级成队名（对齐 PM） */
export function isBarePfMatch(s: string): boolean {
  const t = String(s ?? "").trim();
  return !t
    || t === "PredictFun"
    || /^\d+$/.test(t)
    || /^市场\s*\d+$/i.test(t);
}

export function extractPfMarketIdHint(match: string, pfMarketId = ""): string {
  const mid = String(pfMarketId ?? "").trim();
  if (mid && /^\d+$/.test(mid))
    return mid;
  const m = String(match ?? "").trim();
  if (/^\d+$/.test(m))
    return m;
  const hit = /^市场\s*(\d+)$/i.exec(m);
  return hit ? hit[1] : "";
}

export function isBarePfItem(s: string, tokenId = ""): boolean {
  const t = String(s ?? "").trim();
  const tok = String(tokenId ?? "").trim();
  if (!t || t === "PredictFun")
    return true;
  if (tok && t === tok)
    return true;
  if (/^\d{16,}$/.test(t))
    return true;
  if (/^\d{6,}…$/.test(t) || /^\d{6,}\.{3}$/.test(t))
    return true;
  return false;
}

function isBarePfBet(s: string): boolean {
  const t = String(s ?? "").trim();
  return !t || t === "PredictFun";
}

/** 从当前 GetMatchs 盘口反查（与 PM 同屏时最准） */
function labelsFromMatchStore(
  marketId: string,
  tokenId: string,
): { match: string; bet: string; item: string } | null {
  if (!marketId && !tokenId)
    return null;
  try {
    const matchs = useMatchStore().matchs;
    for (const match of matchs) {
      for (const bet of match.bets) {
        for (const src of bet.items) {
          if (String(src.type) !== "PredictFun")
            continue;
          const homeMid = String(src.homeSubscribeId || "").trim();
          const awayMid = String(src.awaySubscribeId || homeMid).trim();
          const homeTok = String(src.homeId || "").trim();
          const awayTok = String(src.awayId || "").trim();
          const hitMid = Boolean(marketId) && (marketId === homeMid || marketId === awayMid);
          const hitTok = Boolean(tokenId) && (tokenId === homeTok || tokenId === awayTok);
          if (!hitMid && !hitTok)
            continue;
          const isHome = tokenId
            ? tokenId === homeTok
            : marketId === homeMid;
          const home = String(bet.homeName || "").trim() || "主队";
          const away = String(bet.awayName || "").trim() || "客队";
          const title = String(match.title || "").trim();
          return {
            match: title || `${home} vs ${away}`,
            bet: bet.getBetName(),
            item: isHome ? home : away,
          };
        }
      }
    }
  }
  catch {
    return null;
  }
  return null;
}

/** 旧单裸 ID / 「市场 N」：索引 → 盘口 → 兜底（永不把「市场 N」当终态若有更好来源） */
function enrichLabels(row: OrderRow): { match: string; bet: string; item: string } {
  const match = String(row.Match ?? "").trim();
  const bet = String(row.Bet ?? "").trim();
  const item = String(row.Item ?? "").trim();
  const marketId = extractPfMarketIdHint(match, String(row.PfMarketId ?? ""));
  const tokenId = String(
    row.PfTokenId
      ?? (isBarePfItem(item) ? item : ""),
  ).trim();

  if (!isBarePfMatch(match) && !isBarePfBet(bet) && !isBarePfItem(item, tokenId))
    return { match, bet, item };

  const fromIndex = lookupPredictFunOrderLabels({ marketId, tokenId });
  const fromLive = fromIndex ? null : labelsFromMatchStore(marketId, tokenId);
  const hit = fromIndex || fromLive;

  return {
    match: !isBarePfMatch(match) ? match : (hit?.match || (marketId ? `市场 ${marketId}` : match || "—")),
    bet: !isBarePfBet(bet) ? bet : (hit?.bet || "全场胜负"),
    item: !isBarePfItem(item, tokenId)
      ? item
      : (hit?.item || (tokenId ? `${tokenId.slice(0, 8)}…` : item || "—")),
  };
}

export function pfOrderMatchText(row: OrderRow): string {
  return enrichLabels(row).match;
}

export function pfOrderBetText(row: OrderRow): string {
  return enrichLabels(row).bet;
}

export function pfOrderItemText(row: OrderRow): string {
  return enrichLabels(row).item;
}

/** SHARES 手续费（份）；COLLATERAL / 无数据 → null */
export function pfFeeSharesFromOrderRow(row: OrderRow): number | null {
  const type = String(
    row.PfFeeType
      ?? (row as { pfFeeType?: string }).pfFeeType
      ?? "",
  ).toUpperCase();
  if (type === "COLLATERAL")
    return null;
  const wei = String(
    row.PfFeeAmountWei
      ?? (row as { pfFeeAmountWei?: string }).pfFeeAmountWei
      ?? "",
  ).trim();
  if (!wei || !/^\d+$/.test(wei))
    return null;
  try {
    const shares = Number(BigInt(wei)) / 1e18;
    if (Number.isFinite(shares) && shares > 0)
      return shares;
  }
  catch {
    /* ignore */
  }
  return null;
}

/**
 * 用户端份额/回款：两位小数向 0 截断（不用四舍五入）。
 * 例：43.33075 → 43.33；43.339 → 43.33
 */
export function truncateShareUsdtAmount(value: number): number {
  if (!Number.isFinite(value) || value <= 0)
    return 0;
  return Math.trunc(value * 100 + 1e-9) / 100;
}

/**
 * 用户端份额展示：固定两位小数，向 0 截断（不用四舍五入）。
 */
export function truncateSharesDisplay(value: number, decimals = 2): string {
  if (decimals !== 2)
    return truncateShareUsdtAmount(value).toFixed(2);
  const t = truncateShareUsdtAmount(value);
  if (t <= 0)
    return "";
  return t.toFixed(2);
}

/**
 * 订单栏展示份额：只读 RDS（changmen 已处理结果）。
 * 买单 = pfHoldShares = 官网成交 − 官网份额费 − Changmencodefee（买入份额）；
 * 卖单 = 本次卖出份额。
 */
export function resolvePfDisplayShares(row: OrderRow): number | null {
  if (isPfSellOrderListRow(row)) {
    const sold = Number(
      row.PfShares ?? (row as { pfShares?: number }).pfShares,
    );
    if (!Number.isFinite(sold) || sold <= 0.0001)
      return null;
    return sold;
  }

  const hold = Number(
    row.PfHoldShares ?? (row as { pfHoldShares?: number }).pfHoldShares,
  );
  if (Number.isFinite(hold) && hold > 0.0001)
    return hold;

  // 旧单无 hold：仅回退成交份额（不再前端推算手续费）
  const fillShares = Number(
    row.PfShares ?? (row as { pfShares?: number }).pfShares,
  );
  if (!Number.isFinite(fillShares) || fillShares <= 0.0001)
    return null;
  return fillShares;
}

/** 份额展示：持仓两位截断 */
export function pfOrderSharesText(row: OrderRow): string | null {
  const shares = resolvePfDisplayShares(row);
  if (shares == null)
    return null;
  const text = truncateSharesDisplay(shares, 2);
  return text || null;
}

/**
 * 侧栏买入金额 / 回款：CNY 展示（对齐 PM `scaleUsdtToCnyDisplay`）。
 * - 买单：优先名义 PfNotionalUsdt（限价×份额，如 14.12）；无则 BetMoney（用户扣款）
 * - 卖单回款：优先 PfSellProceeds（极少挂在卖行）→ BetMoney 镜像（@deprecated 影子行兜底）
 * 库内为场馆 USDT；展示 × 汇率，勿直接甩裸 U。
 */
export function pfOrderStakeDisplayCny(row: OrderRow): number {
  if (isPfSellOrderListRow(row)) {
    const proceeds = Number(
      row.PfSellProceeds ?? (row as { pfSellProceeds?: number }).pfSellProceeds,
    );
    if (Number.isFinite(proceeds) && proceeds > 0)
      return scaleUsdtToCnyDisplay(proceeds);
    // @deprecated Phase 1 影子卖单行回款镜像
    return scaleUsdtToCnyDisplay(Number(row.BetMoney) || 0);
  }
  const notional = Number(
    row.PfNotionalUsdt ?? (row as { pfNotionalUsdt?: number }).pfNotionalUsdt,
  );
  if (Number.isFinite(notional) && notional > 0)
    return scaleUsdtToCnyDisplay(notional);
  return scaleUsdtToCnyDisplay(Number(row.BetMoney) || 0);
}

/** 侧栏盈亏：USDT Money → CNY（对齐 PM）；卖单不展示（null） */
export function pfOrderProfitDisplayCny(row: OrderRow): number | null {
  if (isPfSellOrderListRow(row))
    return null;
  return scaleUsdtToCnyDisplay(Number(row.Money) || 0);
}

export function pfStakeLabel(row: OrderRow): string {
  return isPfSellOrderListRow(row) ? "回款" : "买入金额";
}

export function pfOrderPriceLabel(row: OrderRow): string {
  return isPfSellOrderListRow(row) ? "卖单卖出价" : "买入价";
}

export function pfOrderSideTagText(row: OrderRow): string | null {
  if (!isPfOrderListRow(row))
    return null;
  return isPfSellOrderListRow(row) ? "卖单" : "买单";
}

/** 成交/限价概率价：库内 PfBookPrice；不再用赔率反推 */
export function resolvePfFillPrice(row: OrderRow): number | null {
  const book = Number(
    row.PfBookPrice ?? (row as { pfBookPrice?: number }).pfBookPrice,
  );
  if (Number.isFinite(book) && book > 0 && book < 1)
    return book;
  return null;
}

export function pfOrderFillPriceText(row: OrderRow): string | null {
  const price = resolvePfFillPrice(row);
  if (price == null)
    return null;
  return formatPolymarketApiDecimal(price);
}

export function pfOrderOddsText(row: OrderRow): string {
  const price = resolvePfFillPrice(row);
  if (price != null)
    return toFixed(truncateOddsTo3(1 / price), 3);
  const odds = Number(row.Odds) || 0;
  if (odds <= 0)
    return "—";
  return toFixed(truncateOddsTo3(odds), 3);
}

export function pfOddsTextFromClobPrice(clob: number): string {
  if (!Number.isFinite(clob) || clob <= 0 || clob >= 1)
    return "—";
  return toFixed(truncateOddsTo3(1 / clob), 3);
}

/**
 * 未结买单按实时价标记浮盈亏（CNY，取整）。
 * 市值 = 持仓份额 × 当前价；成本 = 名义本金（USDT）。
 */
export function pfUnrealizedPnlAtLiveCny(
  row: OrderRow,
  livePrice: number | null | undefined,
): number | null {
  if (!isPfBuyOrderListRow(row))
    return null;
  const live = Number(livePrice);
  if (!(live > 0 && live < 1))
    return null;
  const hold = Number(
    row.PfHoldShares ?? (row as { pfHoldShares?: number }).pfHoldShares,
  );
  const fill = Number(
    row.PfShares ?? (row as { pfShares?: number }).pfShares,
  );
  const shares = hold > 0 ? hold : fill;
  if (!(Number.isFinite(shares) && shares > 0))
    return null;
  const notional = Number(
    row.PfNotionalUsdt ?? (row as { pfNotionalUsdt?: number }).pfNotionalUsdt,
  );
  const cost = Number.isFinite(notional) && notional > 0
    ? notional
    : (Number(row.BetMoney) || 0);
  if (!(cost > 0))
    return null;
  return Math.round(scaleUsdtToCnyDisplay(shares * live - cost));
}

export function pfMoneyText(n: number): string {
  return toFixed(n, 0);
}
