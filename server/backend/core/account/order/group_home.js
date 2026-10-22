/**
 * Link 组归属日：优先用 Link 还原的开弓时间戳（套利/单边/正 EV 编码）。
 * Link 不是毫秒时间戳时回退到主腿最早 create_at。
 */
import { toDateKey } from "./date_key.js";
import { isPredictionSellForCount } from "./kinds.js";

/** 与 @changmen/db order_link_filter 对齐，避免本文件依赖被整包 mock 的 @changmen/db */
const ARB_LINK_MIN = 1_000_000_000_000;
const VALUE_BET_LINK_BASE = 7_000_000_000_000_000;
const LOW_ODDS_LINK_BASE = 6_000_000_000_000_000;

function linkHomeTs(link) {
  const n = Math.abs(Number(link)) || 0;
  const ts = n >= VALUE_BET_LINK_BASE ? n - VALUE_BET_LINK_BASE
    : n >= LOW_ODDS_LINK_BASE ? n - LOW_ODDS_LINK_BASE : n;
  return ts >= ARB_LINK_MIN ? ts : 0;
}

export function groupHomeTsFromRaw(group) {
  const list = group || [];
  const fromLink = linkHomeTs(list[0]?.link);
  if (fromLink)
    return fromLink;
  const primary = list.filter(r => !isPredictionSellForCount(r));
  const pool = primary.length ? primary : list;
  const times = pool.map(r => Number(r.create_at) || 0).filter(n => n > 0);
  return times.length ? Math.min(...times) : 0;
}

/** link=0：每条独立；非 0：同 user_id + link 一组 */
export function groupRawOrdersForProfit(orders) {
  const byKey = new Map();
  const singles = [];
  for (const o of orders || []) {
    const uid = String(o?.user_id || "").trim();
    const link = Number(o?.link) || 0;
    if (link === 0) {
      singles.push([o]);
      continue;
    }
    const key = `${uid}|${link}`;
    if (!byKey.has(key))
      byKey.set(key, []);
    byKey.get(key).push(o);
  }
  return [...byKey.values(), ...singles];
}

/**
 * @param {object[]} orders
 * @param {(group: object[], homeKey: string) => void} fn
 */
export function forEachBookedProfitGroup(orders, fn) {
  for (const group of groupRawOrdersForProfit(orders)) {
    const homeTs = groupHomeTsFromRaw(group);
    const fallbackAt = Number(group[0]?.create_at) || 0;
    const homeKey = toDateKey(homeTs > 0 ? homeTs : fallbackAt);
    fn(group, homeKey);
  }
}
