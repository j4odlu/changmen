import { isPmPendingOrder } from "@changmen/shared/pm_submission";
/**
 * 盈亏/流水聚合的 CNY 口径（对齐前端 `polymarketMoneyForAggregate`）。
 * PF 库内 money/bet_money 为 USDT，需 × 汇率；PM/PF 卖单盈亏记在买单。
 */
import { Currency, getExchange } from "@changmen/shared/currency";
import { isPredictionSellForCount } from "./kinds.js";

export function moneyForProfitAggregate(o) {
  if (isPmPendingOrder(o) || isPredictionSellForCount(o))
    return 0;
  const money = Number(o?.money) || 0;
  if (String(o?.provider || "").trim() === "PredictFun")
    return money * getExchange(Currency.USDT);
  return money;
}

export function betMoneyForProfitAggregate(o) {
  if (isPmPendingOrder(o)) return 0;
  const bet = Number(o?.bet_money) || 0;
  if (String(o?.provider || "").trim() === "PredictFun")
    return bet * getExchange(Currency.USDT);
  return bet;
}

/**
 * 排行/月报：同 user 同 order_id 只计一次。
 * 唯一键是 (user_id, order_id, player_id)，删号重加会插出重复行。
 * 保留策略：非 Reject 优先，再取较大 id（较新写入）。
 */
export function dedupeOrdersByUserOrderId(orders) {
  const best = new Map();
  let anon = 0;
  for (const o of orders || []) {
    const uid = String(o?.user_id || "").trim();
    const oid = String(o?.order_id || "").trim().toLowerCase();
    const key = uid && oid ? `${uid}|${oid}` : `__anon:${anon++}`;
    const prev = best.get(key);
    if (!prev) {
      best.set(key, o);
      continue;
    }
    const prevReject = String(prev.status || "") === "Reject";
    const curReject = String(o.status || "") === "Reject";
    if (prevReject && !curReject) {
      best.set(key, o);
      continue;
    }
    if (!prevReject && curReject)
      continue;
    if ((Number(o.id) || 0) >= (Number(prev.id) || 0))
      best.set(key, o);
  }
  return [...best.values()];
}
