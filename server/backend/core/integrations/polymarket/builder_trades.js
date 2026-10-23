import { createPolymarketBuilderHeaders } from "./relayer_sign_unified.js";
import { loadPolymarketBuilderCreds } from "./relayer_config.js";
import { resolvePolymarketBuilderCode } from "./builder_code.js";

const CLOB_HOST = String(process.env.POLYMARKET_CLOB_API || "https://clob.polymarket.com").replace(/\/+$/, "");
const MICRO = 1_000_000;
const NO_MORE_CURSOR = "LTE=";

function requireBuilderCreds() {
  const creds = loadPolymarketBuilderCreds();
  if (!creds)
    throw new Error("未配置 POLY_BUILDER_API_KEY/SECRET/PASSPHRASE，无法查询 Builder 成交");
  return creds;
}

function causeText(err) {
  const cause = err && typeof err === "object" ? err.cause : null;
  if (!cause)
    return "";
  if (cause instanceof Error) {
    const code = cause.code ? String(cause.code) : "";
    if (code && cause.message)
      return `${code}: ${cause.message}`;
    return cause.message || code;
  }
  return String(cause);
}

/** Node undici 失败时常只有 "fetch failed"；把 cause 和本机出海提示拼上 */
export function describeBuilderTradesFetchError(err, url = CLOB_HOST) {
  const raw = err instanceof Error ? err.message : String(err ?? "unknown");
  if (raw.startsWith("Polymarket builder/trades ") || raw.includes("未配置 POLY_BUILDER"))
    return raw;
  const cause = causeText(err);
  const detail = cause && !raw.includes(cause) ? `${raw} (${cause})` : raw;
  const unreachable = /fetch failed|Failed to fetch|Connect Timeout|ECONNRESET|ENOTFOUND|ECONNREFUSED|UND_ERR|ETIMEDOUT|cert|TLS|network/i.test(`${detail} ${cause}`);
  const hint = unreachable
    ? "本机 Node 直连 clob.polymarket.com 失败（国内常见）。归因成交须由能出海的机器去拉：改 UI 用 Vite remote（VITE_API_PROXY 指香港 VPS）；本机全栈请给 backend 配 HTTPS_PROXY。"
    : "";
  return `Polymarket builder/trades 请求失败（${url}）：${detail}${hint ? `。${hint}` : ""}`;
}

/**
 * CLOB `/builder/trades` 金额：线上返回人类可读小数（如 `"5.88"`）；
 * OpenAPI 示例仍是 6 位微单位整数（如 `"50000000"`）。两者都兼容。
 */
export function amountToNumber(raw) {
  if (raw == null || raw === "")
    return 0;
  const s = String(raw).trim();
  const n = Number(s);
  if (!Number.isFinite(n))
    return 0;
  if (s.includes("."))
    return n;
  if (Number.isInteger(n) && Math.abs(n) >= 1000)
    return n / MICRO;
  return n;
}

export function normalizeBuilderTrade(raw) {
  const matchSec = Number(raw?.matchTime);
  const feeUsdc = amountToNumber(raw?.feeUsdc);
  const builderFeeUsdc = amountToNumber(raw?.builderFee);
  return {
    id: String(raw?.id ?? ""),
    tradeType: String(raw?.tradeType ?? ""),
    side: String(raw?.side ?? ""),
    status: String(raw?.status ?? ""),
    outcome: String(raw?.outcome ?? ""),
    price: Number(raw?.price) || 0,
    sizeShares: amountToNumber(raw?.size),
    sizeUsdc: amountToNumber(raw?.sizeUsdc),
    feeUsdc,
    /** 协议字段 builderFee；线上常为 0，有值时优先作 Builder 费展示 */
    builderFeeUsdc,
    /** 看板展示用：优先 builderFee，否则 feeUsdc（归因成交上的费用） */
    displayFeeUsdc: builderFeeUsdc > 0 ? builderFeeUsdc : feeUsdc,
    maker: String(raw?.maker ?? ""),
    owner: String(raw?.owner ?? ""),
    market: String(raw?.market ?? ""),
    assetId: String(raw?.assetId ?? ""),
    transactionHash: String(raw?.transactionHash ?? ""),
    matchTime: Number.isFinite(matchSec) ? matchSec * 1000 : null,
    matchTimeIso: Number.isFinite(matchSec) ? new Date(matchSec * 1000).toISOString() : null,
    builder: String(raw?.builder ?? raw?.builderCode ?? ""),
  };
}

export function summarizeBuilderTrades(trades) {
  let volumeUsdc = 0;
  let feeUsdc = 0;
  let builderFeeUsdc = 0;
  let buyCount = 0;
  let sellCount = 0;
  let buyVolumeUsdc = 0;
  let sellVolumeUsdc = 0;
  let buyFeeUsdc = 0;
  let sellFeeUsdc = 0;
  let buyBuilderFeeUsdc = 0;
  let sellBuilderFeeUsdc = 0;
  for (const t of trades) {
    const size = Number(t.sizeUsdc) || 0;
    const fee = Number(t.feeUsdc) || 0;
    const builderFee = Number(t.builderFeeUsdc) || 0;
    volumeUsdc += size;
    feeUsdc += fee;
    builderFeeUsdc += builderFee;
    if (t.side === "BUY") {
      buyCount += 1;
      buyVolumeUsdc += size;
      buyFeeUsdc += fee;
      buyBuilderFeeUsdc += builderFee;
    }
    else if (t.side === "SELL") {
      sellCount += 1;
      sellVolumeUsdc += size;
      sellFeeUsdc += fee;
      sellBuilderFeeUsdc += builderFee;
    }
  }
  return {
    tradeCount: trades.length,
    volumeUsdc,
    feeUsdc,
    builderFeeUsdc,
    buyCount,
    sellCount,
    buyVolumeUsdc,
    sellVolumeUsdc,
    buyFeeUsdc,
    sellFeeUsdc,
    buyBuilderFeeUsdc,
    sellBuilderFeeUsdc,
  };
}

/**
 * @param {{ builderCode?: string, afterSec?: number, beforeSec?: number, market?: string, maxPages?: number, nextCursor?: string }} opts
 */
export async function fetchBuilderTradesPage(opts = {}) {
  const builderCode = opts.builderCode || resolvePolymarketBuilderCode();
  const params = new URLSearchParams({ builder_code: builderCode });
  if (opts.afterSec != null && Number.isFinite(Number(opts.afterSec)))
    params.set("after", String(Math.floor(Number(opts.afterSec))));
  if (opts.beforeSec != null && Number.isFinite(Number(opts.beforeSec)))
    params.set("before", String(Math.floor(Number(opts.beforeSec))));
  if (opts.market)
    params.set("market", opts.market);
  if (opts.nextCursor)
    params.set("next_cursor", opts.nextCursor);

  const reqPath = `/builder/trades?${params.toString()}`;
  const headers = await createPolymarketBuilderHeaders(requireBuilderCreds(), "GET", reqPath);
  const url = `${CLOB_HOST}${reqPath}`;

  try {
    const res = await fetch(url, {
      headers: { ...headers, Accept: "application/json" },
      signal: AbortSignal.timeout(Number(process.env.POLY_BUILDER_TRADES_TIMEOUT_MS || 30000)),
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 400);
      try {
        detail = JSON.parse(text)?.error || detail;
      }
      catch { /* ignore */ }
      throw new Error(`Polymarket builder/trades ${res.status}: ${detail}`);
    }
    return JSON.parse(text);
  }
  catch (err) {
    if (err instanceof Error && /^Polymarket builder\/trades \d/.test(err.message))
      throw err;
    throw new Error(describeBuilderTradesFetchError(err, url));
  }
}

/**
 * @param {{ afterSec?: number, beforeSec?: number, maxPages?: number, maxTrades?: number }} opts
 */
export async function fetchAllBuilderTrades(opts = {}) {
  const maxPages = Math.min(Math.max(Number(opts.maxPages) || 5, 1), 20);
  const maxTrades = Math.min(Math.max(Number(opts.maxTrades) || 5000, 1), 5000);
  const all = [];
  let nextCursor;
  let pages = 0;
  let lastResponse;
  let hitTradeLimit = false;

  while (pages < maxPages && all.length < maxTrades) {
    lastResponse = await fetchBuilderTradesPage({
      afterSec: opts.afterSec,
      beforeSec: opts.beforeSec,
      nextCursor,
    });
    const batch = Array.isArray(lastResponse?.data) ? lastResponse.data : [];
    const remaining = maxTrades - all.length;
    const normalized = batch.map(normalizeBuilderTrade);
    all.push(...normalized.slice(0, remaining));
    hitTradeLimit = normalized.length > remaining;
    pages += 1;
    nextCursor = lastResponse?.next_cursor;
    if (!nextCursor || nextCursor === NO_MORE_CURSOR || batch.length === 0)
      break;
  }

  return {
    trades: all,
    summary: summarizeBuilderTrades(all),
    pagesFetched: pages,
    nextCursor: lastResponse?.next_cursor ?? null,
    hasMore: hitTradeLimit
      || Boolean(lastResponse?.next_cursor && lastResponse.next_cursor !== NO_MORE_CURSOR),
  };
}
