// [changmen 扩展] Diagnostic-only mirror. Exact original function bodies are regression-checked;
// original FOK code is untouched. No HTTP, orders, options mutation or global preference writes.
import type { PolymarketOrderOptions } from "../../../../packages/venue-adapter/polymarket/fok/preflight";
import { truncateOddsTo3 } from "@changmen/shared/odds_format";
import { pmBuyOrderShares } from "../../../../packages/venue-adapter/polymarket/submission/preflight/pmBuyOrderShares";
import { isValidClobPrice } from "../../../../packages/venue-adapter/polymarket/pmDetection";
import { PolymarketPriceAboveDetectionError } from "../../../../packages/venue-adapter/polymarket/pmTokenQuote";
import { isPolymarketPriceOnTick, alignPolymarketPriceToTick, type PolymarketTickSize as TickSize } from "../../../../packages/venue-adapter/polymarket/pmTickPrice";
import { pmFokDepthBufferNeedUsdc as depthNeed, pmFokFillPriceDepthUsdc } from "../../../../packages/venue-adapter/polymarket/pmFokDepthBufferMode";
export interface SimulationInput {
  tokenId: string; detectionOdds: number; apiBetMoney: number; maxPrice: number;
  depth: { enabled: boolean; multiplier: number };
}
interface PolymarketOrderDiagnostic {
  tokenId: string;
  amountUsdc: number;
  displayedOdds: number;
  displayedPrice: number;
  limitPrice?: number;
  minOrderSize: number;
  shares?: number;
  availableUsdc: number;
  asks: PolymarketOrderOptions["asks"];
}

export function simulateExecutableBuy(input: SimulationInput, orderOptions: PolymarketOrderOptions) {
  const { tokenId, detectionOdds, apiBetMoney, maxPrice } = input;
  const getPmFokDepthBufferPrefs = () => input.depth;
  const pmFokDepthBufferNeedUsdc = (amount: number) => depthNeed(amount, input.depth);
function polymarketFokLimitFromDetection(
  maxPrice: number,
  tickSize: TickSize,
  fillPrice: number,
): number {
  const aligned = alignPolymarketPriceToTick(maxPrice, tickSize, "floor");
  const limit = fillPrice > aligned + 1e-12 ? fillPrice : aligned;
  if (!isValidClobPrice(limit) || !isPolymarketPriceOnTick(limit, tickSize) || limit > maxPrice + 1e-12)
    throw new Error(`无效检测价 ${maxPrice}（tick ${tickSize}）`);
  return limit;
}

function fmt(value: number, decimals = 4): string {
  return Number.isFinite(value) ? Number(value.toFixed(decimals)).toString() : "N/A";
}

function asksPreview(asks: PolymarketOrderOptions["asks"]): string {
  if (!asks.length)
    return "无 asks 卖单";
  return asks.slice(0, 5)
    .map((level, index) => `${index + 1}. ${fmt(level.price, 4)} x ${fmt(level.size, 2)} = ${fmt(level.price * level.size, 2)} USDC`)
    .join("\n");
}

function availableUsdc(asks: PolymarketOrderOptions["asks"]): number {
  return asks.reduce((sum, level) => sum + level.price * level.size, 0);
}

function availableUsdcAtPrice(
  asks: PolymarketOrderOptions["asks"],
  maxPrice: number,
): number {
  return availableUsdc(asks.filter(level => level.price <= maxPrice + 1e-9));
}

/** [changmen 扩展] 开：1× 成交价 P 及更优须 ≥ 本金×倍数。关：原 1×。 */
function assertPmFokDepthAtFillPrice(
  bookAsks: PolymarketOrderOptions["asks"],
  amountUsdc: number,
  fillPrice: number,
): void {
  const need = pmFokDepthBufferNeedUsdc(amountUsdc);
  if (need == null)
    return;
  const available = pmFokFillPriceDepthUsdc(bookAsks, fillPrice);
  if (available + 1e-9 >= need)
    return;
  const { multiplier } = getPmFokDepthBufferPrefs();
  throw new Error([
    "Polymarket FOK 盘口深度不足",
    `- 需要 ${fmt(need, 2)} USDC（金额 ${fmt(amountUsdc, 2)} × ${multiplier}）`,
    `- 成交价 ${fmt(fillPrice, 4)} 及更优可立即成交约 ${fmt(available, 2)} USDC`,
  ].join("\n"));
}

function diagnosticLines(diag: PolymarketOrderDiagnostic): string[] {
  const bestAsk = diag.asks[0];
  const lines = [
    "【订单】",
    `- 金额：${fmt(diag.amountUsdc, 2)} USDC`,
    `- 页面赔率：${fmt(diag.displayedOdds, 4)}（价格 ${fmt(diag.displayedPrice, 4)}）`,
    `- tokenId：${diag.tokenId}`,
    "",
    "【盘口】",
    bestAsk
      ? `- 最佳卖价：${fmt(bestAsk.price, 4)}（赔率 ${fmt(1 / bestAsk.price, 4)}），数量 ${fmt(bestAsk.size, 2)}`
      : "- 最佳卖价：无",
    `- 可立即成交：${fmt(diag.availableUsdc, 2)} USDC`,
    `- 最小下单份数：${diag.minOrderSize || "未知"}`,
    "- 前 5 档 asks：",
    asksPreview(diag.asks),
  ];
  if (diag.limitPrice) {
    lines.splice(4, 0, `- FOK 限价：${fmt(diag.limitPrice, 4)}（赔率 ${fmt(1 / diag.limitPrice, 4)}）`);
  }
  if (diag.shares !== undefined) {
    lines.splice(diag.limitPrice ? 5 : 4, 0, `- 预计买入：${fmt(diag.shares, 4)} 份`);
  }
  return lines;
}

function calculateBuyMarketLimitPrice(
  asks: PolymarketOrderOptions["asks"],
  amountUsdc: number,
  minOrderSize: number,
  diagnostic: Omit<PolymarketOrderDiagnostic, "availableUsdc" | "asks">,
  maxPrice?: number,
): number {
  if (!Number.isFinite(amountUsdc) || amountUsdc <= 0)
    throw new Error(`无效买入金额 ${amountUsdc}`);
  const bookAsks = maxPrice != null
    ? asks.filter(level => level.price <= maxPrice + 1e-9)
    : asks;
  const baseDiag = {
    ...diagnostic,
    availableUsdc: availableUsdc(bookAsks),
    asks: bookAsks,
  };
  if (maxPrice != null && !bookAsks.length) {
    const best = asks[0];
    const message = [
      "Polymarket 盘口价高于检测价，预检不通过",
      ...diagnosticLines({
        ...baseDiag,
        availableUsdc: availableUsdc(asks),
        asks,
      }),
      "",
      "【说明】",
      best
        ? `- 最佳卖价 ${fmt(best.price, 4)}（赔率 ${fmt(1 / best.price, 4)}）高于检测价 ${fmt(maxPrice, 4)}（赔率 ${fmt(diagnostic.displayedOdds, 4)}）`
        : "- 盘口无卖单",
      "- 不会在高于套利检测价的位置 FOK 成交。",
    ].join("\n");
    if (best && Number.isFinite(best.price) && best.price > 0 && best.price < 1)
      throw new PolymarketPriceAboveDetectionError(message, best.price, maxPrice);
    throw new Error(message);
  }
  let remaining = amountUsdc;
  for (const level of bookAsks) {
    const notional = level.price * level.size;
    if (notional >= remaining) {
      const shares = amountUsdc / level.price;
      if (minOrderSize > 0 && shares < minOrderSize) {
        const minAmount = minOrderSize * level.price;
        throw new Error([
          "Polymarket 下单金额低于最小份数",
          ...diagnosticLines({ ...baseDiag, limitPrice: level.price, shares }),
          "",
          "【建议】",
          `- 当前盘口至少约 ${fmt(minAmount, 2)} USDC 才能买满 ${minOrderSize} 份。`,
        ].join("\n"));
      }
      assertPmFokDepthAtFillPrice(bookAsks, amountUsdc, level.price);
      return level.price;
    }
    remaining -= notional;
  }
  throw new Error([
    "Polymarket FOK 盘口深度不足",
    ...diagnosticLines(baseDiag),
    "",
    "【说明】",
    "- FOK 要求整笔金额立即成交，否则整单取消。",
  ].join("\n"));
}
  if (!maxPrice || maxPrice <= 0 || maxPrice >= 1)
    throw new Error(`无效检测价 ${maxPrice}（赔率 ${detectionOdds}）`);
  const price = calculateBuyMarketLimitPrice(orderOptions.asks, apiBetMoney, orderOptions.minOrderSize,
    { tokenId, amountUsdc: apiBetMoney, displayedOdds: detectionOdds, displayedPrice: maxPrice, minOrderSize: orderOptions.minOrderSize }, maxPrice);
  const limitPrice = polymarketFokLimitFromDetection(maxPrice, orderOptions.tickSize, price);
  const shares = pmBuyOrderShares(apiBetMoney, limitPrice, orderOptions.tickSize);
  if (!Number.isFinite(shares) || shares < orderOptions.minOrderSize)
    throw new Error("Polymarket 下单金额低于最小份数（实际签单限价）");
  return Object.freeze({ price, bookOdds: truncateOddsTo3(1 / price), limitPrice, shares,
    depthAvailableAtCap: availableUsdcAtPrice(orderOptions.asks, maxPrice),
    depthNeedUsdc: pmFokDepthBufferNeedUsdc(apiBetMoney) ?? apiBetMoney });
}
