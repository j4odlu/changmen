/**
 * 仓位减仓事件流水（审计 + 展示；Phase 0 起正式称「仓位」而非仅「买单附属」）。
 * 权威盈亏/份额/回款仍以仓位聚合字段为准；本数组按 sell id 幂等 upsert，缺省保留库内值。
 *
 * Canonical: raw.positionEvents.sells[]
 * 字段契约：id, at, shares, proceeds；可选 price, pnl, origin, status
 * Incoming 也可带 o.sells / o.positionEvents.sells（仅 upsert，空数组不清空）。
 */
import { Currency, getExchange } from "@changmen/shared/currency";

function asObj(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

/** @param {unknown} ev */
export function normalizePositionSellEvent(ev) {
  if (!ev || typeof ev !== "object" || Array.isArray(ev))
    return null;
  const id = String(ev.id ?? ev.orderId ?? "").trim();
  if (!id)
    return null;
  const at = Number(ev.at ?? ev.createAt) || 0;
  const shares = Number(ev.shares);
  const proceeds = Number(ev.proceeds);
  const price = Number(ev.price);
  const pnl = Number(ev.pnl);
  const originRaw = String(ev.origin || "").toLowerCase();
  const origin = originRaw === "external" || originRaw === "changmen" ? originRaw : undefined;
  const status = ev.status != null && String(ev.status).trim() ? String(ev.status) : undefined;
  /** @type {Record<string, unknown>} */
  const out = {
    id,
    at,
    shares: Number.isFinite(shares) ? shares : 0,
    proceeds: Number.isFinite(proceeds) ? proceeds : 0,
  };
  if (Number.isFinite(price) && price > 0)
    out.price = price;
  if (Number.isFinite(pnl))
    out.pnl = pnl;
  if (origin)
    out.origin = origin;
  if (status)
    out.status = status;
  return out;
}

/** @param {object|undefined} raw */
export function readPositionSellEvents(raw) {
  const pe = asObj(raw?.positionEvents);
  const fromPe = Array.isArray(pe.sells) ? pe.sells : [];
  const fromTop = Array.isArray(raw?.sells) ? raw.sells : [];
  const list = fromPe.length ? fromPe : fromTop;
  const out = [];
  const seen = new Set();
  for (const ev of list) {
    const n = normalizePositionSellEvent(ev);
    if (!n)
      continue;
    const key = n.id.toLowerCase();
    if (seen.has(key))
      continue;
    seen.add(key);
    out.push(n);
  }
  return out.sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0));
}

/**
 * 收集入参中「要 upsert 的」卖出事件（有 id 才算）。
 * 缺省 / 空数组 → 返回 []（调用方应保留 prev，不清空）。
 * @param {object} o
 * @param {object} merged
 */
export function collectIncomingPositionSellEvents(o, merged) {
  const bags = [];
  const pushBag = (obj) => {
    if (!obj || typeof obj !== "object")
      return;
    if (Object.prototype.hasOwnProperty.call(obj, "positionEvents")) {
      const pe = obj.positionEvents;
      if (pe && typeof pe === "object" && Array.isArray(pe.sells))
        bags.push(...pe.sells);
    }
    if (Object.prototype.hasOwnProperty.call(obj, "sells") && Array.isArray(obj.sells))
      bags.push(...obj.sells);
  };
  pushBag(o);
  pushBag(merged);
  const out = [];
  const seen = new Set();
  for (const ev of bags) {
    const n = normalizePositionSellEvent(ev);
    if (!n)
      continue;
    const key = n.id.toLowerCase();
    if (seen.has(key))
      continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

/**
 * @param {object[]} prev
 * @param {object[]} incoming
 */
export function upsertPositionSellEvents(prev, incoming) {
  const byId = new Map();
  for (const ev of prev || []) {
    const n = normalizePositionSellEvent(ev);
    if (n)
      byId.set(n.id.toLowerCase(), n);
  }
  for (const ev of incoming || []) {
    const n = normalizePositionSellEvent(ev);
    if (!n)
      continue;
    const key = n.id.toLowerCase();
    const old = byId.get(key);
    byId.set(key, old ? { ...old, ...n, id: n.id } : n);
  }
  return [...byId.values()].sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0));
}

/**
 * 买单/仓位行：合并 positionEvents.sells；卖单行：剥掉以免污染。
 * @param {object} merged
 * @param {object} prevRaw
 * @param {object} o
 * @param {{ isSellRow?: boolean }} [opts]
 */
export function applyPositionEventsOnSave(merged, prevRaw, o, opts = {}) {
  if (!merged || typeof merged !== "object")
    return merged;
  if (opts.isSellRow) {
    delete merged.positionEvents;
    delete merged.sells;
    return merged;
  }

  const prevSells = readPositionSellEvents(prevRaw);
  const incoming = collectIncomingPositionSellEvents(o, merged);
  const nextSells = incoming.length
    ? upsertPositionSellEvents(prevSells, incoming)
    : prevSells;

  if (nextSells.length) {
    merged.positionEvents = {
      ...asObj(prevRaw?.positionEvents),
      ...asObj(merged.positionEvents),
      sells: nextSells,
    };
  }
  else {
    // 无事件：勿留下 sync 误带的空壳盖掉语义；删掉空 positionEvents.sells
    if (merged.positionEvents && typeof merged.positionEvents === "object") {
      const pe = { ...merged.positionEvents };
      delete pe.sells;
      if (Object.keys(pe).length)
        merged.positionEvents = pe;
      else
        delete merged.positionEvents;
    }
  }
  delete merged.sells;
  return merged;
}

/**
 * 历史卖单 RDS 行 → 仓位事件 + 父买单 id（回填用）。
 * @param {{ order_id?: string, provider?: string, create_at?: number, bet_money?: number, raw?: object }} row
 * @returns {{ buyId: string, event: object } | null}
 */
export function sellDbRowToPositionEvent(row) {
  if (!row || typeof row !== "object")
    return null;
  const raw = asObj(row.raw);
  const id = String(row.order_id ?? "").trim();
  if (!id)
    return null;
  const provider = String(row.provider ?? "").trim();
  const at = Number(row.create_at) || 0;

  if (provider === "Polymarket" && String(raw.pmSide ?? "").toLowerCase() === "sell") {
    const buyId = String(raw.pmBuyOrderId ?? "").trim();
    if (!buyId)
      return null;
    const event = normalizePositionSellEvent({
      id,
      at,
      shares: raw.pmShares,
      price: raw.pmFillPrice,
      // [changmen 扩展] GTC 卖单 stake 是摊销成本，回填也必须取卖单现金。
      proceeds: raw.pmGtcExecutionId && Number.isFinite(Number(row.bet_money))
        ? Math.round(Number(row.bet_money) / getExchange(Currency.USDT) * 10000) / 10000 : raw.pmStakeUsdc,
      pnl: raw.pmRealizedPnlUsdc,
      origin: raw.pmOrigin === "external" ? "external" : "changmen",
    });
    return event ? { buyId, event } : null;
  }

  if (provider === "PredictFun" && String(raw.pfSide ?? "").toLowerCase() === "sell") {
    const buyId = String(raw.pfBuyOrderId ?? "").trim();
    if (!buyId)
      return null;
    const proceeds = Number(row.bet_money);
    const event = normalizePositionSellEvent({
      id,
      at,
      shares: raw.pfShares,
      price: raw.pfBookPrice,
      proceeds: Number.isFinite(proceeds) && proceeds >= 0 ? proceeds : 0,
      origin: "changmen",
      status: "closed",
    });
    return event ? { buyId, event } : null;
  }

  return null;
}
