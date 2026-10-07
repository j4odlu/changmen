/**
 * PM-MARKET Hub 瘦帧：取价规则对齐客户端 extractPolymarketWsBestAsks / bestAskFromBook。
 * 输出标准 best_bid_ask 小帧，供浏览器 wsQuotes 原样消费。
 */

/**
 * @param {{ price?: string|number, size?: string|number }[] | undefined} asks
 * @returns {number}
 */
export function bestAskFromBookAsks(asks) {
  const levels = asks ?? [];
  let best = Number.POSITIVE_INFINITY;
  for (const level of levels) {
    const price = Number(level?.price);
    const size = Number(level?.size);
    if (Number.isFinite(price) && price > 0 && price < best && (!Number.isFinite(size) || size > 0))
      best = price;
  }
  return Number.isFinite(best) ? best : 0;
}

/** @param {unknown} raw */
export function parsePmQuoteTimestampMs(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** @param {object} msg @param {object} [change] */
function quoteTimestampOf(msg, change) {
  return parsePmQuoteTimestampMs(change?.timestamp ?? msg?.timestamp);
}

/**
 * 从待发 raw 读交易所 timestamp（瘦帧 / 透传均可）。
 * @param {string} raw
 */
export function pmHubQuoteTimestampMs(raw) {
  const text = String(raw ?? "").trim();
  if (!text || text === "PONG" || (!text.startsWith("{") && !text.startsWith("[")))
    return 0;
  try {
    const parsed = JSON.parse(text);
    const msg = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!msg || typeof msg !== "object")
      return 0;
    const direct = parsePmQuoteTimestampMs(msg.timestamp);
    if (direct)
      return direct;
    if (Array.isArray(msg.price_changes)) {
      for (const change of msg.price_changes) {
        const ts = parsePmQuoteTimestampMs(change?.timestamp);
        if (ts)
          return ts;
      }
    }
    return 0;
  }
  catch {
    return 0;
  }
}

/**
 * 与客户端 extractPolymarketWsBestAsks 同规则。
 * @param {string} raw
 * @returns {Array<{ assetId: string, bestAsk: string|number, timestamp?: number }>}
 */
export function extractThinBestAskUpdates(raw) {
  if (raw === "PONG")
    return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  }
  catch {
    return [];
  }
  const messages = Array.isArray(parsed) ? parsed : [parsed];
  /** @type {Array<{ assetId: string, bestAsk: string|number, timestamp?: number }>} */
  const updates = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object")
      continue;
    if (msg.event_type === "best_bid_ask" && msg.asset_id && msg.best_ask !== undefined) {
      const timestamp = quoteTimestampOf(msg);
      updates.push({
        assetId: String(msg.asset_id),
        bestAsk: msg.best_ask,
        ...(timestamp ? { timestamp } : {}),
      });
    }
    else if (msg.event_type === "price_change" && Array.isArray(msg.price_changes)) {
      for (const change of msg.price_changes) {
        if (change?.asset_id && change.best_ask !== undefined) {
          const timestamp = quoteTimestampOf(msg, change);
          updates.push({
            assetId: String(change.asset_id),
            bestAsk: change.best_ask,
            ...(timestamp ? { timestamp } : {}),
          });
        }
      }
    }
    else if (msg.event_type === "book" && msg.asset_id) {
      const bestAsk = bestAskFromBookAsks(msg.asks);
      if (bestAsk > 0) {
        const timestamp = quoteTimestampOf(msg);
        updates.push({
          assetId: String(msg.asset_id),
          bestAsk,
          ...(timestamp ? { timestamp } : {}),
        });
      }
    }
  }
  return updates;
}

/**
 * @param {string} assetId
 * @param {string|number} bestAsk
 * @param {number} [timestamp]
 * @returns {string}
 */
export function buildThinBestBidAskFrame(assetId, bestAsk, timestamp) {
  const ts = parsePmQuoteTimestampMs(timestamp);
  return JSON.stringify({
    event_type: "best_bid_ask",
    asset_id: String(assetId),
    best_ask: bestAsk,
    ...(ts ? { timestamp: String(ts) } : {}),
  });
}

/**
 * 上游 raw → 每 asset 一条独立瘦帧（供 fan-out / coalesce 单 key 挂载）。
 * @param {string} raw
 * @returns {Array<{ assetId: string, raw: string }>}
 */
export function thinPmMarketFrames(raw) {
  return extractThinBestAskUpdates(raw).map((u) => ({
    assetId: u.assetId,
    raw: buildThinBestBidAskFrame(u.assetId, u.bestAsk, u.timestamp),
  }));
}

/** 默认开；PM_HUB_THIN_FRAMES=0|false|off 回 raw 透传。 */
export function isPmHubThinFramesEnabled() {
  const v = String(process.env.PM_HUB_THIN_FRAMES ?? "1").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "off" && v !== "no";
}

/** [changmen 扩展] 控制事件不能被同 asset 的最新报价覆盖。 */
export function splitPmControlFrames(raw) {
  try {
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const controls = rows.filter(r => r?.event_type === "tick_size_change" && r.asset_id)
      .map(r => ({ assetId: String(r.asset_id), raw: JSON.stringify(r) }));
    const quotes = rows.filter(r => !(r?.event_type === "tick_size_change" && r.asset_id));
    return { controls, quotes: controls.length ? (quotes.length ? JSON.stringify(quotes) : "") : raw };
  } catch { return { controls: [], quotes: raw }; }
}
