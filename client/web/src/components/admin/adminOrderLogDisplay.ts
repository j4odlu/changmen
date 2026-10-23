import type { AdminOrderLogAttempt, AdminOrderLogEntry, AdminOrderLogLegSection } from "@/types/admin";
import { adminOrderBetMoneyCny, adminOrderMoneyCny, isAdminPredictionSell } from "@/shared/adminOrderMoney";

export function fmtTime(ts: number) {
  if (!ts)
    return "—";
  return new Date(ts).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
}

export function fmtClock(ts: number) {
  if (!ts)
    return "—";
  return new Date(ts).toLocaleTimeString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
}

export function fmtMoney(n: number) {
  return Math.floor(n).toLocaleString();
}

export function orderMoneyCny(order: NonNullable<AdminOrderLogAttempt["order"]>) {
  return adminOrderMoneyCny({
    provider: order.provider,
    money: order.money,
    pfSide: order.pfSide,
    pmSide: order.pmSide,
  });
}

export function orderStakeLabel(order: NonNullable<AdminOrderLogAttempt["order"]>) {
  return isAdminPredictionSell(order) ? "回款" : "金额";
}

export function orderStakeCny(order: NonNullable<AdminOrderLogAttempt["order"]>) {
  return adminOrderBetMoneyCny({
    provider: order.provider,
    betMoney: order.betMoney,
    pfSide: order.pfSide,
    pmSide: order.pmSide,
  });
}

export function reduceEvents(order: NonNullable<AdminOrderLogAttempt["order"]>) {
  const sells = order.positionEvents?.sells;
  return Array.isArray(sells) ? sells : [];
}

export function fmtMaybeNumber(n: number | null | undefined) {
  if (n === null || n === undefined || Number.isNaN(Number(n)))
    return "";
  return String(n);
}

export function kindClass(kind: string) {
  if (kind === "bet")
    return "admin-order-log-kind--bet";
  if (kind === "check")
    return "admin-order-log-kind--check";
  if (kind === "reject")
    return "admin-order-log-kind--reject";
  return "";
}

export function statusBadgeClass(status: string) {
  const s = status.toLowerCase();
  if (s === "win")
    return "admin-badge--win";
  if (s === "lose")
    return "admin-badge--lose";
  if (s === "reject")
    return "admin-badge--reject";
  if (s === "pending")
    return "admin-badge--pending";
  return "";
}

export function pnlClass(money: number) {
  if (money > 0)
    return "pos";
  if (money < 0)
    return "neg";
  return "";
}

export function logDetailParts(log: AdminOrderLogEntry) {
  const parts: string[] = [];
  if (log.accountLabel)
    parts.push(log.accountLabel);
  if (log.match)
    parts.push(log.match);
  if (log.bet)
    parts.push(log.bet);
  const odds = fmtMaybeNumber(log.requestOdds ?? log.odds);
  const amount = fmtMaybeNumber(log.requestAmount ?? log.betMoney);
  if (log.target || odds || amount) {
    parts.push(
      [
        log.target || "",
        odds ? `@${odds}` : "",
        amount ? `¥${amount}` : "",
      ].filter(Boolean).join(" "),
    );
  }
  if (log.matchedOrderId && !log.orderId)
    parts.push(`关联订单 #${log.matchedOrderId}`);
  if (log.relationReason)
    parts.push(`依据：${log.relationReason}`);
  return parts.filter(Boolean);
}

export function attemptDividerLabel(prev: AdminOrderLogAttempt, next: AdminOrderLogAttempt) {
  if (prev.order?.status?.toLowerCase() === "reject")
    return "拒单后重下";
  if (!prev.order && next.order)
    return "再次下单";
  return "再次下单";
}

export function legOrderAttempts(leg: AdminOrderLogLegSection) {
  return leg.attempts.filter(a => a.order);
}

export function legProfit(leg: AdminOrderLogLegSection) {
  let sum = 0;
  for (const a of leg.attempts) {
    const o = a.order;
    if (!o)
      continue;
    sum += adminOrderMoneyCny({
      provider: o.provider,
      money: o.money,
      pfSide: o.pfSide,
      pmSide: o.pmSide,
    });
  }
  return sum;
}
