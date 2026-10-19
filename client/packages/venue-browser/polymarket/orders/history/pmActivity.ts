/**
 * Polymarket Data API `/v2/activity`：适配为内部 camelCase 后核对成本。
 * 收费盘 BUY：`usdcSize ≈ price×size + fee`（实测与官方公式一致）。
 *
 * 与本地下单对齐：
 * - `/activity` / data-api `/trades` **无** CLOB orderId
 * - CLOB `/data/trades` 有 `taker_order_id` + `transaction_hash`
 * - 精确路径：orderId → CLOB trade.tx → activity.transactionHash → usdcSize
 */

import type { PolymarketActivityQuery } from "./pmActivityV2";
import { fetchPolymarketActivityV2 } from "./pmActivityV2";

export interface PolymarketActivityTradeRow {
  proxyWallet?: string;
  timestamp?: number;
  conditionId?: string;
  type?: string;
  size?: number;
  usdcSize?: number;
  price?: number;
  asset?: string;
  side?: string;
  transactionHash?: string;
  title?: string;
  outcome?: string;
}

export interface PolymarketActivityBuyCost {
  /** 撮合价（activity.price，不含费） */
  matchPrice: number;
  shares: number;
  /** 钱包实扣 USDC（含费） */
  usdcSize: number;
  /** usdcSize − matchPrice×shares */
  feeUsdc: number;
  /** 含费均价 = usdcSize/shares（对齐官网 ¢ 徽章） */
  allInAvgPrice: number;
  timestamp?: number;
  transactionHash?: string;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** 从 activity TRADE BUY 行解析含费成本；无效返回 null */
export function parsePolymarketActivityBuyCost(
  row: PolymarketActivityTradeRow | null | undefined,
): PolymarketActivityBuyCost | null {
  if (!row || String(row.type ?? "").toUpperCase() !== "TRADE")
    return null;
  if (String(row.side ?? "").toUpperCase() !== "BUY")
    return null;
  const matchPrice = Number(row.price);
  const shares = Number(row.size);
  const usdcSize = Number(row.usdcSize);
  if (!Number.isFinite(matchPrice) || !Number.isFinite(shares) || !Number.isFinite(usdcSize)
    || !(matchPrice > 0 && matchPrice < 1) || !(shares > 0) || !(usdcSize > 0)) {
    return null;
  }
  const notional = matchPrice * shares;
  let feeUsdc = Math.max(0, usdcSize - notional);
  // 浮点噪点：差额极小当 0
  if (feeUsdc < 0.00001)
    feeUsdc = 0;
  // 异常：usdc 小于名义（索引毛刺）则不可信
  if (usdcSize + 1e-6 < notional)
    return null;
  const allInAvgPrice = usdcSize / shares;
  if (!(allInAvgPrice > 0 && allInAvgPrice < 1))
    return null;
  return {
    matchPrice,
    shares,
    usdcSize: round4(usdcSize),
    feeUsdc: round4(feeUsdc),
    allInAvgPrice,
    timestamp: Number(row.timestamp) > 0 ? Number(row.timestamp) : undefined,
    transactionHash: row.transactionHash ? String(row.transactionHash) : undefined,
  };
}

export interface MatchPolymarketActivityBuyParams {
  conditionId?: string;
  tokenId?: string;
  /** 本地份额（takingAmount） */
  shares?: number;
  /** 成交时间 ms 或 sec；用于邻近匹配 */
  createAtMs?: number;
  /** 份额相对容差，默认 2% */
  sharesTol?: number;
  /** 时间窗秒，默认 600 */
  timeWindowSec?: number;
  /**
   * CLOB `/data/trades.transaction_hash`（官方与 activity.transactionHash 同源）。
   * 有值时优先按 tx 精确匹配，避免同盘同份额串单。
   */
  transactionHashes?: string[];
}

function activityMatchScore(
  row: PolymarketActivityTradeRow,
  params: MatchPolymarketActivityBuyParams,
): number {
  const cost = parsePolymarketActivityBuyCost(row);
  if (!cost)
    return -1;
  const cond = String(params.conditionId ?? "").trim().toLowerCase();
  const asset = String(params.tokenId ?? "").trim();
  const rowCond = String(row.conditionId ?? "").trim().toLowerCase();
  const rowAsset = String(row.asset ?? "").trim();
  // 至少要有 condition 或 asset，否则禁止匹配（避免串到无关买单）
  if (!cond && !asset)
    return -1;
  if (cond && cond !== rowCond)
    return -1;
  if (asset && asset !== rowAsset)
    return -1;
  const condOk = !cond || cond === rowCond;
  const assetOk = !asset || asset === rowAsset;
  if (!condOk && !assetOk)
    return -1;

  const sharesTol = Number(params.sharesTol) > 0 ? Number(params.sharesTol) : 0.02;
  const wantShares = Number(params.shares);
  let shareScore = 0;
  if (wantShares > 0) {
    const rel = Math.abs(cost.shares - wantShares) / wantShares;
    if (rel > sharesTol && Math.abs(cost.shares - wantShares) > 0.05)
      return -1;
    shareScore = 1 - Math.min(rel, 1);
  }

  const windowSec = Number(params.timeWindowSec) > 0 ? Number(params.timeWindowSec) : 600;
  let timeScore = 0.5;
  const createAtMs = Number(params.createAtMs);
  if (createAtMs > 0) {
    if (!cost.timestamp || !Number.isFinite(cost.timestamp))
      return -1;
    const createSec = createAtMs > 1e12 ? createAtMs / 1000 : createAtMs;
    const dt = Math.abs(cost.timestamp - createSec);
    if (dt > windowSec)
      return -1;
    timeScore = 1 - dt / windowSec;
  }

  return shareScore * 2 + timeScore;
}

export interface MatchPolymarketActivityTxFilters {
  conditionId?: string;
  tokenId?: string;
}

/**
 * 按 transactionHash 精确匹配（可多笔 tx 合并成一单成本）。
 * - 同一链上 tx 可能含多市场：必须用 condition/token 收窄，避免串单。
 * - want 中任一 hash 在 activity 列表里完全缺失 → null（索引滞后，勿用半截金额）。
 */
export function matchPolymarketActivityBuyCostByTxHashes(
  rows: PolymarketActivityTradeRow[] | null | undefined,
  transactionHashes: string[] | null | undefined,
  filters?: MatchPolymarketActivityTxFilters,
): PolymarketActivityBuyCost | null {
  if (!Array.isArray(rows) || !rows.length || !Array.isArray(transactionHashes))
    return null;
  const hashes = transactionHashes.map(h => String(h ?? "").trim().toLowerCase());
  if (hashes.some(h => !/^0x[0-9a-f]{64}$/.test(h)))
    return null;
  const want = new Set(hashes);
  if (!want.size)
    return null;

  const cond = String(filters?.conditionId ?? "").trim().toLowerCase();
  const asset = String(filters?.tokenId ?? "").trim();
  if (!cond && !asset)
    return null;
  const matchedTx = new Set<string>();
  const hits: PolymarketActivityBuyCost[] = [];
  const seenRow = new Set<string>();
  for (const row of rows) {
    const tx = String(row.transactionHash ?? "").trim().toLowerCase();
    if (!want.has(tx))
      continue;
    const rowCond = String(row.conditionId ?? "").trim().toLowerCase();
    const rowAsset = String(row.asset ?? "").trim();
    if (cond && cond !== rowCond)
      continue;
    if (asset && asset !== rowAsset)
      continue;
    const cost = parsePolymarketActivityBuyCost(row);
    if (!cost)
      return null;
    matchedTx.add(tx);
    const rawCash = Number(row.usdcSize);
    const key = `${tx}|${rowAsset}|${cost.shares}|${rawCash}|${cost.matchPrice}`;
    if (seenRow.has(key))
      continue;
    seenRow.add(key);
    // Keep full wire precision until the complete multi-fill amount is summed.
    hits.push({ ...cost, usdcSize: rawCash });
  }
  if ([...want].some(tx => !matchedTx.has(tx)))
    return null;
  if (!hits.length)
    return null;
  if (hits.length === 1)
    return { ...hits[0]!, usdcSize: round4(hits[0]!.usdcSize) };

  let shares = 0;
  let usdcSize = 0;
  let notional = 0;
  let timestamp: number | undefined;
  for (const h of hits) {
    shares += h.shares;
    usdcSize += h.usdcSize;
    notional += h.matchPrice * h.shares;
    if (h.timestamp && (!timestamp || h.timestamp > timestamp))
      timestamp = h.timestamp;
  }
  if (!Number.isFinite(shares) || !Number.isFinite(usdcSize) || !Number.isFinite(notional)
    || !(shares > 0) || !(usdcSize > 0)) {
    return null;
  }
  const matchPrice = notional / shares;
  const feeUsdc = Math.max(0, usdcSize - notional);
  return {
    matchPrice,
    shares,
    usdcSize: round4(usdcSize),
    feeUsdc: round4(feeUsdc),
    allInAvgPrice: usdcSize / shares,
    timestamp,
    transactionHash: hits.map(h => h.transactionHash).filter(Boolean).join(","),
  };
}

/**
 * 在 activity 列表中挑匹配 BUY。
 * 有 CLOB transaction_hash 时只走精确匹配（失败则 null，禁止再模糊打分串单）。
 * 无 hash 时回退：condition/token + 份额 + 时间窗。
 */
export function matchPolymarketActivityBuyCost(
  rows: PolymarketActivityTradeRow[] | null | undefined,
  params: MatchPolymarketActivityBuyParams,
): PolymarketActivityBuyCost | null {
  if (!Array.isArray(rows) || !rows.length)
    return null;

  const wantTx = Array.isArray(params.transactionHashes) && params.transactionHashes.length > 0;
  if (wantTx) {
    return matchPolymarketActivityBuyCostByTxHashes(rows, params.transactionHashes, {
      conditionId: params.conditionId,
      tokenId: params.tokenId,
    });
  }

  let best: PolymarketActivityTradeRow | null = null;
  let bestScore = -1;
  for (const row of rows) {
    const score = activityMatchScore(row, params);
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }
  if (!best || bestScore < 0)
    return null;
  return parsePolymarketActivityBuyCost(best);
}

/** GET data-api `/v2/activity`；失败/截断时丢弃整批，调用方保留成本或回退公式。 */
export async function fetchPolymarketUserActivityTrades(
  proxyWallet: string,
  options?: PolymarketActivityQuery,
): Promise<PolymarketActivityTradeRow[]> {
  const user = String(proxyWallet ?? "").trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(user))
    return [];
  try {
    return await fetchPolymarketActivityV2(user, options);
  }
  catch (err) {
    console.warn(
      "[Polymarket] 拉取 /v2/activity 失败，整批结果不用于成本核对",
      user.slice(0, 12),
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

/**
 * 用官网 activity 解析买单含费成本；索引未到或匹配失败返回 null（调用方回退公式）。
 */
export async function resolvePolymarketBuyCostFromActivity(
  proxyWallet: string,
  params: MatchPolymarketActivityBuyParams,
): Promise<PolymarketActivityBuyCost | null> {
  const createAtMs = Number(params.createAtMs);
  const startSec = createAtMs > 0
    ? Math.max(0, Math.floor((createAtMs > 1e12 ? createAtMs / 1000 : createAtMs) - 900))
    : undefined;
  // createAt may be order placement, not fill time (GTC/partial fills).
  // Pin the upper bound to this read so late fills remain eligible.
  const endSec = Math.floor(Date.now() / 1000) + 60;
  const rows = await fetchPolymarketUserActivityTrades(proxyWallet, {
    limit: 80,
    side: "BUY",
    startSec,
    endSec,
  });
  return matchPolymarketActivityBuyCost(rows, params);
}
