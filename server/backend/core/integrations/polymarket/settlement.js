/**
 * Polymarket 订单结算（服务端 / 运维脚本；对齐 venue-adapter/polymarket/orders.ts）
 * - 官方 tokens[].winner：判赢/输
 * [changmen 扩展] 官方赢家优先；用户授权恢复 outcomePrices ≥0.99 的提前判定。
 */

import { fetchClobMarketByConditionId } from "./clob_l2.js";

const POLYMARKET_GAMMA_API = "https://gamma-api.polymarket.com";
const TOKEN_MICRO = 1_000_000;
const WINNER_PRICE_MIN = 0.99;

export function parseJsonArray(value) {
  if (Array.isArray(value))
    return value.map(String).filter(Boolean);
  if (typeof value !== "string")
    return [];
  const trimmed = value.trim();
  if (!trimmed)
    return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  }
  catch {
    return [];
  }
}

export function normalizeConditionId(id) {
  return String(id ?? "").trim().toLowerCase();
}

function gammaTokenIds(market) {
  return parseJsonArray(market?.clobTokenIds ?? market?.clob_token_ids);
}

export function polymarketShareCount(sizeRaw) {
  const size = Number(sizeRaw);
  if (!Number.isFinite(size) || size <= 0)
    return 0;
  if (size >= 10_000)
    return size / TOKEN_MICRO;
  return size;
}

export function polymarketBuyStakeUsdc(sizeRaw, price) {
  const size = Number(sizeRaw);
  if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(price) || price <= 0)
    return 0;
  if (size >= 10_000)
    return (size / TOKEN_MICRO) * price;
  return size * price;
}

/** 官方：CLOB tokens[].winner === true 的 token_id */
export function resolvePolymarketOfficialWinningAssetId(market) {
  const tokens = market?.tokens;
  if (!Array.isArray(tokens) || !tokens.length)
    return null;
  const winning = tokens.find(t => t?.winner === true);
  const id = String(winning?.token_id ?? "").trim();
  return id || null;
}

export function findPolymarketWinnerIndex(prices) {
  if (prices.length < 2 || prices.some(price => !Number.isFinite(price) || price < 0 || price > 1))
    return -1;
  const winners = prices.flatMap((price, index) => price >= WINNER_PRICE_MIN ? [index] : []);
  return winners.length === 1 ? winners[0] : -1;
}

/**
 * @returns {{ winningAssetId: string, kind: 'official'|'price' } | null}
 */
export function resolvePolymarketSettlement(market) {
  if (!market)
    return null;
  const official = resolvePolymarketOfficialWinningAssetId(market);
  if (official)
    return { winningAssetId: official, kind: "official" };
  const prices = parseJsonArray(market.outcomePrices ?? market.outcome_prices).map(Number);
  const ids = gammaTokenIds(market);
  if (prices.length !== ids.length || ids.some(id => !id.trim()) || new Set(ids).size !== ids.length)
    return null;
  const index = findPolymarketWinnerIndex(prices);
  const winningAssetId = index >= 0 ? ids[index]?.trim() : undefined;
  return winningAssetId ? { winningAssetId, kind: "price" } : null;
}

export function isPolymarketMarketResolved(market) {
  return resolvePolymarketSettlement(market) != null;
}

export function resolvePolymarketWinningAssetId(market) {
  return resolvePolymarketSettlement(market)?.winningAssetId ?? null;
}

function tradeHeldAssetId(trade, market) {
  const assetId = String(trade?.asset_id ?? trade?.assetId ?? "").trim();
  if (assetId)
    return assetId;
  const outcome = String(trade?.outcome ?? "").trim();
  if (!market || !outcome)
    return "";
  const outcomes = parseJsonArray(market.outcomes);
  const idx = outcomes.findIndex(name => name.trim() === outcome);
  if (idx < 0)
    return "";
  return gammaTokenIds(market)[idx] ?? "";
}

/**
 * @returns {{ status: 'win'|'lose'|'none', money: number, reward: number, kind?: 'official'|'price' } | null}
 */
export function computePolymarketSettlement(trade, market, stakeRaw) {
  const resolved = resolvePolymarketSettlement(market);
  if (!resolved)
    return { status: "none", money: 0, reward: 0 };

  const heldAssetId = tradeHeldAssetId(trade, market);
  if (!heldAssetId)
    return null;

  const shares = polymarketShareCount(trade?.size ?? trade?.matched_amount);
  const stake = Number(stakeRaw);
  if (shares <= 0 || !Number.isFinite(stake) || stake <= 0)
    return null;

  if (heldAssetId === resolved.winningAssetId) {
    const reward = Math.round(shares * 10000) / 10000;
    const money = Math.round((reward - stake) * 10000) / 10000;
    return { status: "win", reward, money, kind: resolved.kind };
  }
  return { status: "lose", reward: 0, money: -stake, kind: resolved.kind };
}

export function computePolymarketSettlementFromOrderRaw(raw, market, stakeUsdc) {
  const resolved = resolvePolymarketSettlement(market);
  if (!resolved)
    return { status: "none", money: 0, reward: 0 };

  const heldAssetId = String(raw?.pmTokenId ?? "").trim();
  if (!heldAssetId)
    return null;

  const shares = Number(raw?.pmShares) || 0;
  const stake = Number(stakeUsdc);
  if (shares <= 0 || !Number.isFinite(stake) || stake <= 0)
    return null;

  if (heldAssetId === resolved.winningAssetId) {
    const reward = Math.round(shares * 10000) / 10000;
    const money = Math.round((reward - stake) * 10000) / 10000;
    return { status: "win", reward, money, kind: resolved.kind };
  }
  return { status: "lose", reward: 0, money: -stake, kind: resolved.kind };
}

function unwrapGammaMarkets(data) {
  if (Array.isArray(data))
    return data;
  if (data && typeof data === "object") {
    if (Array.isArray(data.markets))
      return data.markets;
    if (Array.isArray(data.data))
      return data.data;
  }
  return [];
}

function marketConditionId(market) {
  return normalizeConditionId(
    String(market?.condition_id ?? market?.conditionId ?? market?.market ?? market?.id ?? ""),
  );
}

async function fetchGammaJson(url) {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok)
    throw new Error(`Gamma ${res.status} ${url}`);
  return res.json();
}

async function fetchGammaMarketsChunk(params) {
  let data;
  try {
    data = await fetchGammaJson(`${POLYMARKET_GAMMA_API}/markets/keyset?${params.toString()}`);
  }
  catch {
    data = await fetchGammaJson(`${POLYMARKET_GAMMA_API}/markets?${params.toString()}`);
  }
  return unwrapGammaMarkets(data);
}

function rememberGammaMarket(out, market) {
  const key = marketConditionId(market);
  if (key)
    out.set(key, market);
  for (const tokenId of gammaTokenIds(market)) {
    const tokenKey = normalizeConditionId(tokenId);
    if (tokenKey)
      out.set(`token:${tokenKey}`, market);
  }
}

/** @param {Map<string, object>} out */
function storeGammaMarkets(out, markets) {
  for (const market of markets)
    rememberGammaMarket(out, market);
}

export function lookupGammaMarket(marketMap, trade) {
  const conditionKey = normalizeConditionId(String(trade?.market ?? ""));
  if (conditionKey && marketMap.has(conditionKey))
    return marketMap.get(conditionKey);
  const assetKey = normalizeConditionId(String(trade?.asset_id ?? trade?.assetId ?? ""));
  if (assetKey && marketMap.has(`token:${assetKey}`))
    return marketMap.get(`token:${assetKey}`);
  return undefined;
}

/** batch Gamma lookup（condition_ids + clob_token_ids 双路） */
export async function fetchGammaMarketsByConditionIds(ids, tokenIds = []) {
  const out = new Map();
  const unique = [...new Set(ids.map(id => normalizeConditionId(id)).filter(Boolean))];
  const uniqueTokens = [...new Set(tokenIds.map(id => String(id ?? "").trim()).filter(Boolean))];

  const chunkSize = 20;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const params = new URLSearchParams({ limit: String(chunk.length) });
    for (const id of chunk)
      params.append("condition_ids", id);
    storeGammaMarkets(out, await fetchGammaMarketsChunk(params));
  }

  for (let i = 0; i < uniqueTokens.length; i += chunkSize) {
    const chunk = uniqueTokens.slice(i, i + chunkSize);
    const params = new URLSearchParams({ limit: String(chunk.length) });
    for (const id of chunk)
      params.append("clob_token_ids", id);
    storeGammaMarkets(out, await fetchGammaMarketsChunk(params));
  }

  for (const id of unique) {
    if (out.has(id))
      continue;
    try {
      const params = new URLSearchParams({ limit: "1", condition_ids: id });
      storeGammaMarkets(out, await fetchGammaMarketsChunk(params));
    }
    catch { /* skip */ }
  }

  for (const tokenId of uniqueTokens) {
    if (out.has(`token:${normalizeConditionId(tokenId)}`))
      continue;
    try {
      const params = new URLSearchParams({ limit: "1", clob_token_ids: tokenId });
      storeGammaMarkets(out, await fetchGammaMarketsChunk(params));
    }
    catch { /* skip */ }
  }
  return out;
}

export function mapDbStatus(raw) {
  const s = String(raw || "").toLowerCase();
  if (s === "win")
    return "Win";
  if (s === "lose")
    return "Lose";
  return "None";
}

/** CLOB /markets/{condition_id} → 结算形状（保留官方 tokens[].winner） */
export function clobMarketToGammaShape(clob, base) {
  const tokens = Array.isArray(clob?.tokens) ? clob.tokens : [];
  if (!tokens.length)
    return base || null;
  const hasWinner = tokens.some(t => t?.winner === true);
  const existingPrices = base?.outcomePrices ?? base?.outcome_prices;
  const outcomePrices = hasWinner
    ? JSON.stringify(tokens.map(t => (t?.winner === true ? "1" : "0")))
    : (existingPrices
      ?? JSON.stringify(tokens.map(t => String(t?.price ?? 0))));
  // [changmen 扩展] Gamma 价格必须保留其 token 顺序，缺映射时不借 CLOB 顺序猜赢家。
  const priceTokenIds = !hasWinner && existingPrices != null
    ? gammaTokenIds(base)
    : tokens.map(t => String(t?.token_id ?? ""));
  return {
    ...(base || {}),
    condition_id: clob?.condition_id || base?.condition_id,
    question: base?.question ?? clob?.question,
    title: base?.title ?? base?.question ?? clob?.question,
    slug: base?.slug ?? clob?.market_slug,
    closed: Boolean(base?.closed) || clob?.closed === true || hasWinner,
    tokens,
    outcomes: JSON.stringify(!hasWinner && existingPrices != null
      ? parseJsonArray(base?.outcomes)
      : tokens.map(t => String(t?.outcome ?? ""))),
    outcomePrices,
    clobTokenIds: JSON.stringify(priceTokenIds),
    umaResolutionStatus: hasWinner
      ? (base?.umaResolutionStatus || base?.uma_resolution_status || "settled_normal")
      : (base?.umaResolutionStatus ?? base?.uma_resolution_status),
  };
}

export function orderLabelsFromMarket(market) {
  const match = String(market?.question ?? market?.title ?? market?.slug ?? "").trim();
  let bet = "";
  const mapMatch = /\b(?:Map|Game)\s*(\d+)\s+Winner\b/i.exec(match);
  if (mapMatch)
    bet = `地图${mapMatch[1]}`;
  else if (/\b(?:Match|Series)\s+Winner\b/i.test(match) || /\(\s*BO\d/i.test(match))
    bet = "全场";
  return { game: "", match, bet };
}

export function isHexMatchFallback(match) {
  return /^0x[0-9a-f]{6,10}…$/i.test(String(match ?? "").trim());
}

/** 每条 condition 都 overlay CLOB（官方 winner） */
export async function enrichMarketsFromClob(marketMap, conditionIds, gateway) {
  for (const rawId of conditionIds) {
    const id = normalizeConditionId(rawId);
    if (!id)
      continue;
    const clob = await fetchClobMarketByConditionId(id, gateway);
    const shaped = clobMarketToGammaShape(clob, marketMap.get(id));
    if (shaped)
      rememberGammaMarket(marketMap, shaped);
  }
  return marketMap;
}
