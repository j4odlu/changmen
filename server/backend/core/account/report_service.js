import { isPmPendingOrder } from "@changmen/shared/pm_submission";
import * as sb from "@changmen/db";
import { mergePredictionBuySellSiblings, toDateKey } from "./order_store.js";
import { forEachBookedProfitGroup } from "./order/group_home.js";
import { isPredictionSellForCount } from "./order/kinds.js";
import {
  betMoneyForProfitAggregate,
  dedupeOrdersByUserOrderId,
  moneyForProfitAggregate,
} from "./order/profit_cny.js";

function emptyReportRow(dateKey) {
  return {
    // 用 YYYY-MM-DD，避免 toISOString 在 UTC 下导致日期列错位
    Date: String(dateKey),
    Profit: 0,
    OrderCount: 0,
    BetMoney: 0,
    Rate: 0,
    Hacked: 0,
    RealProfit: 0,
    Deposit: 0,
    Withdraw: 0,
    Wallet: 0,
  };
}

function monthBounds(month) {
  const m = month || new Date().toISOString().slice(0, 7);
  const [year, mon] = m.split("-").map(Number);
  if (!year || !mon) {
    const now = new Date();
    return monthBounds(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  }
  const days = new Date(year, mon, 0).getDate();
  return { month: m, year, mon, days };
}

function dateKeyForDay(year, mon, day) {
  return `${year}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** 利润率、充提差、实际利润（利润 − 被黑）[changmen 推测] */
function finalizeRow(row) {
  row.Rate = row.BetMoney > 0 ? row.Profit / row.BetMoney : 0;
  row.Wallet = row.Deposit - row.Withdraw;
  row.RealProfit = row.Profit - row.Hacked;
  return row;
}

function isSportsOrderRow(row) {
  const raw = row?.raw && typeof row.raw === "object" && !Array.isArray(row.raw)
    ? row.raw
    : {};
  return String(raw.domain || "").trim().toLowerCase() === "sports";
}

/** 月报：orders + money_logs；userId 单用户；userIds 团队/可见集（[] = 无成员，非全站） */
export async function getMonthReport(month, userId, userIds) {
  const { month: m, year, mon, days } = monthBounds(month);
  const uid = userId ? String(userId).trim() : "";
  const byDate = new Map();
  for (let day = 1; day <= days; day += 1) {
    const key = dateKeyForDay(year, mon, day);
    byDate.set(key, emptyReportRow(key));
  }

  // userIds: [] = 所选范围无成员，不得当成全站
  const emptyScope = !uid && Array.isArray(userIds) && userIds.length === 0;
  const monthOrders = emptyScope
    ? []
    : await sb.fetchOrdersForMonthAggregate(m, uid || undefined, userIds);
  const merged = (await mergePredictionBuySellSiblings(
    (monthOrders || []).filter(o => !isSportsOrderRow(o)),
  )).filter(o => !isSportsOrderRow(o));
  forEachBookedProfitGroup(dedupeOrdersByUserOrderId(merged), (group, homeKey) => {
    const row = byDate.get(homeKey);
    if (!row)
      return;
    for (const o of group) {
      if (String(o.status || "") === "Reject" || isPmPendingOrder(o))
        continue;
      row.Profit += moneyForProfitAggregate(o);
      if (!isPredictionSellForCount(o)) {
        row.BetMoney += betMoneyForProfitAggregate(o);
        row.OrderCount += 1;
      }
    }
  });

  const moneyLogs = emptyScope
    ? []
    : await sb.fetchMoneyLogsForMonthAggregate(m, uid || undefined, userIds);
  for (const log of moneyLogs || []) {
    const key = toDateKey(log.create_at);
    const row = byDate.get(key);
    if (!row)
      continue;
    const money = Number(log.money) || 0;
    const type = String(log.type || "");
    if (type === "Recharge")
      row.Deposit += money;
    else if (type === "Withdraw")
      row.Withdraw += money;
    else if (type === "Lose")
      row.Hacked += money;
  }

  const list = [];
  const total = emptyReportRow("total");
  const sumKeys = ["Profit", "OrderCount", "BetMoney", "Hacked", "Deposit", "Withdraw"];
  for (let day = 1; day <= days; day += 1) {
    const key = dateKeyForDay(year, mon, day);
    const row = finalizeRow(byDate.get(key));
    list.push(row);
    for (const k of sumKeys) total[k] += row[k];
  }
  finalizeRow(total);
  return { month: m, userId: uid || undefined, list, total };
}
