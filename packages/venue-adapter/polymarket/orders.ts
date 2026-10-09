import type { VenueOrder } from "../contract";
import { sortVenueOrdersNewestFirst } from "../contract";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { getExchange, Currency, scaleUsdtToCnyDisplay } from "@changmen/shared/currency";
import { PLATFORMS } from "../shared/platforms";
import { POLYMARKET_CLOB_API, POLYMARKET_GAMMA_API } from "./api";
import {
  collectPolymarketUserAddressesFromAccount,
  normalizeEthAddress,
} from "./l2Auth";
import { polymarketOrderContextFromMarket, parseJsonArray, type PolymarketRawMarket } from "./parse";
import { hasOpenPolymarketPosition, resolveBuyStakeUsdc, resolvePmFillShares, resolvePmRemainingShares, stripPolymarketSellOrders } from "./pmLogicalPosition";
import {
  markPolymarketOrdersSynced,
  PM_ORDER_FULL_LOOKBACK_MS,
  resolvePolymarketTradeLookbackMs,
} from "./pmOrderSync";
import { applyPolymarketOrderOrigins, isPolymarketChangmenOrder } from "./pmOrigin";
import { enrichPolymarketBuyOrdersWithFees } from "./pmFee";
import { polymarketPluginGet } from "./transport";
import { pmGetTrades } from "./pmClientApi";
import { polymarketFailedBuyTradeRow } from "./tradeFailure";

const TOKEN_MICRO = 1_000_000;
/** 订单 sync + 迟结算缓冲（Phase 2b） */
const ORDER_LOOKBACK_MS = PM_ORDER_FULL_LOOKBACK_MS;
const MAX_TRADE_PAGES = 5;
/** CLOB 口径 USDC → 侧栏/DB CNY 展示（整条链路只 scale 一次） */
export function scalePolymarketVenueOrdersForDisplay(orders: VenueOrder[]): VenueOrder[] {
  return orders.map(order => ({
    ...order,
    betMoney: scaleUsdtToCnyDisplay(order.betMoney),
    reward: scaleUsdtToCnyDisplay(order.reward),
    money: scaleUsdtToCnyDisplay(order.money),
  }));
}

export interface PolymarketTradeRow {
  id?: string;
  taker_order_id?: string;
  market?: string;
  asset_id?: string;
  side?: string;
  size?: string | number;
  price?: string | number;
  status?: string;
  match_time?: string | number;
  outcome?: string;
  bucket_index?: number;
  trader_side?: string;
  type?: string;
  owner?: string;
  maker_address?: string;
  /** 链上成交 tx；与 Data API `/activity.transactionHash` 1:1 对齐 */
  transaction_hash?: string;
  maker_orders?: PolymarketMakerOrderRow[];
}

/** 按 CLOB orderId 收集 transaction_hash（多 bucket 可多笔） */
export function collectPolymarketOrderTxHashes(
  trades: PolymarketTradeRow[] | null | undefined,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (!Array.isArray(trades))
    return map;
  for (const trade of trades) {
    const orderId = String(trade.taker_order_id ?? "").trim().toLowerCase();
    const tx = String(trade.transaction_hash ?? "").trim().toLowerCase();
    if (!orderId || !/^0x[0-9a-f]{64}$/.test(tx))
      continue;
    const list = map.get(orderId) ?? [];
    if (!list.includes(tx))
      list.push(tx);
    map.set(orderId, list);
  }
  return map;
}

export interface PolymarketMakerOrderRow {
  order_id?: string;
  owner?: string;
  maker_address?: string;
  matched_amount?: string | number;
  price?: string | number;
  outcome?: string;
  asset_id?: string;
  side?: string;
}

function unwrapGammaMarkets(data: unknown): PolymarketRawMarket[] {
  if (Array.isArray(data))
    return data as PolymarketRawMarket[];
  const wrapped = data as { markets?: unknown; data?: unknown };
  if (Array.isArray(wrapped.markets))
    return wrapped.markets as PolymarketRawMarket[];
  if (Array.isArray(wrapped.data))
    return wrapped.data as PolymarketRawMarket[];
  return [];
}

function normalizeConditionId(id: string | undefined | null): string {
  return String(id ?? "").trim().toLowerCase();
}

function marketConditionId(market: PolymarketRawMarket): string {
  return normalizeConditionId(
    String(market.condition_id ?? market.conditionId ?? market.market ?? market.id ?? ""),
  );
}

/** 已成交 trade 是否计入订单列表（含 MINED，排除 FAILED/CANCEL） */
export function isPolymarketTradeConfirmed(status: string | undefined): boolean {
  const normalized = String(status ?? "").trim().toUpperCase();
  if (!normalized) return false;
  if (normalized.includes("FAILED") || normalized.includes("CANCEL")) return false;
  return normalized.includes("CONFIRMED")
    || normalized.includes("MATCHED")
    || normalized.includes("MINED")
    || normalized.includes("RETRYING");
}

/** CLOB REST 多为 6 位 micro；WS/部分响应为可读份数 */
export function polymarketBuyStakeUsdc(sizeRaw: string | number | undefined, price: number): number {
  const size = Number(sizeRaw);
  if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(price) || price <= 0)
    return 0;
  if (size >= 10_000)
    return (size / TOKEN_MICRO) * price;
  return size * price;
}

/** 成交份数（CLOB REST 小数份数 vs micro） */
export function polymarketShareCount(sizeRaw: string | number | undefined): number {
  const size = Number(sizeRaw);
  if (!Number.isFinite(size) || size <= 0) return 0;
  if (size >= 10_000) return size / TOKEN_MICRO;
  return size;
}

/** CLOB 响应/余额 micro 金额 → USDC（≥10000 视为 6 位 micro） */
export function parsePolymarketMicroUsdc(raw: string | number | undefined): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0)
    return 0;
  const usdc = value >= 10_000 ? value / TOKEN_MICRO : value;
  return Math.round(usdc * 10000) / 10000;
}

function round4Fill(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** BUY POST：makingAmount=USDC micro，takingAmount=份数 micro（对齐 bet.test / Polymarket 文档） */
export function parsePolymarketBuyOrderFill(
  response: { makingAmount?: string | number; takingAmount?: string | number } | null | undefined,
): { stakeUsdc: number; shares: number } {
  const stakeUsdc = parsePolymarketMicroUsdc(response?.makingAmount);
  const shares = polymarketShareCount(response?.takingAmount);
  if (stakeUsdc > 0 && shares > 0) {
    const impliedPrice = stakeUsdc / shares;
    if (impliedPrice > 0 && impliedPrice < 1)
      return { stakeUsdc: round4Fill(stakeUsdc), shares: round4Fill(shares) };
  }
  return {
    stakeUsdc: stakeUsdc > 0 ? round4Fill(stakeUsdc) : 0,
    shares: shares > 0 ? round4Fill(shares) : 0,
  };
}

/** SELL POST：makingAmount=份数 micro，takingAmount=USDC micro */
export function parsePolymarketSellOrderFill(
  response: { makingAmount?: string | number; takingAmount?: string | number } | null | undefined,
): { proceedsUsdc: number; sharesSold: number } {
  const proceedsUsdc = parsePolymarketMicroUsdc(response?.takingAmount);
  // 份数保留 CLOB 原始精度，勿 round4（侧栏要展示订单原始份额）
  const sharesSold = polymarketShareCount(response?.makingAmount);
  if (proceedsUsdc > 0 && sharesSold > 0) {
    const impliedPrice = proceedsUsdc / sharesSold;
    if (impliedPrice > 0 && impliedPrice < 1)
      return { proceedsUsdc: round4Fill(proceedsUsdc), sharesSold };
  }
  return {
    proceedsUsdc: proceedsUsdc > 0 ? round4Fill(proceedsUsdc) : 0,
    sharesSold: sharesSold > 0 ? sharesSold : 0,
  };
}

/** /data/trades 成交 leg → 份数 + USDC 名义 */
export function polymarketTradeFillAmounts(
  trade: PolymarketTradeRow,
): { shares: number; usdc: number } {
  // 份数保留原始精度（展示用）；USDC 仍 round4
  const shares = polymarketShareCount(trade.size);
  const usdc = polymarketTradeNotionalUsdc(trade);
  return { shares, usdc };
}

/** POST 响应优先，/data/trades 兜底（拒单检测 / 卖出归因） */
export async function resolvePolymarketBuyFill(
  account: PlatformAccount,
  orderId: string,
  postResponse: { makingAmount?: string | number; takingAmount?: string | number } | null | undefined,
  lookbackMs = 10 * 60 * 1000,
): Promise<{ stakeUsdc: number; shares: number }> {
  const fromPost = parsePolymarketBuyOrderFill(postResponse);
  if (fromPost.stakeUsdc > 0 && fromPost.shares > 0)
    return fromPost;

  const trade = await fetchPolymarketConfirmedTradeForOrder(account, orderId, lookbackMs, "BUY");
  if (trade) {
    const { shares, usdc } = polymarketTradeFillAmounts(trade);
    if (usdc > 0 && shares > 0)
      return { stakeUsdc: usdc, shares };
  }

  return fromPost;
}

function waitMs(ms: number) {
  return new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });
}

/** POST 响应优先，/data/trades 兜底 */
export async function resolvePolymarketSellFill(
  account: PlatformAccount,
  orderId: string,
  postResponse: { makingAmount?: string | number; takingAmount?: string | number } | null | undefined,
  lookbackMs = 10 * 60 * 1000,
): Promise<{ proceedsUsdc: number; sharesSold: number }> {
  const fromPost = parsePolymarketSellOrderFill(postResponse);
  if (fromPost.proceedsUsdc > 0 && fromPost.sharesSold > 0)
    return fromPost;

  const trade = await fetchPolymarketConfirmedTradeForOrder(account, orderId, lookbackMs, "SELL");
  if (trade) {
    const { shares, usdc } = polymarketTradeFillAmounts(trade);
    if (usdc > 0 && shares > 0)
      return { proceedsUsdc: usdc, sharesSold: shares };
  }

  return fromPost;
}

export const POLYMARKET_SELL_FILL_RETRY_OPTS = {
  lookbackMs: 10 * 60 * 1000,
  retryMs: 2_000,
  maxRetries: 15,
} as const;

/**
 * 体育 delayed 卖单：POST 无 making/taking，trades 也可能滞后于 order 端点。
 * settle 后再轮询 trades；仍缺时用 orderRow.size_matched 补份数。
 */
export async function resolvePolymarketSellFillWithRetry(
  account: PlatformAccount,
  orderId: string,
  postResponse: { makingAmount?: string | number; takingAmount?: string | number } | null | undefined,
  opts?: {
    lookbackMs?: number;
    retryMs?: number;
    maxRetries?: number;
    orderRow?: { size_matched?: string | number } | null;
  },
): Promise<{ proceedsUsdc: number; sharesSold: number }> {
  const fromPost = parsePolymarketSellOrderFill(postResponse);
  if (fromPost.proceedsUsdc > 0 && fromPost.sharesSold > 0)
    return fromPost;

  const lookbackMs = opts?.lookbackMs ?? POLYMARKET_SELL_FILL_RETRY_OPTS.lookbackMs;
  const retryMs = opts?.retryMs ?? POLYMARKET_SELL_FILL_RETRY_OPTS.retryMs;
  const maxRetries = opts?.maxRetries ?? POLYMARKET_SELL_FILL_RETRY_OPTS.maxRetries;

  for (let i = 0; i < maxRetries; i++) {
    const trade = await fetchPolymarketConfirmedTradeForOrder(account, orderId, lookbackMs, "SELL");
    if (trade) {
      const { shares, usdc } = polymarketTradeFillAmounts(trade);
      if (usdc > 0 && shares > 0)
        return { proceedsUsdc: usdc, sharesSold: shares };
    }
    if (i < maxRetries - 1)
      await waitMs(retryMs);
  }

  const rowShares = polymarketShareCount(opts?.orderRow?.size_matched);
  if (rowShares > 0 && fromPost.proceedsUsdc > 0)
    return { proceedsUsdc: fromPost.proceedsUsdc, sharesSold: rowShares };

  return {
    proceedsUsdc: fromPost.proceedsUsdc > 0 ? fromPost.proceedsUsdc : 0,
    sharesSold: rowShares > 0 ? rowShares : fromPost.sharesSold,
  };
}

function gammaOutcomePrices(market: PolymarketRawMarket): number[] {
  return parseJsonArray(market.outcomePrices ?? market.outcome_prices).map(Number);
}

function gammaTokenIds(market: PolymarketRawMarket): string[] {
  return parseJsonArray(market.clobTokenIds ?? market.clob_token_ids);
}

/** outcomePrices 贴端判定阈值（启发式结算；卖出按钮仍显示） */
const WINNER_PRICE_MIN = 0.99;

/** outcomePrices ≥ WINNER_PRICE_MIN 的赢家下标；无则 -1 */
export function findPolymarketWinnerIndex(prices: number[]): number {
  for (let i = 0; i < prices.length; i++) {
    const price = prices[i];
    if (Number.isFinite(price) && price >= WINNER_PRICE_MIN)
      return i;
  }
  return -1;
}

export type PolymarketSettlementKind = "official" | "price";

export type PolymarketSettlementResolution = {
  winningAssetId: string;
  /** official：隐藏卖出；price：判赢但保留卖出 */
  kind: PolymarketSettlementKind;
};

/**
 * 官方结算：CLOB `tokens[].winner === true` 的 token_id。
 */
export function resolvePolymarketOfficialWinningAssetId(
  market: PolymarketRawMarket | undefined,
): string | null {
  const tokens = market?.tokens;
  if (!Array.isArray(tokens) || !tokens.length) return null;
  const winning = tokens.find(t => t?.winner === true);
  const id = String(winning?.token_id ?? "").trim();
  return id || null;
}

/**
 * 解析赢家 token：优先官方 `tokens[].winner`，否则 outcomePrices ≥ 0.99。
 */
export function resolvePolymarketSettlement(
  market: PolymarketRawMarket | undefined,
): PolymarketSettlementResolution | null {
  if (!market) return null;
  const official = resolvePolymarketOfficialWinningAssetId(market);
  if (official)
    return { winningAssetId: official, kind: "official" };

  const prices = gammaOutcomePrices(market);
  const idx = findPolymarketWinnerIndex(prices);
  if (idx < 0) return null;
  const id = String(gammaTokenIds(market)[idx] ?? "").trim();
  if (!id) return null;
  return { winningAssetId: id, kind: "price" };
}

/** 市场是否已可结算（官方 winner 或价格贴端） */
export function isPolymarketMarketResolved(market: PolymarketRawMarket | undefined): boolean {
  return resolvePolymarketSettlement(market) != null;
}

/** 已 resolve 市场的赢家 token id */
export function resolvePolymarketWinningAssetId(market: PolymarketRawMarket | undefined): string | null {
  return resolvePolymarketSettlement(market)?.winningAssetId ?? null;
}

function tradeHeldAssetId(trade: PolymarketTradeRow, market?: PolymarketRawMarket): string {
  const assetId = String(trade.asset_id ?? "").trim();
  if (assetId) return assetId;
  const outcome = String(trade.outcome ?? "").trim();
  if (!market || !outcome) return "";
  const outcomes = parseJsonArray(market.outcomes);
  const idx = outcomes.findIndex(name => name.trim() === outcome);
  if (idx < 0) return "";
  return gammaTokenIds(market)[idx] ?? "";
}

/**
 * 持有买单结算 → win/lose + money/reward；并始终写入 pmMatchResult（赛果）。
 * - official：`pmSellState=settled`（侧栏隐藏卖出）；已 closed/partial 不改卖出状态
 * - price（≥0.99）：判赢/输但保持可卖（不写 settled）
 * - 已卖光（剩余份额≈0）：只写 pmMatchResult，不动 status/money（盈亏已在卖出路径）
 * 已部分卖出时按剩余份数/剩余本金计盈亏，避免用满仓份额虚增。
 */
export function applyPolymarketSettlement(
  order: VenueOrder,
  trade: PolymarketTradeRow,
  market?: PolymarketRawMarket,
): VenueOrder {
  const resolved = resolvePolymarketSettlement(market);
  if (!resolved) return order;

  const heldAssetId = tradeHeldAssetId(trade, market);
  if (!heldAssetId) return order;

  const matchResult: "win" | "lose" = heldAssetId === resolved.winningAssetId ? "win" : "lose";

  const fillShares = Number(order.pmShares) > 0.0001
    ? Number(order.pmShares)
    : polymarketShareCount(trade.size);
  const attributed = Number(order.pmAttributedSellShares) || 0;
  const trackedPartial = attributed > 0
    || order.pmSellState === "partial"
    || order.pmSellState === "closed";
  const shares = trackedPartial
    ? Math.max(0, fillShares - attributed)
    : polymarketShareCount(trade.size);
  const stake = Number(order.pmStakeUsdc) > 0
    ? Number(order.pmStakeUsdc)
    : order.betMoney;

  const nextSellState = resolved.kind === "official"
    ? (order.pmSellState === "closed" ? "closed" : "settled")
    : (order.pmSellState === "settled" ? "settled" : (order.pmSellState ?? "open"));

  const base: VenueOrder = {
    ...order,
    pmMatchResult: matchResult,
    pmSellState: nextSellState,
  };

  // 已卖光：赛果独立落库，不改盈亏字段
  if (shares <= 0.0001 || stake <= 0)
    return base;

  if (matchResult === "win") {
    const reward = Math.round(shares * 10000) / 10000;
    const money = Math.round((reward - stake) * 10000) / 10000;
    return { ...base, status: "win", reward, money };
  }

  return { ...base, status: "lose", reward: 0, money: -stake };
}

/**
 * MAKER 撮合里 maker_orders 含对手挂单；只保留 maker_address / owner 属于本账户的腿。
 * userAddresses 为空时不做地址过滤（单测兼容旧 payload）。
 */
export function isUserMakerOrderLeg(
  mo: PolymarketMakerOrderRow,
  trade: PolymarketTradeRow,
  userAddresses?: ReadonlySet<string>,
): boolean {
  if (!userAddresses || userAddresses.size === 0)
    return true;

  const moMaker = normalizeEthAddress(mo.maker_address);
  if (moMaker)
    return userAddresses.has(moMaker);

  const moOwner = String(mo.owner ?? "").trim();
  const tradeOwner = String(trade.owner ?? "").trim();
  if (moOwner && tradeOwner)
    return moOwner === tradeOwner;

  return false;
}

/** trade 是否关联指定 CLOB orderId（taker 或 maker_orders） */
export function polymarketTradeRefsOrderId(trade: PolymarketTradeRow, orderId: string): boolean {
  const id = String(orderId ?? "").trim().toLowerCase();
  if (!id)
    return false;
  if (String(trade.taker_order_id ?? "").trim().toLowerCase() === id)
    return true;
  const makers = trade.maker_orders;
  if (!Array.isArray(makers))
    return false;
  return makers.some(mo => String(mo.order_id ?? "").trim().toLowerCase() === id);
}

/** 成交 USDC 名义（买=成本，卖=回款） */
export function polymarketTradeNotionalUsdc(trade: PolymarketTradeRow): number {
  const price = Number(trade.price);
  if (!Number.isFinite(price) || price <= 0)
    return 0;
  return Math.round(polymarketBuyStakeUsdc(trade.size, price) * 10000) / 10000;
}

/** 近窗内按 orderId 查成交；拒单核验可显式启用唯一 BUY taker trade 的 FAILED 证据。 */
export async function fetchPolymarketConfirmedTradeForOrder(
  account: PlatformAccount,
  orderId: string,
  lookbackMs = 10 * 60 * 1000,
  side: "BUY" | "SELL" = "BUY",
  strict = false,
  includeFailedBuy = false,
): Promise<PolymarketTradeRow | null> {
  const id = String(orderId ?? "").trim();
  if (!id)
    return null;
  const gateway = account.gateway || POLYMARKET_CLOB_API;
  const afterSec = Math.floor((Date.now() - lookbackMs) / 1000);
  const userAddresses = collectPolymarketUserAddressesFromAccount(account);
  let rawTrades: PolymarketTradeRow[];
  try {
    rawTrades = await fetchTradesSince(account, gateway, afterSec, strict);
  }
  catch (error) {
    if (strict)
      throw error;
    return null;
  }
  const flattened = flattenPolymarketTrades(rawTrades, userAddresses);
  const wantSide = side.toUpperCase();
  if (includeFailedBuy && wantSide === "BUY") {
    // 唯一性按原始 tradeId 核对，maker_orders 多条并不等于多笔 trade。
    const related = rawTrades.filter(trade => polymarketTradeRefsOrderId(trade, id));
    const ids = related.map(trade => String(trade.id ?? "").trim());
    if (ids.every(Boolean) && !related.some(trade => /^(TRADE_STATUS_)?CONFIRMED$/i.test(String(trade.status ?? "").trim()))) {
      const failed = related.find(trade => polymarketFailedBuyTradeRow(trade, id, ids));
      if (failed)
        return failed;
    }
  }
  for (const trade of flattened) {
    if (!polymarketTradeRefsOrderId(trade, id))
      continue;
    if (String(trade.side ?? "").trim().toUpperCase() !== wantSide)
      continue;
    if (!isPolymarketTradeConfirmed(String(trade.status ?? "")))
      continue;
    return trade;
  }
  return null;
}

/** MAKER 成交在 maker_orders；TAKER 用 taker_order_id */
export function flattenPolymarketTrades(
  trades: PolymarketTradeRow[],
  userAddresses?: ReadonlySet<string>,
): PolymarketTradeRow[] {
  const out: PolymarketTradeRow[] = [];
  for (const trade of trades) {
    const role = String(trade.trader_side ?? trade.type ?? "").trim().toUpperCase();
    if (role.includes("MAKER") && Array.isArray(trade.maker_orders) && trade.maker_orders.length) {
      for (const mo of trade.maker_orders) {
        if (!isUserMakerOrderLeg(mo, trade, userAddresses))
          continue;
        const orderId = String(mo.order_id ?? "").trim();
        if (!orderId) continue;
        out.push({
          ...trade,
          taker_order_id: orderId,
          size: mo.matched_amount ?? trade.size,
          price: mo.price ?? trade.price,
          outcome: mo.outcome ?? trade.outcome,
          asset_id: mo.asset_id ?? trade.asset_id,
          side: mo.side ?? trade.side ?? "BUY",
        });
      }
      continue;
    }
    const orderId = String(trade.taker_order_id ?? "").trim();
    if (orderId)
      out.push(trade);
  }
  return out;
}

/** 合并后 price 保留精度（与 CLOB 小数价一致） */
function formatPolymarketVwapPrice(notionalUsdc: number, shares: number): string {
  if (!Number.isFinite(notionalUsdc) || !Number.isFinite(shares) || shares <= 0 || notionalUsdc <= 0)
    return "";
  const vwap = Math.round((notionalUsdc / shares) * 1_000_000) / 1_000_000;
  return String(vwap);
}

/** 同一 taker_order_id 多 bucket 合并；price 为各腿 USDC 加权均价（VWAP） */
export function aggregatePolymarketTrades(trades: PolymarketTradeRow[]): PolymarketTradeRow[] {
  const byOrder = new Map<string, PolymarketTradeRow & { _sizeSum: number; _notionalSum: number }>();
  for (const trade of trades) {
    if (String(trade.side ?? "").trim().toUpperCase() !== "BUY") continue;
    if (!isPolymarketTradeConfirmed(String(trade.status ?? ""))) continue;
    const orderId = String(trade.taker_order_id ?? "").trim();
    if (!orderId) continue;

    const size = Number(trade.size) || 0;
    const price = Number(trade.price);
    const notional = Number.isFinite(price) && price > 0
      ? polymarketBuyStakeUsdc(trade.size, price)
      : 0;
    const matchSec = Number(trade.match_time) || 0;
    const existing = byOrder.get(orderId);
    if (!existing) {
      byOrder.set(orderId, {
        ...trade,
        taker_order_id: orderId,
        _sizeSum: size,
        _notionalSum: notional,
      });
      continue;
    }
    existing._sizeSum += size;
    existing._notionalSum += notional;
    if (matchSec >= (Number(existing.match_time) || 0))
      existing.match_time = trade.match_time;
  }

  return [...byOrder.values()].map(({ _sizeSum, _notionalSum, ...rest }) => {
    const shares = polymarketShareCount(_sizeSum);
    const vwapPrice = formatPolymarketVwapPrice(_notionalSum, shares);
    return {
      ...rest,
      size: String(_sizeSum),
      ...(vwapPrice ? { price: vwapPrice } : {}),
    };
  });
}

/** 同一 taker_order_id 多 bucket 合并 SELL */
export function aggregatePolymarketSellTrades(trades: PolymarketTradeRow[]): PolymarketTradeRow[] {
  const byOrder = new Map<string, PolymarketTradeRow & { _sizeSum: number; _notionalSum: number }>();
  for (const trade of trades) {
    if (String(trade.side ?? "").trim().toUpperCase() !== "SELL")
      continue;
    if (!isPolymarketTradeConfirmed(String(trade.status ?? "")))
      continue;
    const orderId = String(trade.taker_order_id ?? "").trim();
    if (!orderId)
      continue;

    const size = Number(trade.size) || 0;
    const price = Number(trade.price);
    const shareSize = polymarketShareCount(size);
    const notional = Number.isFinite(price) && price > 0 && shareSize > 0
      ? round4(shareSize * price)
      : 0;
    const matchSec = Number(trade.match_time) || 0;
    const existing = byOrder.get(orderId);
    if (!existing) {
      byOrder.set(orderId, {
        ...trade,
        taker_order_id: orderId,
        _sizeSum: size,
        _notionalSum: notional,
      });
      continue;
    }
    existing._sizeSum += size;
    existing._notionalSum += notional;
    if (matchSec >= (Number(existing.match_time) || 0))
      existing.match_time = trade.match_time;
  }

  return [...byOrder.values()].map(({ _sizeSum, _notionalSum, ...rest }) => {
    const shares = polymarketShareCount(_sizeSum);
    const vwapPrice = formatPolymarketVwapPrice(_notionalSum, shares);
    return {
      ...rest,
      size: String(_sizeSum),
      ...(vwapPrice ? { price: vwapPrice } : {}),
    };
  });
}

export function mapPolymarketTradeToVenueOrder(
  trade: PolymarketTradeRow,
  market?: PolymarketRawMarket,
): VenueOrder | null {
  const orderId = String(trade.taker_order_id ?? trade.id ?? "").trim();
  if (!orderId) return null;

  const price = Number(trade.price);
  const sizeRaw = trade.size;
  if (!Number.isFinite(price) || price <= 0 || price >= 1) return null;

  const betMoney = Math.round(polymarketBuyStakeUsdc(sizeRaw, price) * 10000) / 10000;
  if (betMoney <= 0) return null;

  const odds = Math.round((1 / price) * 10000) / 10000;
  const shares = polymarketShareCount(sizeRaw);
  if (shares <= 0)
    return null;
  const pmTokenId = tradeHeldAssetId(trade, market);
  const ctx = market
    ? polymarketOrderContextFromMarket(market)
    : { game: "", match: "", bet: "" };
  const marketId = String(trade.market ?? "").trim();
  const match = ctx.match || (marketId ? `${marketId.slice(0, 10)}…` : "");

  const unsettled: VenueOrder = {
    provider: PLATFORMS.Polymarket,
    orderId,
    odds,
    createAt: (Number(trade.match_time) || 0) * 1000,
    betMoney,
    reward: Math.round(betMoney * odds * 10000) / 10000,
    money: 0,
    status: "none",
    game: ctx.game,
    match,
    bet: ctx.bet,
    item: String(trade.outcome ?? "").trim(),
    pmTokenId: pmTokenId || undefined,
    pmShares: shares,
    pmFillPrice: price,
    pmStakeUsdc: betMoney,
    pmConditionId: marketId || undefined,
    pmSide: "buy",
    pmSellState: "open",
  };
  return applyPolymarketSettlement(unsettled, trade, market);
}

/** SELL 成交 → 独立卖单（盈亏由 reconcilePolymarketBuySellOrders 填） */
export function mapPolymarketSellTradeToVenueOrder(
  trade: PolymarketTradeRow,
  market?: PolymarketRawMarket,
): VenueOrder | null {
  const orderId = String(trade.taker_order_id ?? trade.id ?? "").trim();
  if (!orderId)
    return null;

  const price = Number(trade.price);
  const sizeRaw = trade.size;
  if (!Number.isFinite(price) || price <= 0 || price >= 1)
    return null;

  const shares = polymarketShareCount(sizeRaw);
  if (shares <= 0)
    return null;

  const odds = Math.round((1 / price) * 10000) / 10000;
  const proceedsUsdc = round4(polymarketBuyStakeUsdc(sizeRaw, price));
  const pmTokenId = tradeHeldAssetId(trade, market);
  const ctx = market
    ? polymarketOrderContextFromMarket(market)
    : { game: "", match: "", bet: "" };
  const marketId = String(trade.market ?? "").trim();
  const match = ctx.match || (marketId ? `${marketId.slice(0, 10)}…` : "");
  const item = String(trade.outcome ?? "").trim();

  return {
    provider: PLATFORMS.Polymarket,
    orderId,
    odds,
    createAt: (Number(trade.match_time) || 0) * 1000,
    betMoney: proceedsUsdc,
    reward: 0,
    money: 0,
    status: "none",
    game: ctx.game,
    match,
    bet: ctx.bet,
    item: item ? `平仓 ${item}` : "平仓",
    pmTokenId: pmTokenId || undefined,
    pmShares: shares,
    pmFillPrice: price,
    pmStakeUsdc: 0,
    pmConditionId: marketId || undefined,
    pmSide: "sell",
    pmOrigin: "external",
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** 同 token 卖单份额与买单剩余份额匹配容差 */
const PM_SELL_SHARE_MATCH_EPS = 0.05;

type PmReconcileBuy = VenueOrder & {
  _fillShares: number;
  _remainingShares: number;
  _remainingStake: number;
  /** 仅卖出已实现盈亏累加器；不含 0.99/Gamma 纸面 money */
  _realizedMoney: number;
  _realizedPnlUsdc: number;
};

/** 卖单 → 对应买单：changmen 用 persist 写入的 pmBuyOrderId；官网卖单按份额匹配 */
function findBuyForPolymarketSell(
  sell: VenueOrder,
  buys: PmReconcileBuy[],
  buyById: Map<string, PmReconcileBuy>,
): PmReconcileBuy | undefined {
  const sharesSold = Number(sell.pmShares) || 0;
  if (sharesSold <= 0)
    return undefined;

  if (sell.pmOrigin === "changmen" && sell.pmBuyOrderId) {
    const linked = buyById.get(sell.pmBuyOrderId);
    if (linked)
      return linked;
  }

  const token = String(sell.pmTokenId ?? "");
  const candidates = buys
    .filter(b => String(b.pmTokenId ?? "") === token && b._remainingShares > 0.0001)
    .sort((a, b) => a.createAt - b.createAt || a.orderId.localeCompare(b.orderId));

  if (!candidates.length)
    return undefined;

  const exact = candidates.find(b =>
    Math.abs(b._remainingShares - sharesSold) <= PM_SELL_SHARE_MATCH_EPS,
  );
  if (exact)
    return exact;

  return candidates.find(b => b._remainingShares + PM_SELL_SHARE_MATCH_EPS >= sharesSold)
    ?? candidates[0];
}

/** 卖单绑定买单并扣减买单份额；changmen 行不参与匹配（persist 已写 pmBuyOrderId） */
export function reconcilePolymarketBuySellOrders(orders: VenueOrder[]): VenueOrder[] {
  const changmen = orders.filter(o => o.pmOrigin === "changmen");
  const external = orders.filter(o => o.pmOrigin !== "changmen");
  if (!external.length)
    return sortVenueOrdersNewestFirst(changmen);
  const reconciled = reconcileExternalPolymarketOrders(external);
  return sortVenueOrdersNewestFirst([...changmen, ...reconciled]);
}

function reconcileExternalPolymarketOrders(orders: VenueOrder[]): VenueOrder[] {
  const buys: PmReconcileBuy[] = orders
    .filter(o => o.pmSide !== "sell")
    .map((o) => {
      const attr = Number(o.pmAttributedSellShares) || 0;
      const hasPriorSell = attr > 0.0001
        || o.pmSellState === "partial"
        || o.pmSellState === "closed";
      // 无卖出归因时 money 可能是 0.99/Gamma 纸面盈亏，不纳入卖出累加
      const realized = hasPriorSell ? (Number(o.money) || 0) : 0;
      const realizedPnl = hasPriorSell ? (Number(o.pmRealizedPnlUsdc) || 0) : 0;
      return {
        ...o,
        pmSide: o.pmSide ?? "buy" as const,
        _fillShares: Number(o.pmShares) || 0,
        _remainingShares: resolvePmRemainingShares(o),
        _remainingStake: resolveBuyStakeUsdc(o),
        _realizedMoney: realized,
        _realizedPnlUsdc: realizedPnl,
      };
    });
  const sellCopies = orders
    .filter(o => o.pmSide === "sell")
    .map(o => ({ ...o }))
    .sort((a, b) => a.createAt - b.createAt || a.orderId.localeCompare(b.orderId));

  const buyById = new Map(buys.map(b => [b.orderId, b]));

  for (const sell of sellCopies) {
    if (sell.pmOrigin !== "changmen")
      sell.pmBuyOrderId = undefined;

    const sharesSold = Number(sell.pmShares) || 0;
    const buy = findBuyForPolymarketSell(sell, buys, buyById);
    if (!buy || sharesSold <= 0)
      continue;

    if (sell.pmOrigin !== "changmen")
      sell.pmBuyOrderId = buy.orderId;

    const deduct = Math.min(sharesSold, buy._remainingShares);
    if (deduct <= 0)
      continue;

    const ratio = buy._remainingShares > 0 ? deduct / buy._remainingShares : 0;
    const costPortion = round4(buy._remainingStake * ratio);
    const sellPrice = Number(sell.odds) > 0 ? 1 / Number(sell.odds) : 0;
    const fromTradeUsdc = Number(sell.betMoney) > 0 ? Number(sell.betMoney) : 0;
    const proceedsUsdc = fromTradeUsdc > 0
      ? round4(fromTradeUsdc * (deduct / sharesSold))
      : round4(deduct * sellPrice);
    const profitUsdc = round4(proceedsUsdc - costPortion);

    sell.pmRealizedPnlUsdc = profitUsdc;
    // 已实现盈亏累加买单；卖单只保留回款
    sell.money = 0;
    sell.betMoney = proceedsUsdc;
    sell.pmStakeUsdc = costPortion;

    buy._realizedMoney = round4(buy._realizedMoney + profitUsdc);
    buy._realizedPnlUsdc = round4(buy._realizedPnlUsdc + profitUsdc);
    buy.money = buy._realizedMoney;
    buy.pmRealizedPnlUsdc = buy._realizedPnlUsdc;
    buy._remainingShares = round4(buy._remainingShares - deduct);
    buy._remainingStake = round4(buy._remainingStake - costPortion);
    buy.pmAttributedSellShares = round4((buy.pmAttributedSellShares ?? 0) + deduct);
    buy.pmSellState = buy._remainingShares <= 0.0001 ? "closed" : "partial";
  }

  const normalizedBuys = buys.map(({
    _remainingShares,
    _remainingStake,
    _fillShares,
    _realizedMoney,
    _realizedPnlUsdc,
    ...b
  }) => ({
    ...b,
    pmShares: round4(_fillShares),
    pmStakeUsdc: _remainingStake > 0 ? round4(_remainingStake) : 0,
  }));

  return sortVenueOrdersNewestFirst([...normalizedBuys, ...sellCopies]);
}

/** RDS 侧栏行（CNY）→ 与 CLOB 合并用的 USDC VenueOrder */
function storedVenueOrderToUsdc(stored: VenueOrder): VenueOrder {
  const stakeUsdc = Number(stored.pmStakeUsdc) || 0;
  const betUsdc = round4((Number(stored.betMoney) || 0) / getExchange(Currency.USDT));
  const sellState = String(stored.pmSellState ?? "").toLowerCase();
  // 原始 betMoney 始终换算保留；剩余敞口只看 pmStakeUsdc
  let nextStake = stakeUsdc;
  if (stored.pmSide !== "sell" && nextStake <= 0 && sellState !== "closed" && sellState !== "settled")
    nextStake = betUsdc;
  return {
    ...stored,
    pmOrigin: "changmen",
    betMoney: betUsdc,
    money: round4((Number(stored.money) || 0) / getExchange(Currency.USDT)),
    pmStakeUsdc: nextStake,
  };
}

/**
 * 份额已全部归因卖出时，不再写 Gamma 赛果（盈亏已在买单 money）。
 * 例外：pmSellState 仍为 open 但 attr 已满 — 数据不一致，允许 Gamma 结算。
 */
export function changmenSoldOutBlocksGammaSettlement(order: VenueOrder): boolean {
  const remaining = resolvePmRemainingShares(order);
  if (remaining > 0.0001)
    return false;
  const attributed = order.pmAttributedSellShares ?? 0;
  if (order.pmSellState === "open" && attributed > 0)
    return false;
  return attributed > 0 || order.pmSellState === "closed";
}

/** changmen 落库行 + CLOB 刷新：绑定/成本以 RDS 为准，成交/赛果以 API 为准 */
function mergeChangmenStoredWithClob(stored: VenueOrder, clob: VenueOrder): VenueOrder {
  const base = storedVenueOrderToUsdc(stored);
  const isSell = base.pmSide === "sell" || clob.pmSide === "sell";
  if (isSell) {
    const betUsdc = clob.betMoney > 0 ? clob.betMoney : base.betMoney;
    const costUsdc = base.pmStakeUsdc ?? 0;
    const profitUsdc = costUsdc > 0 && betUsdc > 0
      ? round4(betUsdc - costUsdc)
      : (Number(base.pmRealizedPnlUsdc) || 0);
    return {
      ...base,
      pmSide: "sell",
      pmOrigin: "changmen",
      pmBuyOrderId: base.pmBuyOrderId ?? clob.pmBuyOrderId,
      pmTokenId: base.pmTokenId ?? clob.pmTokenId,
      pmShares: clob.pmShares ?? base.pmShares,
      pmFillPrice: clob.pmFillPrice ?? base.pmFillPrice,
      betMoney: betUsdc,
      odds: clob.odds || base.odds,
      pmStakeUsdc: costUsdc,
      pmRealizedPnlUsdc: profitUsdc,
      money: 0,
      status: base.status !== "none" ? base.status : clob.status,
      match: base.match || clob.match,
      bet: base.bet || clob.bet,
      item: base.item || clob.item,
      game: base.game || clob.game,
      link: base.link ?? clob.link,
      createAt: base.createAt || clob.createAt,
    };
  }
  const blockGammaSettlement = changmenSoldOutBlocksGammaSettlement(base);
  const gammaSettled = clob.status !== "none";
  // 仅官方 winner 写 settled（隐藏卖出）；0.99 启发式判赢仍保持可卖
  const officialSettled = clob.pmSellState === "settled";
  const nextSellState = officialSettled && !blockGammaSettlement
    ? "settled"
    : (base.pmSellState ?? clob.pmSellState);

  // 已卖光：保留买单上已累计的卖出盈亏，勿清零
  let nextStatus = blockGammaSettlement ? base.status : (gammaSettled ? clob.status : base.status);
  let nextMoney = blockGammaSettlement ? base.money : (gammaSettled ? clob.money : base.money);
  let nextReward = blockGammaSettlement ? base.reward : (gammaSettled ? clob.reward : base.reward);

  // 假 Reject（delayed 误判）但 CLOB 已有成交份额 → 翻回可卖买单
  const storedReject = String(base.status ?? "").toLowerCase() === "reject";
  const clobFillShares = Number(clob.pmShares) || 0;
  if (!blockGammaSettlement && storedReject && clobFillShares > 0.0001) {
    nextStatus = gammaSettled ? clob.status : "none";
    if (!gammaSettled) {
      nextMoney = 0;
      nextReward = Number(clob.reward) || Number(base.reward) || 0;
    }
  }

  // 赛果与盈亏脱钩：卖光仍写入/刷新 pmMatchResult
  const nextMatchResult = clob.pmMatchResult
    ?? ((clob.status === "win" || clob.status === "lose") ? clob.status : undefined)
    ?? base.pmMatchResult;

  // 赛果结算盈亏：用含费全成本（bet/pmStake），勿用 CLOB 名义 money（否则侧栏买入金额与盈亏差手续费）
  if (!blockGammaSettlement && gammaSettled && (clob.status === "win" || clob.status === "lose")) {
    const remaining = resolvePmRemainingShares(base);
    const fill = Math.max(resolvePmFillShares(base), Number(clob.pmShares) || 0);
    const stakeRaw = Number(base.pmStakeUsdc) || 0;
    const betUsdc = Number(base.betMoney) || 0;
    // bet（含费）通常 ≥ 剩余/名义 stake；优先较大者作为全成本
    const allInStake = betUsdc > stakeRaw + 0.0001 ? betUsdc : (stakeRaw > 0 ? stakeRaw : betUsdc);
    if (remaining > 0.0001 && fill > remaining + 0.0001) {
      const priorMoney = Number(base.money) || 0;
      const remStake = stakeRaw > 0 ? stakeRaw : allInStake * (remaining / fill);
      let residualPnl = 0;
      if (clob.status === "win") {
        nextReward = round4(remaining);
        residualPnl = round4(nextReward - remStake);
      }
      else {
        nextReward = 0;
        residualPnl = round4(-remStake);
      }
      nextMoney = round4(priorMoney + residualPnl);
      nextStatus = clob.status;
    }
    else if (fill > 0.0001 && allInStake > 0) {
      if (clob.status === "win") {
        nextReward = round4(fill);
        nextMoney = round4(nextReward - allInStake);
      }
      else {
        nextReward = 0;
        nextMoney = round4(-allInStake);
      }
      nextStatus = clob.status;
    }
  }

  return {
    ...base,
    pmSide: "buy",
    pmOrigin: "changmen",
    betMoney: base.betMoney > 0 ? base.betMoney : clob.betMoney,
    pmShares: (() => {
      const fill = Math.max(Number(base.pmShares) || 0, Number(clob.pmShares) || 0);
      return fill > 0 ? fill : (base.pmShares ?? clob.pmShares);
    })(),
    pmFillPrice: clob.pmFillPrice ?? base.pmFillPrice,
    pmStakeUsdc: base.pmStakeUsdc ?? clob.pmStakeUsdc,
    pmFeeUsdc: (() => {
      const storedFee = Number(base.pmFeeUsdc);
      if (Number.isFinite(storedFee) && storedFee > 0)
        return storedFee;
      const clobFee = Number(clob.pmFeeUsdc);
      return Number.isFinite(clobFee) && clobFee > 0 ? clobFee : undefined;
    })(),
    pmSellState: nextSellState,
    pmAttributedSellShares: base.pmAttributedSellShares ?? clob.pmAttributedSellShares,
    pmMatchResult: nextMatchResult,
    odds: base.odds || clob.odds,
    status: nextStatus,
    money: nextMoney,
    reward: nextReward,
    match: base.match || clob.match,
    bet: base.bet || clob.bet,
    item: base.item || clob.item,
    game: base.game || clob.game,
    pmConditionId: base.pmConditionId ?? clob.pmConditionId,
    createAt: base.createAt || clob.createAt,
  };
}

function isChangmenPolymarketOrder(
  order: VenueOrder,
  stored: VenueOrder | undefined,
  playerId: number,
): boolean {
  return order.pmOrigin === "changmen"
    || stored?.pmOrigin === "changmen"
    || (playerId > 0 && isPolymarketChangmenOrder(playerId, order.orderId));
}

/**
 * CLOB 同步与 RDS changmen 行合并：
 * - changmen 买卖：以 RDS 绑定为准，CLOB 只刷新 fill/赛果
 * - changmen 卖单未 persist 前：跳过 CLOB 新建
 * - 其余：external + 份额匹配
 */
export function mergePolymarketClobWithStoredOrders(
  clobOrders: VenueOrder[],
  storedOrders: VenueOrder[],
  playerId: number,
): VenueOrder[] {
  const storedById = new Map(storedOrders.map(o => [o.orderId, o]));
  const merged: VenueOrder[] = [];
  const usedStored = new Set<string>();

  for (const clob of clobOrders) {
    const stored = storedById.get(clob.orderId);
    const isCm = isChangmenPolymarketOrder(clob, stored, playerId);

    if (stored && isCm) {
      merged.push(mergeChangmenStoredWithClob(stored, clob));
      usedStored.add(clob.orderId);
      continue;
    }
    if (isCm && clob.pmSide === "sell") {
      // changmen 卖单尚未落库 — 勿从 CLOB 猜绑定
      continue;
    }
    if (isCm) {
      merged.push({ ...clob, pmOrigin: "changmen" });
      continue;
    }
    merged.push(clob);
  }

  for (const stored of storedOrders) {
    if (usedStored.has(stored.orderId))
      continue;
    if (stored.pmOrigin === "changmen" || (playerId > 0 && isPolymarketChangmenOrder(playerId, stored.orderId)))
      merged.push(storedVenueOrderToUsdc(stored));
  }

  return merged;
}

/** 标记 origin → 合并 RDS → 仅 external 卖单做份额匹配 */
export function finalizePolymarketVenueOrders(
  clobOrders: VenueOrder[],
  playerId: number,
  storedOrders: VenueOrder[] = [],
): VenueOrder[] {
  const account = { accountId: playerId } as PlatformAccount;
  const tagged = playerId > 0
    ? applyPolymarketOrderOrigins(account, stripPolymarketSellOrders(clobOrders))
    : stripPolymarketSellOrders(clobOrders);
  const merged = mergePolymarketClobWithStoredOrders(
    tagged,
    stripPolymarketSellOrders(storedOrders),
    playerId,
  );
  return stripPolymarketSellOrders(reconcilePolymarketBuySellOrders(merged));
}

async function fetchGammaMarketsChunk(params: URLSearchParams): Promise<PolymarketRawMarket[]> {
  try {
    const data = await polymarketPluginGet<unknown>(
      `${POLYMARKET_GAMMA_API}/markets/keyset?${params.toString()}`,
    );
    return unwrapGammaMarkets(data);
  }
  catch (err) {
    console.warn("[Polymarket] Gamma keyset lookup failed, fallback /markets", err);
    const data = await polymarketPluginGet<unknown>(
      `${POLYMARKET_GAMMA_API}/markets?${params.toString()}`,
    );
    return unwrapGammaMarkets(data);
  }
}

function rememberGammaMarket(out: Map<string, PolymarketRawMarket>, market: PolymarketRawMarket): void {
  const key = marketConditionId(market);
  if (key) out.set(key, market);
  for (const tokenId of gammaTokenIds(market)) {
    const tokenKey = normalizeConditionId(tokenId);
    if (tokenKey) out.set(`token:${tokenKey}`, market);
  }
}

function lookupGammaMarket(
  marketMap: Map<string, PolymarketRawMarket>,
  trade: PolymarketTradeRow,
): PolymarketRawMarket | undefined {
  const conditionKey = normalizeConditionId(String(trade.market ?? ""));
  if (conditionKey && marketMap.has(conditionKey))
    return marketMap.get(conditionKey);
  const assetKey = normalizeConditionId(String(trade.asset_id ?? ""));
  if (assetKey && marketMap.has(`token:${assetKey}`))
    return marketMap.get(`token:${assetKey}`);
  return undefined;
}

async function fetchMarketsByConditionIds(
  ids: string[],
  tokenIds: string[] = [],
): Promise<Map<string, PolymarketRawMarket>> {
  const out = new Map<string, PolymarketRawMarket>();
  const unique = [...new Set(ids.map(id => normalizeConditionId(id)).filter(Boolean))];
  const uniqueTokens = [...new Set(tokenIds.map(id => String(id ?? "").trim()).filter(Boolean))];
  if (!unique.length && !uniqueTokens.length) return out;

  const chunkSize = 20;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const params = new URLSearchParams({ limit: String(chunk.length) });
    for (const id of chunk)
      params.append("condition_ids", id);
    try {
      for (const market of await fetchGammaMarketsChunk(params))
        rememberGammaMarket(out, market);
    }
    catch (fallbackErr) {
      console.warn("[Polymarket] Gamma market lookup failed", fallbackErr);
    }
  }

  for (let i = 0; i < uniqueTokens.length; i += chunkSize) {
    const chunk = uniqueTokens.slice(i, i + chunkSize);
    const params = new URLSearchParams({ limit: String(chunk.length) });
    for (const id of chunk)
      params.append("clob_token_ids", id);
    try {
      for (const market of await fetchGammaMarketsChunk(params))
        rememberGammaMarket(out, market);
    }
    catch (fallbackErr) {
      console.warn("[Polymarket] Gamma token lookup failed", fallbackErr);
    }
  }

  // 每条 condition 都 overlay CLOB：持有买单结算以官方 tokens[].winner 为准
  for (const id of unique) {
    try {
      const clob = await polymarketPluginGet<PolymarketRawMarket>(
        `${POLYMARKET_CLOB_API}/markets/${encodeURIComponent(id)}`,
      );
      const tokens = Array.isArray(clob?.tokens) ? clob.tokens : [];
      if (!tokens.length)
        continue;
      const hasWinner = tokens.some(t => t?.winner === true);
      const existing = out.get(id);
      const outcomePrices = hasWinner
        ? JSON.stringify(tokens.map(t => (t?.winner === true ? "1" : "0")))
        : (existing?.outcomePrices
          ?? existing?.outcome_prices
          ?? JSON.stringify(tokens.map(t => String(t?.price ?? 0))));
      rememberGammaMarket(out, {
        ...(existing || {}),
        condition_id: id,
        question: existing?.question ?? clob?.question,
        title: existing?.title ?? existing?.question ?? clob?.question,
        slug: existing?.slug ?? clob?.market_slug,
        closed: Boolean(existing?.closed) || clob?.closed === true || hasWinner,
        tokens,
        outcomes: JSON.stringify(tokens.map(t => String(t?.outcome ?? ""))),
        outcomePrices,
        clobTokenIds: JSON.stringify(tokens.map(t => String(t?.token_id ?? ""))),
        umaResolutionStatus: hasWinner
          ? (existing?.umaResolutionStatus || existing?.uma_resolution_status || "settled_normal")
          : (existing?.umaResolutionStatus ?? existing?.uma_resolution_status),
      });
    }
    catch {
      // 单条 CLOB 失败：保留 Gamma（若有），结算可走价格兜底
    }
  }
  return out;
}

async function fetchTradesSince(
  account: PlatformAccount,
  gateway: string,
  afterSec: number,
  strict = false,
): Promise<PolymarketTradeRow[]> {
  void gateway;
  try {
    const batch = await pmGetTrades<PolymarketTradeRow[]>(account, afterSec, MAX_TRADE_PAGES);
    if (strict && !Array.isArray(batch))
      throw new Error("PM 成交查询返回非列表响应");
    return Array.isArray(batch) ? batch : [];
  }
  catch (error) {
    if (strict)
      throw error;
    return [];
  }
}

/** CLOB /data/trades → VenueOrder bundle（lookback 可增量，合并靠 RDS stored） */
export async function fetchPolymarketVenueOrdersBundle(
  account: PlatformAccount,
  lookbackMs = ORDER_LOOKBACK_MS,
): Promise<PolymarketVenueOrdersBundle> {
  const gateway = account.gateway || POLYMARKET_CLOB_API;
  const windowMs = Math.min(Math.max(Number(lookbackMs) || ORDER_LOOKBACK_MS, 60_000), ORDER_LOOKBACK_MS);
  const afterSec = Math.floor((Date.now() - windowMs) / 1000);
  const userAddresses = collectPolymarketUserAddressesFromAccount(account);
  let rawTrades: PolymarketTradeRow[];
  try {
    rawTrades = await fetchTradesSince(account, gateway, afterSec);
  }
  catch {
    return { orders: [], flattenedTrades: [] };
  }
  const flattened = flattenPolymarketTrades(rawTrades, userAddresses);
  const buyPreview = aggregatePolymarketTrades(flattened);
  const sellPreview = aggregatePolymarketSellTrades(flattened);
  const preview = [...buyPreview, ...sellPreview].filter(
    trade => (Number(trade.match_time) || 0) >= afterSec,
  );
  const marketMap = await fetchMarketsByConditionIds(
    preview.map(trade => String(trade.market ?? "")).filter(Boolean),
    preview.map(trade => String(trade.asset_id ?? "")).filter(Boolean),
  );
  return {
    orders: mapPolymarketTradesToVenueOrders(rawTrades, marketMap, afterSec, userAddresses),
    flattenedTrades: flattened,
  };
}

export interface PolymarketVenueOrdersBundle {
  orders: VenueOrder[];
  flattenedTrades: PolymarketTradeRow[];
}

/** CLOB /data/trades → VenueOrder（近 3 天；Gamma resolve → win/lose） */
export async function fetchPolymarketVenueOrders(account: PlatformAccount): Promise<VenueOrder[]> {
  const bundle = await fetchPolymarketVenueOrdersBundle(account);
  return bundle.orders;
}

/**
 * [A8 对齐] provider.getOrders 唯一实现：CLOB + RDS changmen 合并 → 展示 CNY。
 * RDS 由 web 层 registerPolymarketStoredVenueOrdersLoader 注入。
 */
export async function fetchPolymarketVenueOrdersMerged(
  account: PlatformAccount,
): Promise<VenueOrder[]> {
  const { loadPolymarketStoredVenueOrders } = await import("./pmStoredOrders");
  const stored = await loadPolymarketStoredVenueOrders(account);
  const hasOpenStored = stored.some(o => hasOpenPolymarketPosition(o));
  const lookbackMs = resolvePolymarketTradeLookbackMs(account.accountId, hasOpenStored);
  const { orders, flattenedTrades } = await fetchPolymarketVenueOrdersBundle(account, lookbackMs);
  markPolymarketOrdersSynced(account.accountId, lookbackMs);
  const finalized = finalizePolymarketVenueOrders(orders, account.accountId, stored);
  // delayed / trades 同步：CLOB orderId→txHash→activity.usdcSize（1:1）；再公式回退；再 scale 成 CNY
  const { parseTokenConfig, resolveFunder, normalizeEthAddress, collectPolymarketUserAddresses } =
    await import("./l2Auth");
  const cfg = parseTokenConfig(account.token);
  const funder = normalizeEthAddress(resolveFunder(cfg));
  const addrs = collectPolymarketUserAddresses(cfg);
  const proxyWallet = funder || [...addrs][0] || "";
  const txHashesByOrderId = collectPolymarketOrderTxHashes(flattenedTrades);
  const withFees = await enrichPolymarketBuyOrdersWithFees(finalized, {
    proxyWallet,
    txHashesByOrderId,
  });
  return scalePolymarketVenueOrdersForDisplay(withFees);
}

/** 纯映射（单测 / 调试）：CLOB trades → VenueOrder（买 + 卖） */
export function mapPolymarketTradesToVenueOrders(
  trades: PolymarketTradeRow[],
  marketMap: Map<string, PolymarketRawMarket> = new Map(),
  afterSec = 0,
  userAddresses?: ReadonlySet<string>,
): VenueOrder[] {
  const flattened = flattenPolymarketTrades(trades, userAddresses);
  const buyTrades = aggregatePolymarketTrades(flattened).filter(
    trade => !afterSec || (Number(trade.match_time) || 0) >= afterSec,
  );

  const orders: VenueOrder[] = [];
  for (const trade of buyTrades) {
    const mapped = mapPolymarketTradeToVenueOrder(
      trade,
      lookupGammaMarket(marketMap, trade),
    );
    if (mapped)
      orders.push(mapped);
  }
  // changmen 仓不在官网卖路径归因：CLOB SELL 成交不映射为 VenueOrder
  return finalizePolymarketVenueOrders(orders, 0);
}
