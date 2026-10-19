/**
 * PredictFun 买入盘口工具（浏览器）：限价内 asks + FOK 深度。
 * 与 server pf_orderbook.js 同语义。
 */

import {
  bestAskFromPredictBook,
  bestBidFromPredictBook,
  orderbookForOutcomeBuy,
  type PredictOrderbookData,
} from "./parse";
import type { PredictMarketDetail } from "./api";

export function isPredictYesOutcomeToken(
  tokenId: string,
  outcomes: PredictMarketDetail["outcomes"],
): boolean {
  const tid = String(tokenId ?? "").trim();
  const list = outcomes ?? [];
  if (!tid || !list.length)
    return true;
  const match = list.find(o => String(o?.onChainId ?? "").trim() === tid);
  if (!match)
    return String(list[0]?.onChainId ?? "").trim() === tid;
  const name = String(match.name ?? "").trim().toLowerCase();
  if (name === "yes")
    return true;
  if (name === "no")
    return false;
  const indexSet = Number(match.indexSet);
  if (indexSet === 1)
    return true;
  if (indexSet === 2)
    return false;
  return String(list[0]?.onChainId ?? "").trim() === tid;
}

export function executableBuyBook(
  yesBook: PredictOrderbookData | null | undefined,
  market: PredictMarketDetail | null | undefined,
  tokenId: string,
): PredictOrderbookData {
  const isYes = isPredictYesOutcomeToken(tokenId, market?.outcomes);
  return orderbookForOutcomeBuy(yesBook, {
    isYesOutcome: isYes,
    decimalPrecision: market?.decimalPrecision ?? 2,
  });
}

export function filterAsksByMaxPrice(
  asks: Array<[number, number]> | undefined,
  maxPrice: number,
): Array<[number, number]> {
  return (asks ?? []).filter(([price, size]) => {
    const p = Number(price);
    const s = Number(size);
    return Number.isFinite(p) && p > 0 && p <= maxPrice + 1e-9
      && Number.isFinite(s) && s > 0;
  });
}

/** FOK：限价内 asks 须盖满本金（USDT） */
export function assertPredictFokBuyDepth(
  asks: Array<[number, number]> | undefined,
  apiBetMoney: number,
): void {
  const amount = Number(apiBetMoney);
  if (!Number.isFinite(amount) || amount <= 0)
    throw new Error(`无效买入金额 ${apiBetMoney}`);

  let remaining = amount;
  let available = 0;
  for (const level of asks ?? []) {
    const price = Number(level[0]);
    const size = Number(level[1]);
    if (!(Number.isFinite(price) && price > 0 && price < 1
      && Number.isFinite(size) && size > 0))
      continue;
    const notional = price * size;
    available += notional;
    if (notional + 1e-9 >= remaining)
      return;
    remaining -= notional;
  }

  const availText = Number.isFinite(available) ? available.toFixed(2) : "0";
  throw new Error([
    "Predict.fun FOK 盘口深度不足",
    `- 需要 ${amount} USDT，限价内可立即成交约 ${availText} USDT`,
    "- FOK 要求整笔金额立即成交，否则整单取消。",
  ].join("\n"));
}

export function assertPredictMarketTradable(
  market: PredictMarketDetail | null | undefined,
): void {
  if (!market || typeof market !== "object")
    throw new Error("Predict.fun 市场不存在");

  const marketStatus = String(market.status ?? "").trim().toUpperCase();
  if (marketStatus === "RESOLVED" || marketStatus === "REMOVED" || marketStatus === "PAUSED")
    throw new Error(`Predict.fun 市场不可交易（status=${marketStatus || "?"}）`);

  const trading = String(market.tradingStatus ?? "OPEN").trim().toUpperCase();
  if (trading && trading !== "OPEN" && trading !== "UNPAUSED")
    throw new Error(`Predict.fun 市场不可交易（tradingStatus=${trading}）`);
}

/** 卖出用同一侧盘口（吃 bids） */
export function executableSellBook(
  yesBook: PredictOrderbookData | null | undefined,
  market: PredictMarketDetail | null | undefined,
  tokenId: string,
): PredictOrderbookData {
  return executableBuyBook(yesBook, market, tokenId);
}

/** 卖出：只保留 bid >= minPrice 的档（保护底价） */
export function filterBidsByMinPrice(
  bids: Array<[number, number]> | undefined,
  minPrice?: number,
): Array<[number, number]> {
  const floor = Number(minPrice);
  const useFloor = Number.isFinite(floor) && floor > 0 && floor < 1;
  return (bids ?? []).filter(([price, size]) => {
    const p = Number(price);
    const s = Number(size);
    if (!(Number.isFinite(p) && p > 0 && p < 1 && Number.isFinite(s) && s > 0))
      return false;
    if (useFloor && p + 1e-9 < floor)
      return false;
    return true;
  });
}

export { bestAskFromPredictBook, bestBidFromPredictBook };
