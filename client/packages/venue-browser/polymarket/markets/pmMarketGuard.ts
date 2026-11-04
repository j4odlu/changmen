import { polymarketMarketAssetIds } from "@changmen/shared/pm_market_assets";
import { resolvePolymarketOfficialWinningAssetId } from "../orders/history/orders";
import { parseJsonArray, type PolymarketRawMarket } from "./parse";

const LOSER_PRICE_MAX = 0.10;
const WINNER_PRICE_SOFT = 0.90;

/** CLOB 拒单：市场暂停/关闭，尚未受理订单 */
export const POLYMARKET_TRADING_DISABLED_MESSAGE = "Polymarket 市场已停止交易";
/** 浏览器等 POST ACK 超时；未确认是否送达。不是官方 `sd` 撮合窗。 */
export const POLYMARKET_SUBMIT_TIMEOUT_MESSAGE = "Polymarket 下单请求超时（未确认是否送达）";

function polymarketErrorText(err: unknown): string {
  if (err == null)
    return "";
  if (typeof err === "string")
    return err;
  if (err instanceof Error) {
    const extra = err && typeof err === "object" && "rawText" in err
      ? String((err as { rawText?: unknown }).rawText ?? "")
      : "";
    return `${err.message} ${extra}`.trim();
  }
  if (typeof err === "object") {
    const row = err as Record<string, unknown>;
    return [row.error, row.errorMsg, row.message]
      .filter(v => v != null && String(v).trim())
      .map(v => String(v))
      .join(" ") || JSON.stringify(err);
  }
  return String(err);
}

/** CLOB `{ error: "trading is disabled" }` 或同等 HTTP 片段 */
export function isPolymarketTradingDisabledError(err: unknown): boolean {
  return polymarketErrorText(err).toLowerCase().includes("trading is disabled");
}

export function isPolymarketSubmitTimeoutError(err: unknown): boolean {
  const text = polymarketErrorText(err);
  return /timeout of \d+ms exceeded/i.test(text)
    || /ECONNABORTED|ETIMEDOUT/i.test(text)
    || (/PM API 不可用（Pm_SubmitOrder）/i.test(text) && /timeout/i.test(text));
}

/**
 * 官方 winner 已确认时拒买败方。
 * 另：盘口极冷门时软拒。
 */
export function getPolymarketMarketBlockReason(
  market: PolymarketRawMarket | null | undefined,
  tokenId: string,
  source: "gamma" | "clob" = "gamma",
): string | null {
  if (!market)
    return null;

  // [changmen 扩展] CLOB v1 /markets/:condition 的资产在 tokens，区别于 Gamma。
  // 仅补齐该响应缺省的 CTF 字段；明确的资产字段、V2 和未知版本仍按原规则校验。
  if (source === "clob" && market.version === "v1"
    && market.clobTokenIds == null && market.clob_token_ids == null
    && Array.isArray(market.tokens)) {
    market = { ...market, clobTokenIds: market.tokens.map(token => token?.token_id) };
  }

  // 官方 Market Details：提交前看 active / closed / acceptingOrders
  const accepting = market.acceptingOrders ?? market.accepting_orders;
  const orderBookOn = market.enable_order_book ?? market.enableOrderBook;
  if (market.closed === true || market.archived === true)
    return "Polymarket 市场已关闭";
  if (market.active === false)
    return "Polymarket 市场未开放";
  if (accepting === false || orderBookOn === false)
    return POLYMARKET_TRADING_DISABLED_MESSAGE;
  const asset = String(tokenId || "").trim();
  if (!asset) return null;
  const tokens = polymarketMarketAssetIds(market);
  if (market.version != null && market.version !== "v1" && market.version !== "v2")
    return "Polymarket 市场版本不支持";
  if ((market.version != null || market.positionIds != null || market.position_ids != null)
    && !tokens.includes(asset))
    return "Polymarket 市场交易资产或版本不一致";

  // [changmen 扩展] 价格提前判定不改变现有下单闸；此处仍只认官方赢家。
  const winning = resolvePolymarketOfficialWinningAssetId(market);
  if (winning && winning !== asset)
    return "Polymarket 市场已决出胜负";

  const prices = parseJsonArray(market.outcomePrices ?? market.outcome_prices).map(Number);
  const idx = tokens.indexOf(asset);
  if (idx < 0 || !prices.length)
    return null;

  const myPrice = prices[idx];
  if (Number.isFinite(myPrice) && myPrice <= LOSER_PRICE_MAX) {
    const otherMax = prices.reduce((max, p, i) => (i === idx ? max : Math.max(max, p)), 0);
    if (otherMax >= WINNER_PRICE_SOFT)
      return "Polymarket 盘口显示该结果几乎不可能（可能已结束）";
  }

  return null;
}
